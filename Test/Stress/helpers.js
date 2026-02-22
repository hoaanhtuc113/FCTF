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

// Common stress test options
export const stressOptions = {
  // Load Test: Ramp up to target VUs and maintain
  load: {
    stages: [
      { duration: '30s', target: 50 },   // Ramp up to 50 VUs
      { duration: '2m', target: 50 },    // Stay at 50 VUs
      { duration: '30s', target: 100 },  // Ramp up to 100 VUs
      { duration: '2m', target: 100 },   // Stay at 100 VUs
      { duration: '30s', target: 0 },    // Ramp down to 0 VUs
    ],
    thresholds: {
      http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
      http_req_failed: ['rate<0.05'],  // Error rate < 5%
    },
  },

  // Spike Test: Sudden increase in load
  spike: {
    stages: [
      { duration: '10s', target: 20 },   // Warm up
      { duration: '30s', target: 20 },   // Normal load
      { duration: '10s', target: 200 },  // Spike to 200 VUs
      { duration: '1m', target: 200 },   // Maintain spike
      { duration: '10s', target: 20 },   // Return to normal
      { duration: '30s', target: 20 },   // Normal load
      { duration: '10s', target: 0 },    // Ramp down
    ],
    thresholds: {
      http_req_duration: ['p(95)<1000', 'p(99)<2000'], 
      http_req_failed: ['rate<0.10'],  // Allow 10% error during spike
    },
  },

  // Stress Test: Find breaking point
  stress: {
    stages: [
      { duration: '1m', target: 50 },    // Ramp up to 50 VUs
      { duration: '2m', target: 50 },    // Stay at 50 VUs
      { duration: '1m', target: 100 },   // Ramp up to 100 VUs
      { duration: '2m', target: 100 },   // Stay at 100 VUs
      { duration: '1m', target: 200 },   // Ramp up to 200 VUs
      { duration: '2m', target: 200 },   // Stay at 200 VUs
      { duration: '1m', target: 300 },   // Ramp up to 300 VUs
      { duration: '2m', target: 300 },   // Stay at 300 VUs
      { duration: '1m', target: 0 },     // Ramp down
    ],
    thresholds: {
      http_req_duration: ['p(95)<2000'],
      http_req_failed: ['rate<0.20'],  // Allow 20% error at peak
    },
  },

  // Soak Test: Sustained load over long period
  soak: {
    stages: [
      { duration: '2m', target: 50 },    // Ramp up to 50 VUs
      { duration: '30m', target: 50 },   // Stay at 50 VUs for 30 minutes
      { duration: '2m', target: 0 },     // Ramp down
    ],
    thresholds: {
      http_req_duration: ['p(95)<500'],
      http_req_failed: ['rate<0.05'],
    },
  },

  // Smoke Test: Minimal load to verify basic functionality
  smoke: {
    vus: 1,
    duration: '1m',
    thresholds: {
      http_req_duration: ['p(95)<500'],
      http_req_failed: ['rate<0.01'],
    },
  },
};

// Get test type from environment variable
export function getTestOptions() {
  const testType = __ENV.TEST_TYPE || 'load';
  return stressOptions[testType] || stressOptions.load;
}
