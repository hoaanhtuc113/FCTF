import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildGatewayUrl,
  requireEnv,
  establishAuthCookie,
  isUpstreamSuccessStatus,
} from './gateway_helpers.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const authUnexpected = new Counter('gateway_auth_unexpected');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const invalidToken = __ENV.INVALID_TOKEN || 'invalid.token';
const expiredToken = __ENV.EXPIRED_TOKEN || '';
const assertEcho = (__ENV.ASSERT_ECHO || 'false').toLowerCase() === 'true';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate>0.95'],
    http_req_failed: ['rate<0.2'],
    gateway_auth_unexpected: ['count==0'],
  },
};

function expectStatus(res, expectedStatus, label) {
  const ok = check(res, {
    [`${label} status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
  });
  if (!ok) {
    authUnexpected.add(1);
  }
}

export default function () {
  const validToken = requireEnv('VALID_TOKEN');

  group('health endpoint', () => {
    const health = http.get(buildGatewayUrl('/healthz'));
    expectStatus(health, 200, 'healthz');
  });

  group('auth failure paths', () => {
    const missing = http.get(buildGatewayUrl(protectedPath), { redirects: 0 });
    expectStatus(missing, 401, 'missing token');

    const withInvalid = http.get(
      buildGatewayUrl(`${protectedPath}?token=${encodeURIComponent(invalidToken)}`),
      { redirects: 0 }
    );
    expectStatus(withInvalid, 401, 'invalid token');

    if (expiredToken) {
      const withExpired = http.get(
        buildGatewayUrl(`${protectedPath}?token=${encodeURIComponent(expiredToken)}`),
        { redirects: 0 }
      );
      expectStatus(withExpired, 401, 'expired token');
    }
  });

  group('valid token redirect and cookie', () => {
    const bootstrap = establishAuthCookie(validToken, protectedPath);

    check(bootstrap, {
      'bootstrap returns 302': (s) => s.bootstrapStatus === 302,
      'bootstrap has auth cookie': (s) => !!s.cookieHeader,
      'redirect location strips token': (s) => s.location && !/(?:[?&])token=/.test(s.location),
    }) || authUnexpected.add(1);

    const marker = `<script>alert('fctf')</script>-race-${Date.now()}`;
    const payload = JSON.stringify({
      marker,
      sql: "' OR 1=1 --",
      cmd: ';sleep 0.2;#',
    });

    const proxied = http.post(
      buildGatewayUrl(`${protectedPath}?probe=payload`),
      payload,
      {
        headers: {
          Cookie: bootstrap.cookieHeader,
          'Content-Type': 'application/json',
          'X-FCTF-Probe': marker,
        },
        tags: { endpoint: 'auth_flow_post' },
      }
    );

    check(proxied, {
      'proxied request is accepted by gateway': (r) => isUpstreamSuccessStatus(r.status),
    }) || authUnexpected.add(1);

    if (assertEcho) {
      check(proxied, {
        'upstream received exploit marker': (r) => r.body && r.body.includes(marker),
      }) || authUnexpected.add(1);
    }
  });
}
