import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt, requireEnv } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 5);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';

const passedCount = new Counter('cooldown_passed');
const rateLimitedCount = new Counter('cooldown_ratelimited');
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
const _tokenFilePath_cool = __ENV.TOKEN_FILE || null;
let _tokenFileTokens_cool = null;
if (_tokenFilePath_cool) {
  try {
    const _content = open(_tokenFilePath_cool).trim();
    _tokenFileTokens_cool = _content.indexOf(',') >= 0
      ? _content.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      : _content.split(/\r?\n/).map((t) => t.trim()).filter((t) => t.length > 0);
  } catch (e) {
    throw new Error(`Unable to open TOKEN_FILE: ${_tokenFilePath_cool} (${e.message})`);
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

  if (_tokenFileTokens_cool) {
    if (_tokenFileTokens_cool.length === 0) {
      throw new Error(`TOKEN_FILE (${_tokenFilePath_cool}) exists but contains no tokens`);
    }
    if (_tokenFileTokens_cool.length < concurrency) {
      throw new Error(`TOKEN_FILE must have at least ${concurrency} tokens for this test`);
    }
    return { tokens: _tokenFileTokens_cool };
  }

  const token = loginAndGetToken();
  return { token };
}

export default function (data) {
  const challengeId = parseEnvInt('CHALLENGE_ID', 0);
  const wrongFlag = requireEnv('WRONG_FLAG');
  if (!challengeId) {
    throw new Error('CHALLENGE_ID is required');
  }

  const token = data.tokens
    ? data.tokens[(__VU - 1) % data.tokens.length]
    : data.token;

  const res = http.post(
    buildUrl('/api/Challenge/attempt'),
    JSON.stringify({ challengeId, submission: wrongFlag }),
    { headers: getAuthHeaders(token) }
  );

  let status = null;
  try {
    const body = res.json();
    status = body && body.data ? body.data.status : null;
  } catch (e) {
    console.log(`cooldown attempt: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  if (res.status === 200 && status === 'incorrect') {
    passedCount.add(1);
  } else if (res.status === 429 || status === 'ratelimited') {
    rateLimitedCount.add(1);
  } else {
    unexpectedResponses.add(1);
    console.log(`cooldown: unexpected response httpStatus=${res.status} dataStatus=${status}`);
  }

  check(res, {
    'cooldown response handled': (r) => r.status === 200 || r.status === 429
  });
}

export function handleSummary(data) {
  const passed = data.metrics.cooldown_passed ? data.metrics.cooldown_passed.values.count : 0;
  const rateLimited = data.metrics.cooldown_ratelimited ? data.metrics.cooldown_ratelimited.values.count : 0;

  let summary = 'concurrent_cooldown_attempts summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `passed=${passed}, ratelimited=${rateLimited}\n`;

  if (strictMode) {
    const expectedRateLimited = Math.max(concurrency - 1, 0);
    if (passed !== 1 || rateLimited !== expectedRateLimited) {
      summary += 'STRICT check failed: expected 1 pass and N-1 ratelimited.\n';
    } else {
      summary += 'STRICT check passed.\n';
    }
  }

  return { stdout: summary };
}
