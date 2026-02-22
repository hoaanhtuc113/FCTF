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

  // Test: Get team score
  const teamScoreRes = http.get(buildUrl('/api/Team/contestant'), { headers });
  check(teamScoreRes, {
    'get team score status is 200': (r) => r.status === 200,
    'get team score has data': (r) => {
      const body = r.json();
      return body && body.success && body.data;
    },
  });

  // Test: Get team solves
  const teamSolvesRes = http.get(buildUrl('/api/Team/solves'), { headers });
  check(teamSolvesRes, {
    'get team solves status is 200': (r) => r.status === 200,
    'get team solves has data': (r) => {
      const body = r.json();
      return body && body.success && body.data;
    },
  });

  sleep(1);
}
