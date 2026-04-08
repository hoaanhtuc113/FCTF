import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const ACCOUNTS_CSV = __ENV.ACCOUNTS_CSV || './accounts.csv';
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || '500', 10);
const TOP_COUNT = parseInt(__ENV.TOP_COUNT || '10', 10);
const ATTEMPT_RATE = Number(__ENV.ATTEMPT_RATE || '0.2');
const FORCE_CHALLENGE_ID = parseInt(__ENV.FORCE_CHALLENGE_ID || '0', 10);
const QUICK_TEST = (__ENV.QUICK_TEST || 'false').toLowerCase() === 'true';
const QUICK_STAGE_1_TARGET = Math.max(1, Math.floor(TARGET_VUS * 0.2));
const QUICK_STAGE_2_TARGET = Math.max(QUICK_STAGE_1_TARGET, Math.floor(TARGET_VUS * 0.5));

const loginFailures = new Counter('login_failures');
const businessFailures = new Counter('business_failures');
const portalFlowSuccess = new Rate('portal_flow_success');
const challengeFetchDuration = new Trend('challenge_fetch_duration', true);
const scoreboardDuration = new Trend('scoreboard_duration', true);
const leaderboardQueryDuration = new Trend('leaderboard_query_duration', true);
const submissionHistoryDuration = new Trend('submission_history_duration', true);
const challengeInfoDuration = new Trend('challenge_info_duration', true);
const scoreUpdatePathDuration = new Trend('score_update_path_duration', true);
const submissionAttemptCount = new Counter('submission_attempt_count');
const submissionAttemptAccepted = new Rate('submission_attempt_accepted');

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
    let selectedChallengeId = null;

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
                selectedChallengeId = challengeId;
            }
        }
    }

    const challengeIdForDetail = selectedChallengeId || (FORCE_CHALLENGE_ID > 0 ? FORCE_CHALLENGE_ID : null);
    if (challengeIdForDetail) {
        const detailRes = http.get(buildUrl(`/api/Challenge/${challengeIdForDetail}`), { headers });
        challengeInfoDuration.add(detailRes.timings.duration);
        allChecksPass =
            check(detailRes, {
                'challenge detail status valid': (r) => r.status >= 200 && r.status < 500,
            }) && allChecksPass;
    }

    const teamScoreRes = http.get(buildUrl('/api/Team/contestant'), { headers });
    allChecksPass =
        check(teamScoreRes, {
            'team score status 200': (r) => r.status === 200,
        }) && allChecksPass;

    const teamSolvesRes = http.get(buildUrl('/api/Team/solves'), { headers });
    submissionHistoryDuration.add(teamSolvesRes.timings.duration);
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
    leaderboardQueryDuration.add(scoreboardRes.timings.duration);
    allChecksPass =
        check(scoreboardRes, {
            'scoreboard status 200': (r) => r.status === 200,
        }) && allChecksPass;

    // Submit flow exercises submission writes and score update path under load.
    const challengeIdForAttempt = selectedChallengeId || (FORCE_CHALLENGE_ID > 0 ? FORCE_CHALLENGE_ID : null);
    if (challengeIdForAttempt && Math.random() < ATTEMPT_RATE) {
        submissionAttemptCount.add(1);
        const attemptRes = http.post(
            buildUrl('/api/Challenge/attempt'),
            JSON.stringify({
                challengeId: challengeIdForAttempt,
                submission: `loadtest-${exec.vu.idInTest}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            }),
            { headers }
        );

        scoreUpdatePathDuration.add(attemptRes.timings.duration);
        const attemptOk = check(attemptRes, {
            'attempt status accepted': (r) =>
                r.status === 200 || r.status === 400 || r.status === 403 || r.status === 404 || r.status === 429,
        });
        submissionAttemptAccepted.add(attemptOk);
        allChecksPass = attemptOk && allChecksPass;
    }

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
            stages: QUICK_TEST
                ? [
                    { duration: '30s', target: QUICK_STAGE_1_TARGET },
                    { duration: '30s', target: QUICK_STAGE_2_TARGET },
                    { duration: '30s', target: TARGET_VUS },
                    { duration: '2m', target: TARGET_VUS },
                    { duration: '30s', target: QUICK_STAGE_2_TARGET },
                    { duration: '30s', target: QUICK_STAGE_1_TARGET },
                    { duration: '30s', target: 0 },
                ]
                : [
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
                    leaderboard_query_duration: data.metrics.leaderboard_query_duration,
                    submission_history_duration: data.metrics.submission_history_duration,
                    challenge_info_duration: data.metrics.challenge_info_duration,
                    score_update_path_duration: data.metrics.score_update_path_duration,
                    submission_attempt_count: data.metrics.submission_attempt_count,
                    submission_attempt_accepted: data.metrics.submission_attempt_accepted,
                },
            },
            null,
            2
        ),
    };
}
