import http from 'k6/http';
import { check, sleep } from 'k6';
import { buildUrl, getAuthHeaders, loginAndGetToken, getTestOptions } from './helpers.js';

export const options = getTestOptions();

let token;

export function setup() {
  token = loginAndGetToken();
  return { token };
}

export default function (data) {
  const token = data.token;
  const headers = getAuthHeaders(token);

  // Test: Get user profile
  const profileRes = http.get(buildUrl('/api/Users/profile'), { headers });
  check(profileRes, {
    'get profile status is 200': (r) => r.status === 200,
    'get profile has data': (r) => {
      const body = r.json();
      return body && body.success && body.data;
    },
  });

  sleep(1);
}
