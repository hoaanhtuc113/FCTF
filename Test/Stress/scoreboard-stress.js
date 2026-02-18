import http from 'k6/http';
import { check, sleep } from 'k6';
import { buildUrl, getTestOptions, parseEnvInt } from './helpers.js';

export const options = getTestOptions();

export default function () {
  const topCount = parseEnvInt('TOP_COUNT', 10);
  
  // Test: Get top teams without bracket filter
  const topTeamsRes = http.get(buildUrl(`/api/Scoreboard/top/${topCount}`));
  check(topTeamsRes, {
    'get top teams status is 200': (r) => r.status === 200,
    'get top teams has data': (r) => {
      const body = r.json();
      return body && body.success && body.data;
    },
  });

  // Test: Get top teams with bracket filter (bracket_id=1)
  const topTeamsBracketRes = http.get(
    buildUrl(`/api/Scoreboard/top/${topCount}?bracket_id=1`)
  );
  check(topTeamsBracketRes, {
    'get top teams with bracket status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
