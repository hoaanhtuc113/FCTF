import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildGatewayUrl,
  requireEnv,
  establishAuthCookieWithQueryKey,
} from './gateway_helpers.js';

const resilienceUnexpected = new Counter('gateway_resilience_unexpected');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate>0.95'],
    gateway_resilience_unexpected: ['count==0'],
    http_req_failed: ['rate<0.25'],
  },
};

function assertResult(ok) {
  if (!ok) {
    resilienceUnexpected.add(1);
  }
}

export default function () {
  group('broken upstream should return controlled error', () => {
    const brokenToken = requireEnv('BROKEN_TOKEN');
    const bootstrap = establishAuthCookieWithQueryKey(brokenToken, protectedPath, 'token');

    assertResult(check(bootstrap, {
      'broken route bootstrap still redirects': (s) => s.bootstrapStatus === 302,
      'broken route bootstrap sets cookie': (s) => !!s.cookieHeader,
    }));

    const proxied = http.get(buildGatewayUrl(`${protectedPath}?broken_probe=1`), {
      headers: { Cookie: bootstrap.cookieHeader },
      redirects: 0,
      tags: { endpoint: 'broken_upstream_probe' },
    });

    assertResult(check(proxied, {
      'broken upstream returns 502': (r) => r.status === 502,
    }));
  });

  group('gateway health remains up after upstream error', () => {
    const health = http.get(buildGatewayUrl('/healthz'), {
      tags: { endpoint: 'health_after_error' },
    });

    assertResult(check(health, {
      'health still returns 200': (r) => r.status === 200,
    }));
  });
}
