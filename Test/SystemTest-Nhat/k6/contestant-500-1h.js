import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const ACCOUNTS_CSV = __ENV.ACCOUNTS_CSV || './accounts.csv';
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || '500', 10);
const TOP_COUNT = parseInt(__ENV.TOP_COUNT || '10', 10);

const loginFailures = new Counter('login_failures');
const businessFailures = new Counter('business_failures');
const portalFlowSuccess = new Rate('portal_flow_success');
const challengeFetchDuration = new Trend('challenge_fetch_duration', true);
const scoreboardDuration = new Trend('scoreboard_duration', true);

const tokenByVu = {};
const accountByVu = {};

function parseAccountsCsv(content) {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

    if (lines.length < 2) {
        throw new Error('accounts.csv must include header + at least 1 account');
    }

    const header = lines[0].split(',').map((value) => value.trim().toLowerCase());
    const usernameIdx = header.indexOf('username');
    const passwordIdx = header.indexOf('password');

    if (usernameIdx === -1 || passwordIdx === -1) {
        throw new Error('accounts.csv header must include username,password');
    }

    const accounts = [];
    for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((value) => value.trim());
        const username = cols[usernameIdx] || '';
        const password = cols[passwordIdx] || '';
        if (!username || !password) {
            continue;
        }
        accounts.push({ username, password });
    }

    if (accounts.length === 0) {
        throw new Error('accounts.csv does not contain valid account rows');
    }

    return accounts;
}

const accounts = new SharedArray('contestant_accounts', () => {
    const raw = open(ACCOUNTS_CSV);
    return parseAccountsCsv(raw);
});

function buildUrl(path) {
    if (!path.startsWith('/')) {
        return `${BASE_URL}/${path}`;
    }
    return `${BASE_URL}${path}`;
}

function jsonOrNull(response) {
    try {
        return response.json();
    } catch (_) {
        return null;
    }
}

function getVuNumber() {
    const vuId = exec.vu.idInTest;
    if (!vuId || vuId < 1) {
        throw new Error('Cannot resolve VU id from execution context');
    }
    return vuId;
}

function getVuAccount() {
    const vuNumber = getVuNumber();
    if (accountByVu[vuNumber]) {
        return accountByVu[vuNumber];
    }

    const account = accounts[(vuNumber - 1) % accounts.length];
    accountByVu[vuNumber] = account;
    return account;
}

function authHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

function login(account) {
    const res = http.post(
        buildUrl('/api/Auth/login-contestant'),
        JSON.stringify({ username: account.username, password: account.password }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    const ok = check(res, {
        'login status 200': (r) => r.status === 200,
    });

    if (!ok) {
        loginFailures.add(1);
        return null;
    }

    const body = jsonOrNull(res);
    if (!body || !body.generatedToken) {
        loginFailures.add(1);
        return null;
    }

    return body.generatedToken;
}

function ensureToken() {
    const vuNumber = getVuNumber();
    if (tokenByVu[vuNumber]) {
        return tokenByVu[vuNumber];
    }

    const account = getVuAccount();
    const token = login(account);
    if (!token) {
        return null;
    }

    tokenByVu[vuNumber] = token;
    return token;
}

function pickCategoryName(topicsBody) {
    if (!topicsBody || !Array.isArray(topicsBody.data) || topicsBody.data.length === 0) {
        return null;
    }

    const index = Math.floor(Math.random() * topicsBody.data.length);
    const topic = topicsBody.data[index];
    return topic?.name || topic?.category || null;
}

function executePortalFlow(token) {
    const headers = authHeaders(token);
    let allChecksPass = true;

    const profileRes = http.get(buildUrl('/api/Users/profile'), { headers });
    allChecksPass =
        check(profileRes, {
            'profile status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const configRes = http.get(buildUrl('/api/Config/get_date_config'), { headers });
    allChecksPass =
        check(configRes, {
            'config status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const topicsRes = http.get(buildUrl('/api/Challenge/by-topic'), { headers });
    challengeFetchDuration.add(topicsRes.timings.duration);
    allChecksPass =
        check(topicsRes, {
            'challenge topics status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const topicsBody = jsonOrNull(topicsRes);
    const categoryName = pickCategoryName(topicsBody);

    if (categoryName) {
        const listRes = http.get(
            buildUrl(`/api/Challenge/list_challenge/${encodeURIComponent(categoryName)}`),
            { headers }
        );

        allChecksPass =
            check(listRes, {
                'list challenge status 200': (r) => r.status === 200,
            }) && allChecksPass;

        const listBody = jsonOrNull(listRes);
        if (listBody && Array.isArray(listBody.data) && listBody.data.length > 0) {
            const challengeId = listBody.data[Math.floor(Math.random() * listBody.data.length)]?.id;
            if (challengeId) {
                const detailRes = http.get(buildUrl(`/api/Challenge/${challengeId}`), { headers });
                allChecksPass =
                    check(detailRes, {
                        'challenge detail status valid': (r) => r.status >= 200 && r.status < 500,
                    }) && allChecksPass;
            }
        }
    }

    const teamScoreRes = http.get(buildUrl('/api/Team/contestant'), { headers });
    allChecksPass =
        check(teamScoreRes, {
            'team score status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const teamSolvesRes = http.get(buildUrl('/api/Team/solves'), { headers });
    allChecksPass =
        check(teamSolvesRes, {
            'team solves status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const ticketListRes = http.get(buildUrl('/api/Ticket/tickets-user'), { headers });
    allChecksPass =
        check(ticketListRes, {
            'ticket list status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const scoreboardRes = http.get(buildUrl(`/api/Scoreboard/top/${TOP_COUNT}`));
    scoreboardDuration.add(scoreboardRes.timings.duration);
    allChecksPass =
        check(scoreboardRes, {
            'scoreboard status 200': (r) => r.status === 200,
        }) && allChecksPass;

    if (!allChecksPass) {
        businessFailures.add(1);
    }
    portalFlowSuccess.add(allChecksPass);
}

export const options = {
    scenarios: {
        contestant_portal_1h_500_accounts: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '5m', target: TARGET_VUS },
                { duration: '50m', target: TARGET_VUS },
                { duration: '5m', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<1500', 'p(99)<3000'],
        checks: ['rate>0.95'],
        portal_flow_success: ['rate>0.90'],
        login_failures: ['count<50'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
    if (accounts.length < TARGET_VUS) {
        throw new Error(
            `Need at least ${TARGET_VUS} accounts in ${ACCOUNTS_CSV}, found ${accounts.length}`
        );
    }

    return {
        accountCount: accounts.length,
    };
}

export default function () {
    const token = ensureToken();
    if (!token) {
        sleep(1 + Math.random() * 2);
        return;
    }

    executePortalFlow(token);

    // Think time to simulate real contestant behavior.
    sleep(1 + Math.random() * 3);
}

export function handleSummary(data) {
    return {
        stdout: JSON.stringify(
            {
                message: 'k6 run complete',
                metrics: {
                    http_req_duration: data.metrics.http_req_duration,
                    http_req_failed: data.metrics.http_req_failed,
                    checks: data.metrics.checks,
                    portal_flow_success: data.metrics.portal_flow_success,
                    login_failures: data.metrics.login_failures,
                    business_failures: data.metrics.business_failures,
                    challenge_fetch_duration: data.metrics.challenge_fetch_duration,
                    scoreboard_duration: data.metrics.scoreboard_duration,
                },
            },
            null,
            2
        ),
    };
}
