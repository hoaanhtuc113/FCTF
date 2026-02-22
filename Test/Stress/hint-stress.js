import http from 'k6/http';
import { check, sleep } from 'k6';
import { buildUrl, getAuthHeaders, loginAndGetToken, getTestOptions } from './helpers.js';

export const options = getTestOptions();

let token;

export function setup() {
  token = loginAndGetToken();
  // Get a challenge ID to test hints
  const headers = getAuthHeaders(token);
  
  const topicsRes = http.get(buildUrl('/api/Challenge/by-topic'), { headers });
  let challengeId = null;
  
  if (topicsRes.status === 200) {
    const topicsBody = topicsRes.json();
    if (topicsBody.data && topicsBody.data.length > 0) {
      const categoryName = topicsBody.data[0].name || topicsBody.data[0].category;
      const challengesRes = http.get(
        buildUrl(`/api/Challenge/list_challenge/${encodeURIComponent(categoryName)}`),
        { headers }
      );
      
      if (challengesRes.status === 200) {
        const challengesBody = challengesRes.json();
        if (challengesBody.data && challengesBody.data.length > 0) {
          challengeId = challengesBody.data[0].id;
        }
      }
    }
  }
  
  return { token, challengeId };
}

export default function (data) {
  const token = data.token;
  const challengeId = data.challengeId;
  const headers = getAuthHeaders(token);

  if (!challengeId) {
    console.log('No challenge ID available, skipping hint tests');
    sleep(1);
    return;
  }

  // Test: Get hints by challenge ID
  const hintsRes = http.get(
    buildUrl(`/api/Hint/${challengeId}/all`),
    { headers }
  );
  
  const hintsSuccess = check(hintsRes, {
    'get hints status is 200': (r) => r.status === 200,
    'get hints has data': (r) => {
      const body = r.json();
      return body && body.success;
    },
  });

  let hintId = null;
  if (hintsSuccess) {
    const hintsBody = hintsRes.json();
    if (hintsBody.hints && hintsBody.hints.length > 0) {
      hintId = hintsBody.hints[0].id;
    }
  }

  // Test: Get hint by ID with preview
  if (hintId) {
    const hintRes = http.get(
      buildUrl(`/api/Hint/${hintId}?preview=true`),
      { headers }
    );
    
    check(hintRes, {
      'get hint preview status is 200': (r) => r.status === 200,
    });
  }

  // Note: We don't test unlock in stress test as it costs points and modifies state

  sleep(1);
}
