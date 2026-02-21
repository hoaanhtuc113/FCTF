import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import {
  buildGatewayUrl,
  parseEnvInt,
  establishAuthCookie,
  isUpstreamSuccessStatus,
  requireEnv,
} from './gateway_helpers.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const blockedRate = new Rate('gateway_blocked_ratio');
const upstreamErrors = new Counter('gateway_upstream_5xx');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const duration = __ENV.DURATION || '2m';
const requestRate = parseEnvInt('REQUEST_RATE', 50);
const preAllocated = parseEnvInt('PRE_ALLOCATED_VUS', 30);
const maxVUs = parseEnvInt('MAX_VUS', 120);
const assertEcho = (__ENV.ASSERT_ECHO || 'false').toLowerCase() === 'true';

export const options = {
  scenarios: {
    passthrough: {
      executor: 'constant-arrival-rate',
      rate: requestRate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs: preAllocated,
      maxVUs,
    },
  },
  thresholds: {
    'http_req_duration{scenario:passthrough}': ['p(95)<1200', 'p(99)<2500'],
    'http_req_failed{scenario:passthrough}': ['rate<0.05'],
    gateway_blocked_ratio: ['rate<0.02'],
    gateway_upstream_5xx: ['count==0'],
    checks: ['rate>0.98'],
  },
};

export function setup() {
  const validToken = requireEnv('VALID_TOKEN');
  const auth = establishAuthCookie(validToken, protectedPath);
  if (!auth.cookieHeader) {
    throw new Error(`Cannot establish auth cookie. status=${auth.bootstrapStatus}`);
  }
  return auth;
}

function pickPayload(iteration) {
  const payloads = [
    { method: 'GET', path: `${protectedPath}?q=%3Csvg%2Fonload%3Dalert(1)%3E&n=${iteration}` },
    { method: 'GET', path: `${protectedPath}?q=';WAITFOR DELAY '0:0:01'--&n=${iteration}` },
    {
      method: 'POST',
      path: `${protectedPath}?mode=json&n=${iteration}`,
      body: JSON.stringify({ probe: `<img src=x onerror=alert('xss-${iteration}')>`, seq: iteration }),
    },
    {
      method: 'POST',
      path: `${protectedPath}?mode=form&n=${iteration}`,
      body: `input=%27%20OR%201%3D1--&tag=race-${iteration}`,
      contentType: 'application/x-www-form-urlencoded',
    },
  ];
  return payloads[iteration % payloads.length];
}

export default function (auth) {
  const current = pickPayload(__ITER);
  const headers = {
    Cookie: auth.cookieHeader,
    'X-FCTF-Test-Case': `passthrough-${__VU}-${__ITER}`,
  };

  let response;
  if (current.method === 'GET') {
    response = http.get(buildGatewayUrl(current.path), {
      headers,
      tags: { endpoint: 'passthrough_get' },
    });
  } else {
    headers['Content-Type'] = current.contentType || 'application/json';
    response = http.post(buildGatewayUrl(current.path), current.body || '', {
      headers,
      tags: { endpoint: 'passthrough_post' },
    });
  }

  const blocked = response.status === 401 || response.status === 403 || response.status === 429;
  blockedRate.add(blocked);

  if (response.status >= 500) {
    upstreamErrors.add(1);
  }

  check(response, {
    'gateway allows exploit-like traffic': (r) => isUpstreamSuccessStatus(r.status) || r.status === 429,
  });

  if (assertEcho && current.body) {
    check(response, {
      'echo upstream returns submitted marker': (r) => r.body && r.body.includes('race-'),
    });
  }
}
