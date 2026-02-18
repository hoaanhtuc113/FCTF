import http from 'k6/http';
import { check, sleep } from 'k6';
import { buildUrl, getTestOptions, requireEnv } from './helpers.js';

export const options = getTestOptions();

export function setup() {
  // If a token is provided via env, use it (avoid calling /login at all)
  if (__ENV.TOKEN) {
    return { token: __ENV.TOKEN };
  }

  // Robust login with retries on 429 (rate limiting)
  const username = requireEnv('USERNAME');
  const password = requireEnv('PASSWORD');
  const maxRetries = 5;
  let attempt = 0;
  let token = null;

  while (attempt < maxRetries && !token) {
    attempt++;
    const res = http.post(
      buildUrl('/api/Auth/login-contestant'),
      JSON.stringify({ username, password }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (res.status === 200) {
      try {
        token = res.json().generatedToken;
        break;
      } catch (e) {
        console.error(`Setup login JSON parse error: ${e.message} body=${res.body}`);
        // don't retry JSON parse errors
        break;
      }
    }

    if (res.status === 429) {
      // Rate limited, backoff and retry
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // ms
      console.warn(`Login rate-limited (attempt ${attempt}/${maxRetries}), sleeping ${backoff}ms`);
      sleep(backoff / 1000);
      continue;
    }

    // Other errors: log and break
    console.error(`Setup login failed: status=${res.status} body=${res.body}`);
    break;
  }

  if (!token) {
    console.error('Setup login failed to obtain token after retries; set env TOKEN to bypass login');
  }

  return { token };
}

let _noTokenLogged = false;

export default function (data) {
  const token = data.token;
  if (!token) {
    // If no token, fallback to a safe public endpoint to avoid 401 floods
    if (!_noTokenLogged) {
      console.warn('No token obtained; falling back to public endpoint /api/Config/get_date_config. To test auth specifically, set TOKEN in .env');
      _noTokenLogged = true;
    }

    // Try config endpoint with a few retries to avoid transient rate-limits
    let configRes = null;
    const maxConfigRetries = 3;
    for (let i = 0; i < maxConfigRetries; i++) {
      configRes = http.get(buildUrl('/api/Config/get_date_config'));
      if (configRes.status === 200) break;
      // backoff
      sleep(0.5 * Math.pow(2, i));
    }

    if (!configRes || configRes.status !== 200) {
      if (!_noTokenLogged) {
        console.error(`Config endpoint failed after retries: status=${configRes ? configRes.status : 'no response'} body=${configRes ? configRes.body : ''}`);
      }
      sleep(1);
      return;
    }

    check(configRes, {
      'config status is 200': (r) => r.status === 200,
      'config body ok': (r) => {
        const ct = r.headers['Content-Type'] || r.headers['content-type'] || '';
        if (!ct.toLowerCase().includes('application/json')) {
          console.error(`Config response not JSON - status=${r.status} content-type=${ct} body=${r.body}`);
          return false;
        }
        try {
          const body = r.json();
          return body && body.isSuccess !== undefined;
        } catch (e) {
          console.error(`JSON parse error on config response: ${e.message} body=${r.body}`);
          return false;
        }
      },
    });

    sleep(1);
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Perform a lightweight authenticated read to validate token (safe for stress)
  const profileRes = http.get(buildUrl('/api/Users/profile'), { headers });
  check(profileRes, {
    'profile status is 200': (r) => r.status === 200,
    'profile returns data': (r) => {
      const ct = r.headers['Content-Type'] || r.headers['content-type'] || '';
      if (!ct.toLowerCase().includes('application/json')) {
        console.error(`Profile response not JSON - status=${r.status} content-type=${ct} body=${r.body}`);
        return false;
      }
      try {
        const body = r.json();
        return body && body.success && body.data;
      } catch (e) {
        console.error(`JSON parse error on profile response: ${e.message} body=${r.body}`);
        return false;
      }
    },
  });

  // Optional: occasionally test login endpoint at low rate to validate it (default 0 = disabled)
  const loginTestRate = (__ENV.LOGIN_TEST_RATE ? parseFloat(__ENV.LOGIN_TEST_RATE) : 0.0);
  if (loginTestRate > 0 && Math.random() < loginTestRate) {
    const username = requireEnv('USERNAME');
    const password = requireEnv('PASSWORD');
    const loginRes = http.post(
      buildUrl('/api/Auth/login-contestant'),
      JSON.stringify({ username, password }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Safe check but don't treat 429 as fatal here
    const ok = check(loginRes, {
      'login (occasional) status 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

    if (!ok) {
      console.error(`Occasional login returned unexpected status ${loginRes.status} body=${loginRes.body}`);
    }
  }

  sleep(1);
}
