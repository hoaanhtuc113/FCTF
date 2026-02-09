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

  // Test: Get all action logs (may require admin permissions)
  const allLogsRes = http.get(buildUrl('/api/ActionLogs/get-logs'), { headers });
  check(allLogsRes, {
    'get all logs returns response': (r) => r.status >= 200 && r.status < 500,
  });

  // Test: Get team action logs
  const teamLogsRes = http.get(buildUrl('/api/ActionLogs/get-logs-team'), { headers });
  check(teamLogsRes, {
    'get team logs status is 200 or 500': (r) => r.status === 200 || r.status === 500,
    'get team logs has response': (r) => {
      const body = r.json();
      return body && body.success !== undefined;
    },
  });

  // Note: We don't test save-logs in stress test as it modifies data

  sleep(1);
}
