import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import {
  buildGatewayUrl,
  parseEnvInt,
  parseEnvFloat,
  establishAuthCookie,
  requireEnv,
} from './gateway_helpers.js';

const rateLimitSeen = new Rate('gateway_rate_limit_seen');
const unexpected5xx = new Counter('gateway_rl_unexpected_5xx');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const vus = parseEnvInt('RATE_LIMIT_VUS', 200);
const duration = __ENV.RATE_LIMIT_DURATION || '20s';
const min429Ratio = parseEnvFloat('MIN_429_RATIO', 0.05);

export const options = {
  scenarios: {
    ratelimit: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    'http_req_failed{scenario:ratelimit}': ['rate<0.3'],
    gateway_rate_limit_seen: [`rate>${min429Ratio}`],
    gateway_rl_unexpected_5xx: ['count==0'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  const validToken = requireEnv('VALID_TOKEN');
  const auth = establishAuthCookie(validToken, protectedPath);
  if (!auth.cookieHeader) {
    throw new Error(`Cannot establish auth cookie for rate limit test. status=${auth.bootstrapStatus}`);
  }
  return auth;
}

export default function (auth) {
  const res = http.get(buildGatewayUrl(`${protectedPath}?rl=${__VU}-${__ITER}`), {
    headers: { Cookie: auth.cookieHeader },
    tags: { endpoint: 'ratelimit' },
  });

  const got429 = res.status === 429;
  rateLimitSeen.add(got429);

  if (res.status >= 500) {
    unexpected5xx.add(1);
  }

  check(res, {
    'response is expected family': (r) => [200, 302, 401, 403, 404, 429].includes(r.status) || (r.status >= 200 && r.status < 500),
  });
}
