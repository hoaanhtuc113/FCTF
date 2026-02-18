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

  // Test: Get challenges by topic
  const topicsRes = http.get(buildUrl('/api/Challenge/by-topic'), { headers });
  const topicsSuccess = check(topicsRes, {
    'get topics status is 200': (r) => r.status === 200,
    'get topics has data': (r) => {
      const body = r.json();
      return body && body.data;
    },
  });

  let categoryName = null;
  let challengeId = null;

  if (topicsSuccess) {
    const topicsBody = topicsRes.json();
    if (topicsBody.data && topicsBody.data.length > 0) {
      // Get first category
      const firstTopic = topicsBody.data[0];
      categoryName = firstTopic.name || firstTopic.category;
    }
  }

  // Test: List challenges by category
  if (categoryName) {
    const challengesRes = http.get(
      buildUrl(`/api/Challenge/list_challenge/${encodeURIComponent(categoryName)}`),
      { headers }
    );
    
    const challengesSuccess = check(challengesRes, {
      'list challenges status is 200': (r) => r.status === 200,
      'list challenges has data': (r) => {
        const body = r.json();
        return body && body.data;
      },
    });

    if (challengesSuccess) {
      const challengesBody = challengesRes.json();
      if (challengesBody.data && challengesBody.data.length > 0) {
        challengeId = challengesBody.data[0].id;
      }
    }
  }

  // Test: Get challenge by ID
  if (challengeId) {
    const challengeRes = http.get(
      buildUrl(`/api/Challenge/${challengeId}`),
      { headers }
    );
    
    check(challengeRes, {
      'get challenge status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  }

  // Test: Get team's challenge instances
  const instancesRes = http.get(buildUrl('/api/Challenge/instances'), { headers });
  check(instancesRes, {
    'get instances status is 200': (r) => r.status === 200,
  });

  // Test: Check challenge status (if we have a challengeId)
  if (challengeId) {
    const statusRes = http.post(
      buildUrl('/api/Challenge/check-status'),
      JSON.stringify({ challengeId }),
      { headers }
    );
    
    check(statusRes, {
      'check status returns response': (r) => r.status >= 200 && r.status < 500,
    });
  }

  // Note: We don't test start/stop/attempt in stress test as they modify state
  // Those should be tested in integration tests

  sleep(1);
}
