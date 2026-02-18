import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildGatewayUrl,
  parseEnvInt,
  requireEnv,
  establishAuthCookie,
  isUpstreamSuccessStatus,
} from './gateway_helpers.js';

const soakUpstream5xx = new Counter('gateway_soak_upstream_5xx');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const soakVus = parseEnvInt('SOAK_VUS', 30);
const soakDuration = __ENV.SOAK_DURATION || '30m';
const thinkTimeMs = parseEnvInt('SOAK_THINK_TIME_MS', 150);

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: soakVus,
      duration: soakDuration,
    },
  },
  thresholds: {
    'http_req_duration{scenario:soak}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_failed{scenario:soak}': ['rate<0.05'],
    gateway_soak_upstream_5xx: ['count==0'],
    checks: ['rate>0.98'],
  },
};

export function setup() {
  const token = requireEnv('VALID_TOKEN');
  const auth = establishAuthCookie(token, protectedPath);
  if (!auth.cookieHeader) {
    throw new Error(`Cannot establish auth cookie for soak test. status=${auth.bootstrapStatus}`);
  }
  return auth;
}

export default function (auth) {
  const res = http.get(buildGatewayUrl(`${protectedPath}?soak=${__VU}-${__ITER}`), {
    headers: {
      Cookie: auth.cookieHeader,
      'X-FCTF-Soak': `${__VU}-${__ITER}`,
    },
    tags: { endpoint: 'soak' },
  });

  if (res.status >= 500) {
    soakUpstream5xx.add(1);
  }

  check(res, {
    'soak request stays in acceptable range': (r) => isUpstreamSuccessStatus(r.status) || r.status === 429,
  });

  sleep(Math.max(0, thinkTimeMs) / 1000);
}
