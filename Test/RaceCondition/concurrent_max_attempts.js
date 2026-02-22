import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt, requireEnv } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 5);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';
const expectedMaxAttempts = parseEnvInt('MAX_ATTEMPTS', 0);
const useTokenList = (__ENV.USE_TOKEN_LIST || 'false').toLowerCase() === 'true';

const incorrectCount = new Counter('max_attempts_incorrect');
const exceededCount = new Counter('max_attempts_exceeded');
const rateLimitedCount = new Counter('max_attempts_ratelimited');
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

function pickSingleToken() {
  if (__ENV.TOKEN) {
    return __ENV.TOKEN;
  }
  if (__ENV.TOKEN_LIST) {
    const tokens = __ENV.TOKEN_LIST.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    if (tokens.length > 0) {
      return tokens[0];
    }
  }
  if (_tokenFileTokens && _tokenFileTokens.length > 0) {
    return _tokenFileTokens[0];
  }
  return null;
}

function parseTokenList(raw) {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function resolveChallengeId() {
  return parseEnvInt('MAX_ATTEMPTS_CHALLENGE_ID', 0) || parseEnvInt('CHALLENGE_ID', 0);
}

export function setup() {
  if (useTokenList) {
    const tokenListRaw = __ENV.TOKEN_LIST;
    if (tokenListRaw) {
      const tokens = parseTokenList(tokenListRaw);
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

    throw new Error('USE_TOKEN_LIST=true requires TOKEN_LIST or TOKEN_FILE');
  }

  const token = pickSingleToken() || loginAndGetToken();
  return { token };
}

export default function (data) {
  const challengeId = resolveChallengeId();
  const wrongFlag = requireEnv('WRONG_FLAG');
  if (!challengeId) {
    throw new Error('MAX_ATTEMPTS_CHALLENGE_ID (or CHALLENGE_ID) is required');
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
  let message = '';
  try {
    const body = res.json();
    status = body && body.data ? body.data.status : null;
    message = body && body.data && body.data.message ? `${body.data.message}` : '';
  } catch (e) {
    console.log(`max attempts: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  const messageLower = message.toLowerCase();

  if (res.status === 200 && status === 'incorrect') {
    incorrectCount.add(1);
  } else if (res.status === 400 && status === 'incorrect' && messageLower.includes('0 tries remaining')) {
    exceededCount.add(1);
  } else if (res.status === 429 || status === 'ratelimited') {
    rateLimitedCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'max attempts response handled': (r) => r.status === 200 || r.status === 400 || r.status === 429
  });
}

export function handleSummary(data) {
  const incorrect = data.metrics.max_attempts_incorrect ? data.metrics.max_attempts_incorrect.values.count : 0;
  const exceeded = data.metrics.max_attempts_exceeded ? data.metrics.max_attempts_exceeded.values.count : 0;
  const rateLimited = data.metrics.max_attempts_ratelimited ? data.metrics.max_attempts_ratelimited.values.count : 0;

  let summary = 'concurrent_max_attempts summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `incorrect=${incorrect}, exceeded=${exceeded}, ratelimited=${rateLimited}\n`;

  if (strictMode) {
    const unexpected = data.metrics.unexpected_responses ? data.metrics.unexpected_responses.values.count : 0;
    if (expectedMaxAttempts > 0) {
      const expectedIncorrect = Math.min(concurrency, expectedMaxAttempts);
      const expectedExceeded = Math.max(concurrency - expectedMaxAttempts, 0);
      if (incorrect !== expectedIncorrect || exceeded !== expectedExceeded || rateLimited > 0 || unexpected > 0) {
        summary += `STRICT check failed: expected incorrect=${expectedIncorrect}, exceeded=${expectedExceeded}, rateLimited=0.\n`;
      } else {
        summary += 'STRICT check passed.\n';
      }
    } else {
      summary += 'STRICT check skipped: MAX_ATTEMPTS not set.\n';
    }
  }

  return { stdout: summary };
}
