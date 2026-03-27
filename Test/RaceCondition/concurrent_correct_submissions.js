import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt, requireEnv } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 10);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';

const correctCount = new Counter('correct_submissions');
const alreadySolvedCount = new Counter('already_solved');
const rateLimitedCount = new Counter('rate_limited');
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
const _tokenFilePath_correct = __ENV.TOKEN_FILE || null;
let _tokenFileTokens_correct = null;
if (_tokenFilePath_correct) {
  try {
    const _content = open(_tokenFilePath_correct).trim();
    _tokenFileTokens_correct = _content.indexOf(',') >= 0
      ? _content.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      : _content.split(/\r?\n/).map((t) => t.trim()).filter((t) => t.length > 0);
  } catch (e) {
    throw new Error(`Unable to open TOKEN_FILE: ${_tokenFilePath_correct} (${e.message})`);
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

  if (_tokenFileTokens_correct) {
    if (_tokenFileTokens_correct.length === 0) {
      throw new Error(`TOKEN_FILE (${_tokenFilePath_correct}) exists but contains no tokens`);
    }
    if (_tokenFileTokens_correct.length < concurrency) {
      throw new Error(`TOKEN_FILE must have at least ${concurrency} tokens for this test`);
    }
    return { tokens: _tokenFileTokens_correct };
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

  // Safe parse JSON for all status codes
  let status = null;
  try {
    const body = res.json();
    status = body && body.data ? body.data.status : null;
  } catch (e) {
    console.log(`attempt: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  if (!status) {
    console.log(`attempt: no status extracted, httpStatus=${res.status} body=${res.body}`);
  }

  if (res.status === 200 && status === 'correct') {
    correctCount.add(1);
  } else if (res.status === 200 && status === 'already_solved') {
    alreadySolvedCount.add(1);
  } else if (res.status === 429 || status === 'ratelimited') {
    rateLimitedCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'response ok or ratelimited': (r) => r.status === 200 || r.status === 429
  });
}

export function handleSummary(data) {
  const correct = data.metrics.correct_submissions ? data.metrics.correct_submissions.values.count : 0;
  const already = data.metrics.already_solved ? data.metrics.already_solved.values.count : 0;
  const rateLimited = data.metrics.rate_limited ? data.metrics.rate_limited.values.count : 0;

  let summary = 'concurrent_correct_submissions summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `correct=${correct}, already_solved=${already}, ratelimited=${rateLimited}\n`;

  if (strictMode) {
    const expectedAlready = Math.max(concurrency - 1, 0);
    const unexpected = data.metrics.unexpected_responses ? data.metrics.unexpected_responses.values.count : 0;
    // Accept rate-limited or unexpected responses as valid failures for STRICT validation
    if (correct !== 1 || (already + rateLimited + unexpected) < expectedAlready) {
      summary += 'STRICT check failed: expected 1 correct and others already_solved or ratelimited/unexpected.\n';
    } else {
      summary += 'STRICT check passed.\n';
    }
  }

  return { stdout: summary };
}
