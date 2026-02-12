import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildGatewayUrl,
  parseEnvInt,
  requireEnv,
  establishAuthCookie,
  buildRandomBody,
} from './gateway_helpers.js';

const bodyLimitUnexpected = new Counter('gateway_body_limit_unexpected');

const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const maxBodyBytes = parseEnvInt('HTTP_MAX_BODY_BYTES_EXPECTED', 10 * 1024 * 1024);
const smallBodyBytes = Math.max(128, parseEnvInt('SMALL_BODY_BYTES', 2048));
const bigBodyBytes = Math.max(maxBodyBytes + 1024, parseEnvInt('BIG_BODY_BYTES', maxBodyBytes + 1024));

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate>0.95'],
    gateway_body_limit_unexpected: ['count==0'],
    http_req_failed: ['rate<0.3'],
  },
};

function track(ok) {
  if (!ok) {
    bodyLimitUnexpected.add(1);
  }
}

export default function () {
  const validToken = requireEnv('VALID_TOKEN');
  const bootstrap = establishAuthCookie(validToken, protectedPath);

  track(check(bootstrap, {
    'bootstrap cookie available': (s) => !!s.cookieHeader,
  }));

  group('small body should pass gateway body-size check', () => {
    const payload = buildRandomBody(smallBodyBytes);
    const res = http.post(buildGatewayUrl(`${protectedPath}?small_body=1`), payload, {
      headers: {
        Cookie: bootstrap.cookieHeader,
        'Content-Type': 'application/octet-stream',
      },
      tags: { endpoint: 'small_body' },
    });

    track(check(res, {
      'small body is not rejected with 413': (r) => r.status !== 413,
      'small body not unauthorized': (r) => r.status !== 401,
    }));
  });

  group('large body should be rejected with 413', () => {
    const payload = buildRandomBody(bigBodyBytes);
    const res = http.post(buildGatewayUrl(`${protectedPath}?big_body=1`), payload, {
      headers: {
        Cookie: bootstrap.cookieHeader,
        'Content-Type': 'application/octet-stream',
      },
      tags: { endpoint: 'big_body' },
    });

    track(check(res, {
      'large body returns 413': (r) => r.status === 413,
    }));
  });
}
