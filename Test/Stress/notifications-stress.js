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

  // Test: Get all notifications
  const notificationsRes = http.get(buildUrl('/api/Notifications'), { headers });
  check(notificationsRes, {
    'get notifications status is 200': (r) => r.status === 200,
    'get notifications has success': (r) => {
      const body = r.json();
      return body && body.success !== undefined;
    },
  });

  sleep(1);
}
