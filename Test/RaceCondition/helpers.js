import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

export function buildUrl(path) {
  if (!path.startsWith('/')) {
    return `${BASE_URL}/${path}`;
  }
  return `${BASE_URL}${path}`;
}

export function parseEnvInt(name, defaultValue) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

export function requireEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export function getAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

export function loginAndGetToken() {
  if (__ENV.TOKEN) {
    return __ENV.TOKEN;
  }
  const username = requireEnv('USERNAME');
  const password = requireEnv('PASSWORD');

  const res = http.post(
    buildUrl('/api/Auth/login-contestant'),
    JSON.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'login status is 200': (r) => r.status === 200
  });

  const body = res.json();
  if (!body || !body.generatedToken) {
    throw new Error('Login response missing generatedToken');
  }
  return body.generatedToken;
}

export function getChallengeValueByCategory(token, category, challengeId) {
  const res = http.get(
    buildUrl(`/api/Challenge/list_challenge/${encodeURIComponent(category)}`),
    { headers: getAuthHeaders(token) }
  );
  // Safe parse and logging
  if (res.status !== 200) {
    console.log(`getChallengeValueByCategory: status=${res.status} body=${res.body}`);
    return { ok: false, error: `status ${res.status}` };
  }
  if (!res.body || res.body.length === 0) {
    console.log(`getChallengeValueByCategory: empty body, status=${res.status}`);
    return { ok: false, error: 'empty body' };
  }
  const ct = res.headers['Content-Type'] || res.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('application/json')) {
    console.log(`getChallengeValueByCategory: unexpected content-type=${ct} body=${res.body}`);
    return { ok: false, error: 'not json' };
  }
  let body;
  try {
    body = res.json();
  } catch (e) {
    console.log(`getChallengeValueByCategory: json parse error ${e.message} body=${res.body}`);
    return { ok: false, error: 'json parse error' };
  }
  const list = body && body.data ? body.data : [];
  const match = list.find((c) => c.id === challengeId);
  if (!match) {
    return { ok: false, error: 'challenge not found in category list' };
  }
  return { ok: true, value: match.value };
}

export function computeDynamicValue(functionType, initial, decay, minimum, solveCount) {
  let count = solveCount;
  if (count !== 0) {
    count -= 1;
  }

  if (functionType.toLowerCase() === 'linear') {
    let value = initial - (decay * count);
    value = Math.ceil(value);
    if (value < minimum) {
      value = minimum;
    }
    return value;
  }

  let safeDecay = decay;
  if (safeDecay === 0) {
    safeDecay = 1;
  }
  const decaySquared = Math.pow(safeDecay, 2);
  const solveCountSquared = Math.pow(count, 2);
  const value = ((minimum - initial) / decaySquared) * solveCountSquared + initial;
  let finalValue = Math.ceil(value);
  if (finalValue < minimum) {
    finalValue = minimum;
  }
  return finalValue;
}
