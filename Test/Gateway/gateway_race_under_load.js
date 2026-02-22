import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
    buildGatewayUrl,
    parseEnvInt,
    parseEnvFloat,
    establishAuthCookie,
    isUpstreamSuccessStatus,
} from './gateway_helpers.js';

// We intentionally treat 4xx as expected responses, since upstream may return 404/405 depending on the challenge.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const raceUnexpected5xx = new Counter('gateway_race_unexpected_5xx');
const raceBurst429Ratio = new Trend('gateway_race_burst_429_ratio');
const raceBurstAcceptedRatio = new Trend('gateway_race_burst_accepted_ratio');
const raceBurstBlockedRatio = new Trend('gateway_race_burst_blocked_ratio');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';

const totalDurationSeconds = Math.max(15, parseEnvInt('RACE_TOTAL_DURATION_SECONDS', 45));
const backgroundRps = Math.max(0, parseEnvInt('RACE_BACKGROUND_RPS', 30));
const burstStartSeconds = Math.max(1, parseEnvInt('RACE_BURST_START_SECONDS', 10));

const burstVus = Math.max(1, parseEnvInt('RACE_BURST_VUS', 1));
const burstRequests = Math.max(2, parseEnvInt('RACE_BURST_REQUESTS', 20));
const burstRounds = Math.max(1, parseEnvInt('RACE_BURST_ROUNDS', 8));
const roundPauseMs = Math.max(0, parseEnvInt('RACE_ROUND_PAUSE_MS', 150));
const maxBurst429Ratio = Math.min(1, Math.max(0, parseEnvFloat('MAX_RACE_429_RATIO', 0.5)));

function parseTokenList(raw) {
    if (!raw) {
        return [];
    }
    return raw
        .split(/[\n,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

function resolveRaceTokens() {
    const csv = __ENV.RACE_TOKENS_CSV || __ENV.RACE_TOKENS || '';
    const tokens = parseTokenList(csv);
    if (tokens.length > 0) {
        return tokens;
    }
    const token = __ENV.VALID_TOKEN;
    if (token) {
        return [token];
    }
    throw new Error('Missing env var: VALID_TOKEN (or RACE_TOKENS_CSV for multi-team race simulation)');
}

function pickCookieHeader(auth) {
    const list = auth?.cookieHeaders;
    if (Array.isArray(list) && list.length > 0) {
        const idx = (__VU - 1) % list.length;
        return list[idx];
    }
    return auth?.cookieHeader || '';
}

export const options = {
    scenarios: {
        background: {
            executor: 'constant-arrival-rate',
            exec: 'background',
            rate: backgroundRps,
            timeUnit: '1s',
            duration: `${totalDurationSeconds}s`,
            preAllocatedVUs: Math.max(5, Math.min(60, backgroundRps)),
            maxVUs: Math.max(20, Math.min(200, backgroundRps * 4)),
        },
        race_burst: {
            executor: 'per-vu-iterations',
            exec: 'race_burst',
            vus: burstVus,
            iterations: burstRounds,
            maxDuration: `${totalDurationSeconds}s`,
            startTime: `${burstStartSeconds}s`,
        },
    },
    thresholds: {
        // Under load, allow some failure but prevent systemic errors.
        'http_req_failed{scenario:race_burst}': ['rate<0.2'],
        gateway_race_unexpected_5xx: ['count==0'],
        // “Race viability” heuristic: too many 429 during the burst means the gateway throttles the burst.
        gateway_race_burst_429_ratio: [`p(95)<${maxBurst429Ratio}`],
        // Ensure we still get a healthy amount of accepted responses in the burst.
        gateway_race_burst_accepted_ratio: ['avg>0.5'],
        checks: ['rate>0.95'],
    },
};

export function setup() {
    const tokens = resolveRaceTokens();
    const cookieHeaders = [];

    tokens.forEach((token) => {
        const auth = establishAuthCookie(token, protectedPath);
        if (!auth.cookieHeader) {
            throw new Error(`Cannot establish auth cookie for race-under-load test. status=${auth.bootstrapStatus}`);
        }
        cookieHeaders.push(auth.cookieHeader);
    });

    return {
        cookieHeaders,
        tokenCount: cookieHeaders.length,
    };
}

export function handleSummary(data) {
    const outPath = __ENV.K6_SUMMARY_PATH;
    if (!outPath) {
        return {};
    }
    return {
        [outPath]: JSON.stringify(data, null, 2),
    };
}

function recordResponse(res) {
    if (!res) {
        return;
    }
    if (res.status >= 500) {
        raceUnexpected5xx.add(1);
    }
}

export function background(auth) {
    const cookieHeader = pickCookieHeader(auth);
    const res = http.get(buildGatewayUrl(`${protectedPath}?bg=1`), {
        headers: {
            Cookie: cookieHeader,
            'X-FCTF-Test-Case': 'race_under_load_background',
        },
        tags: { endpoint: 'race_bg', name: 'race_bg' },
    });

    recordResponse(res);

    check(res, {
        'background request accepted or gracefully limited': (r) => isUpstreamSuccessStatus(r.status) || r.status === 429,
    });
}

export function race_burst(auth) {
    const cookieHeader = pickCookieHeader(auth);
    const round = __ITER;
    const url = buildGatewayUrl(`${protectedPath}?race=1&round=${round}`);

    const reqs = [];
    for (let i = 0; i < burstRequests; i++) {
        reqs.push({
            method: 'GET',
            url,
            params: {
                headers: {
                    Cookie: cookieHeader,
                    'X-FCTF-Test-Case': 'race_under_load_burst',
                    'X-FCTF-Race-Round': String(round),
                },
                // Keep tag cardinality low.
                tags: { endpoint: 'race_burst', name: 'race_burst' },
                timeout: '15s',
            },
        });
    }

    const responses = http.batch(reqs);

    let burst429 = 0;
    let burstAccepted = 0;
    let burstBlocked = 0;

    responses.forEach((res) => {
        recordResponse(res);
        if (res.status === 429) {
            burst429++;
        }
        if (res.status === 401 || res.status === 403 || res.status === 429) {
            burstBlocked++;
        }
        if (res.status !== 429 && isUpstreamSuccessStatus(res.status)) {
            burstAccepted++;
        }
    });

    raceBurst429Ratio.add(burst429 / responses.length);
    raceBurstBlockedRatio.add(burstBlocked / responses.length);
    raceBurstAcceptedRatio.add(burstAccepted / responses.length);

    check({ burst429, burstAccepted }, {
        'burst had at least one accepted response': () => burstAccepted > 0,
        'burst is not fully throttled': () => burst429 < responses.length,
    });

    sleep(roundPauseMs / 1000);
}
