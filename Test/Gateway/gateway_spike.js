import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import {
  buildGatewayUrl,
  parseEnvInt,
  requireEnv,
  establishAuthCookie,
  isUpstreamSuccessStatus,
} from './gateway_helpers.js';

const spikeBlockedRatio = new Rate('gateway_spike_blocked_ratio');
const spikeUpstream5xx = new Counter('gateway_spike_upstream_5xx');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const warmVus = parseEnvInt('SPIKE_WARM_VUS', 20);
const spikeVus = parseEnvInt('SPIKE_PEAK_VUS', 200);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: warmVus },
        { duration: '30s', target: warmVus },
        { duration: '10s', target: spikeVus },
        { duration: '60s', target: spikeVus },
        { duration: '20s', target: warmVus },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{scenario:spike}': ['p(95)<2500', 'p(99)<5000'],
    'http_req_failed{scenario:spike}': ['rate<0.15'],
    gateway_spike_upstream_5xx: ['count==0'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  const token = requireEnv('VALID_TOKEN');
  const auth = establishAuthCookie(token, protectedPath);
  if (!auth.cookieHeader) {
    throw new Error(`Cannot establish auth cookie for spike test. status=${auth.bootstrapStatus}`);
  }
  return auth;
}

export default function (auth) {
  const res = http.get(buildGatewayUrl(`${protectedPath}?spike=${__VU}-${__ITER}`), {
    headers: {
      Cookie: auth.cookieHeader,
      'X-FCTF-Spike': `probe-${__VU}-${__ITER}`,
    },
    tags: { endpoint: 'spike' },
  });

  if (res.status >= 500) {
    spikeUpstream5xx.add(1);
  }

  spikeBlockedRatio.add(res.status === 401 || res.status === 403 || res.status === 429);

  check(res, {
    'spike request accepted or gracefully limited': (r) => isUpstreamSuccessStatus(r.status) || r.status === 429,
  });
}
