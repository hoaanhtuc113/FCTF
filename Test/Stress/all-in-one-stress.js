import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { buildUrl, getAuthHeaders, loginAndGetToken, getTestOptions } from './helpers.js';

export const options = getTestOptions();

let token;

export function setup() {
  token = loginAndGetToken();
  console.log('✓ Authentication successful');
  return { token };
}

export default function (data) {
  const token = data.token;
  const headers = getAuthHeaders(token);

  // Group 1: User Profile & Config
  group('User & Config APIs', function () {
    // Get user profile
    const profileRes = http.get(buildUrl('/api/Users/profile'), { headers });
    check(profileRes, {
      'profile status is 200': (r) => r.status === 200,
    });

    // Get config
    const configRes = http.get(buildUrl('/api/Config/get_date_config'), { headers });
    check(configRes, {
      'config status is 200': (r) => r.status === 200,
    });
  });

  // Group 2: Challenge APIs
  group('Challenge APIs', function () {
    // Get topics
    const topicsRes = http.get(buildUrl('/api/Challenge/by-topic'), { headers });
    const topicsSuccess = check(topicsRes, {
      'topics status is 200': (r) => r.status === 200,
    });

    let challengeId = null;
    if (topicsSuccess) {
      const topicsBody = topicsRes.json();
      if (topicsBody.data && topicsBody.data.length > 0) {
        const categoryName = topicsBody.data[0].name || topicsBody.data[0].category;
        
        // List challenges in category
        const challengesRes = http.get(
          buildUrl(`/api/Challenge/list_challenge/${encodeURIComponent(categoryName)}`),
          { headers }
        );
        check(challengesRes, {
          'list challenges status is 200': (r) => r.status === 200,
        });

        const challengesBody = challengesRes.json();
        if (challengesBody.data && challengesBody.data.length > 0) {
          challengeId = challengesBody.data[0].id;
        }
      }
    }

    // Get challenge instances
    const instancesRes = http.get(buildUrl('/api/Challenge/instances'), { headers });
    check(instancesRes, {
      'instances status is 200': (r) => r.status === 200,
    });

    // Get specific challenge if available
    if (challengeId) {
      const challengeRes = http.get(buildUrl(`/api/Challenge/${challengeId}`), { headers });
      check(challengeRes, {
        'get challenge returns response': (r) => r.status >= 200 && r.status < 500,
      });
    }
  });

  // Group 3: Team APIs
  group('Team APIs', function () {
    const teamScoreRes = http.get(buildUrl('/api/Team/contestant'), { headers });
    check(teamScoreRes, {
      'team score status is 200': (r) => r.status === 200,
    });

    const teamSolvesRes = http.get(buildUrl('/api/Team/solves'), { headers });
    check(teamSolvesRes, {
      'team solves status is 200': (r) => r.status === 200,
    });
  });

  // Group 4: Notifications & Tickets
  group('Notifications & Tickets', function () {
    const notificationsRes = http.get(buildUrl('/api/Notifications'), { headers });
    check(notificationsRes, {
      'notifications status is 200': (r) => r.status === 200,
    });

    const ticketsRes = http.get(buildUrl('/api/Ticket/tickets-user'), { headers });
    check(ticketsRes, {
      'tickets status is 200': (r) => r.status === 200,
    });
  });

  // Group 5: Scoreboard
  group('Scoreboard APIs', function () {
    const scoreboardRes = http.get(buildUrl('/api/Scoreboard/top/10'));
    check(scoreboardRes, {
      'scoreboard status is 200': (r) => r.status === 200,
    });
  });

  sleep(1);
}

export function teardown(data) {
  console.log('✓ All-in-one stress test completed');
}
