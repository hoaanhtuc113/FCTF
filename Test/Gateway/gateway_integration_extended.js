import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildGatewayUrl,
  requireEnv,
  establishAuthCookieWithQueryKey,
  establishAuthCookieWithPathToken,
  isUpstreamSuccessStatus,
} from './gateway_helpers.js';

const integrationUnexpected = new Counter('gateway_integration_unexpected');

const validToken = () => requireEnv('VALID_TOKEN');
const protectedPath = __ENV.PROTECTED_PATH || '/anything/fctf-gateway';
const authCookieName = __ENV.AUTH_COOKIE_NAME || 'FCTF_Auth_Token';
const strictEcho = (__ENV.STRICT_ECHO || 'false').toLowerCase() === 'true';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate>0.95'],
    gateway_integration_unexpected: ['count==0'],
    http_req_failed: ['rate<0.2'],
  },
};

function assertOrCount(result) {
  if (!result) {
    integrationUnexpected.add(1);
  }
}

function validateBootstrap(bootstrap, label) {
  const ok = check(bootstrap, {
    [`${label} returns 302`]: (s) => s.bootstrapStatus === 302,
    [`${label} sets auth cookie`]: (s) => !!s.cookieHeader,
    [`${label} redirect strips token`]: (s) => s.location && !s.location.includes('token='),
    [`${label} redirect strips access_token`]: (s) => s.location && !s.location.includes('access_token='),
    [`${label} redirect strips t`]: (s) => s.location && !s.location.includes('t='),
  });
  assertOrCount(ok);
}

export default function () {
  group('token aliases in query', () => {
    const tokenBootstrap = establishAuthCookieWithQueryKey(validToken(), protectedPath, 'token');
    validateBootstrap(tokenBootstrap, 'token alias');

    const tBootstrap = establishAuthCookieWithQueryKey(validToken(), protectedPath, 't');
    validateBootstrap(tBootstrap, 't alias');

    const accessBootstrap = establishAuthCookieWithQueryKey(validToken(), protectedPath, 'access_token');
    validateBootstrap(accessBootstrap, 'access_token alias');
  });

  group('token in path segment', () => {
    const pathBootstrap = establishAuthCookieWithPathToken(validToken(), protectedPath);
    validateBootstrap(pathBootstrap, 'path token');
  });

  group('gateway cookie stripping to upstream', () => {
    const bootstrap = establishAuthCookieWithQueryKey(validToken(), protectedPath, 'token');
    validateBootstrap(bootstrap, 'cookie strip bootstrap');

    const probeRes = http.get(buildGatewayUrl(`${protectedPath}?cookie_probe=1`), {
      headers: {
        Cookie: `${bootstrap.cookieHeader}; app_cookie=visible_for_upstream`,
      },
      tags: { endpoint: 'cookie_strip_probe' },
    });

    const probeAccepted = check(probeRes, {
      'cookie strip probe accepted by gateway': (r) => isUpstreamSuccessStatus(r.status),
    });
    assertOrCount(probeAccepted);

    if (probeRes.status >= 200 && probeRes.status < 500 && (strictEcho || probeRes.body?.includes('headers'))) {
      const body = probeRes.body || '';
      const authCookieLeaked = body.includes(authCookieName);
      const appCookieSeen = body.includes('app_cookie=visible_for_upstream');

      assertOrCount(check({ authCookieLeaked }, {
        'gateway auth cookie is not leaked upstream': (x) => x.authCookieLeaked === false,
      }));

      if (strictEcho) {
        assertOrCount(check({ appCookieSeen }, {
          'non-gateway cookie is kept': (x) => x.appCookieSeen === true,
        }));
      }
    }
  });
}
