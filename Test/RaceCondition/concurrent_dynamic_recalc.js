import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Gauge } from 'k6/metrics';
import {
  buildUrl,
  loginAndGetToken,
  getAuthHeaders,
  parseEnvInt,
  requireEnv,
  getChallengeValueByCategory,
  computeDynamicValue
} from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 10);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';
const pollAttempts = parseEnvInt('DYN_POLL_ATTEMPTS', 10);
const pollDelayMs = parseEnvInt('DYN_POLL_DELAY_MS', 500);

// Globals used to record dynamic value comparison results for STRICT checks
let _dyn_expectedValue = null;
let _dyn_actualValue = null;
let _dyn_valueChecked = false;
// Use Gauges to record expected/actual values in teardown so handleSummary can read them
const dynExpectedGauge = new Gauge('dyn_expected_value');
const dynActualGauge = new Gauge('dyn_actual_value');

const correctCount = new Counter('correct_submissions');
const alreadySolvedCount = new Counter('already_solved');
const unexpectedResponses = new Rate('unexpected_responses');

export const options = {
  scenarios: {
    concurrent: {
      executor: 'per-vu-iterations',
      vus: concurrency,
      iterations: 1,
      maxDuration: '1m'
    }
  },
  thresholds: {
    unexpected_responses: ['rate==0']
  }
};

// Read TOKEN_FILE at init (open() allowed in global scope only)
const _tokenFilePath = __ENV.TOKEN_FILE || null;
let _tokenFileTokens = null;
if (_tokenFilePath) {
  try {
    const _content = open(_tokenFilePath).trim();
    _tokenFileTokens = _content.indexOf(',') >= 0
      ? _content.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      : _content.split(/\r?\n/).map((t) => t.trim()).filter((t) => t.length > 0);
  } catch (e) {
    throw new Error(`Unable to open TOKEN_FILE: ${_tokenFilePath} (${e.message})`);
  }
}

export function setup() {
  const tokenListRaw = __ENV.TOKEN_LIST;

  if (tokenListRaw) {
    const tokens = tokenListRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tokens.length === 0) {
      throw new Error('TOKEN_LIST is provided but empty');
    }
    if (tokens.length < concurrency) {
      throw new Error(`TOKEN_LIST must have at least ${concurrency} tokens for this test`);
    }
    return { tokens };
  }

  if (_tokenFileTokens) {
    if (_tokenFileTokens.length === 0) {
      throw new Error(`TOKEN_FILE (${_tokenFilePath}) exists but contains no tokens`);
    }
    if (_tokenFileTokens.length < concurrency) {
      throw new Error(`TOKEN_FILE must have at least ${concurrency} tokens for this test`);
    }
    return { tokens: _tokenFileTokens };
  }

  const token = loginAndGetToken();
  return { token };
}

