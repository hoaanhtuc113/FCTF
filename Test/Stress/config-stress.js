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

  // Test: Get date config
  const configRes = http.get(buildUrl('/api/Config/get_date_config'), { headers });
  check(configRes, {
    'get date config status is 200': (r) => r.status === 200,
    'get date config has isSuccess': (r) => {
      const body = r.json();
      return body && body.isSuccess !== undefined;
    },
  });

  sleep(1);
}
