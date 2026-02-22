import http from 'k6/http';
import { check, group } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildGatewayUrl } from './gateway_helpers.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const securityUnexpected = new Counter('gateway_security_unexpected');
const authBypassRate = new Rate('gateway_auth_bypass_rate');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';

const tokenFuzzCases = [
  '',
  'a',
  '....',
  'not-base64.not-base64',
  'abc.def',
  'a'.repeat(200),
  '../etc/passwd',
  '%00.%00',
  'eyJmb28iOiJiYXIifQ.invalid-signature',
];

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate>0.95'],
    gateway_security_unexpected: ['count==0'],
    gateway_auth_bypass_rate: ['rate==0'],
    http_req_failed: ['rate<0.2'],
  },
};

function countIfFail(ok) {
  if (!ok) {
    securityUnexpected.add(1);
  }
}

export default function () {
  group('token fuzzing should not bypass auth', () => {
    tokenFuzzCases.forEach((candidate, idx) => {
      const queryToken = encodeURIComponent(candidate);
      const res = http.get(buildGatewayUrl(`${protectedPath}?token=${queryToken}&case=${idx}`), {
        redirects: 0,
        tags: { endpoint: 'security_fuzz' },
      });

      const bypassed = res.status >= 200 && res.status < 400;
      authBypassRate.add(bypassed);

      const ok = check(res, {
        [`fuzz token ${idx} is rejected`]: (r) => r.status === 401,
      });
      countIfFail(ok);
    });
  });

  group('malformed token aliases should fail', () => {
    ['t', 'access_token'].forEach((key) => {
      const malformed = 'malformed.token';
      const res = http.get(buildGatewayUrl(`${protectedPath}?${key}=${encodeURIComponent(malformed)}`), {
        redirects: 0,
        tags: { endpoint: 'security_alias_fuzz' },
      });

      const ok = check(res, {
        [`malformed ${key} rejected`]: (r) => r.status === 401,
      });
      countIfFail(ok);
    });
  });
}