export default function (data) {
  const challengeId = parseEnvInt('CHALLENGE_ID', 0);
  const flag = requireEnv('CHALLENGE_FLAG');
  if (!challengeId) {
    throw new Error('CHALLENGE_ID is required');
  }

  const token = data.tokens
    ? data.tokens[(__VU - 1) % data.tokens.length]
    : data.token;

  const res = http.post(
    buildUrl('/api/Challenge/attempt'),
    JSON.stringify({ challengeId, submission: flag }),
    { headers: getAuthHeaders(token) }
  );

  let status = null;
  try {
    const body = res.json();
    status = body && body.data ? body.data.status : null;
  } catch (e) {
    console.log(`dynamic solve: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  if (res.status === 200 && status === 'correct') {
    correctCount.add(1);
  } else if (res.status === 200 && status === 'already_solved') {
    alreadySolvedCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'solve response handled': (r) => r.status === 200
  });
}

export function teardown(data) {
  const challengeId = parseEnvInt('CHALLENGE_ID', 0);
  const category = requireEnv('CHALLENGE_CATEGORY');
  if (!challengeId) {
    return;
  }

  const token = data.tokens ? data.tokens[0] : data.token;

  let valueResult = null;
  for (let i = 0; i < pollAttempts; i += 1) {
    const result = getChallengeValueByCategory(token, category, challengeId);
    if (result.ok) {
      valueResult = result;
      break;
    }
    sleep(pollDelayMs / 1000);
  }

  if (!valueResult || !valueResult.ok) {
    console.log('Unable to fetch challenge value after test.');
    return;
  }

  const expectedSolveCountRaw = __ENV.DYN_EXPECTED_SOLVE_COUNT;
  const functionType = (__ENV.DYN_FUNCTION || '').toLowerCase();
  const initialRaw = __ENV.DYN_INITIAL;
  const decayRaw = __ENV.DYN_DECAY;
  const minimumRaw = __ENV.DYN_MINIMUM;

  const useAuto = (!expectedSolveCountRaw && functionType && initialRaw && decayRaw && minimumRaw);
  if (!expectedSolveCountRaw && !useAuto) {
    console.log(`Current value=${valueResult.value}. Provide DYN_* env vars to validate expected value.`);
    return;
  }

  const initial = parseInt(initialRaw, 10);
  const decay = parseInt(decayRaw, 10);
  const minimum = parseInt(minimumRaw, 10);
  const correct = data.metrics && data.metrics.correct_submissions ? data.metrics.correct_submissions.count : 0;
  const baseSolveCountRaw = __ENV.DYN_BASE_SOLVE_COUNT;

  let expectedSolveCount = null;
  if (expectedSolveCountRaw) {
    expectedSolveCount = parseInt(expectedSolveCountRaw, 10);
  } else if (baseSolveCountRaw) {
    const baseSolveCount = parseInt(baseSolveCountRaw, 10);
    expectedSolveCount = baseSolveCount + correct;
  }

  if (expectedSolveCount === null) {
    console.log(`Current value=${valueResult.value}. Provide DYN_EXPECTED_SOLVE_COUNT or DYN_BASE_SOLVE_COUNT for strict validation.`);
    return;
  }

  const expectedValue = computeDynamicValue(functionType, initial, decay, minimum, expectedSolveCount);

  // Record values for summary/STRICT validation (use gauges so handleSummary can access them)
  _dyn_expectedValue = expectedValue;
  _dyn_actualValue = valueResult.value;
  _dyn_valueChecked = (valueResult.value === expectedValue);

  dynExpectedGauge.add(expectedValue);
  dynActualGauge.add(valueResult.value);

  if (!_dyn_valueChecked) {
    console.log(`Dynamic value mismatch. expected=${expectedValue}, actual=${valueResult.value}`);
  } else if (strictMode) {
    console.log('Dynamic value matches expected.');
  }
}

export function handleSummary(data) {
  const correct = data.metrics.correct_submissions ? data.metrics.correct_submissions.values.count : 0;
  const already = data.metrics.already_solved ? data.metrics.already_solved.values.count : 0;
  const unexpected = data.metrics.unexpected_responses && data.metrics.unexpected_responses.values && typeof data.metrics.unexpected_responses.values.count !== 'undefined'
    ? data.metrics.unexpected_responses.values.count
    : 0;

  let summary = 'concurrent_dynamic_recalc summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `correct=${correct}, already_solved=${already}, unexpected=${unexpected}\n`;

  if (strictMode) {
    // For multi-team dynamic recompute test we expect every VU (team) to submit a correct solve
    if (correct !== concurrency) {
      summary += `STRICT check failed: expected ${concurrency} correct submissions (one per VU).\n`;
    } else {
      // Read gauges from data.metrics (handleSummary runs in init context and can access metric aggregations)
      const expGauge = data.metrics.dyn_expected_value && data.metrics.dyn_expected_value.values && typeof data.metrics.dyn_expected_value.values.max !== 'undefined'
        ? data.metrics.dyn_expected_value.values.max
        : null;
      const actGauge = data.metrics.dyn_actual_value && data.metrics.dyn_actual_value.values && typeof data.metrics.dyn_actual_value.values.max !== 'undefined'
        ? data.metrics.dyn_actual_value.values.max
        : null;

      if (expGauge === null || actGauge === null) {
        summary += 'STRICT check failed: unable to validate dynamic value (value not fetched).\n';
      } else if (expGauge !== actGauge) {
        summary += `STRICT check failed: dynamic value mismatch. expected=${expGauge}, actual=${actGauge}\n`;
      } else {
        summary += 'STRICT check passed.\n';
      }
    }
  }

  return { stdout: summary };
}
