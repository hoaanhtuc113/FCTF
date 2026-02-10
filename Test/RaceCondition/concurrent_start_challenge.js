import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 5);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';
const useTokenList = (__ENV.USE_TOKEN_LIST || 'false').toLowerCase() === 'true';

const startSuccessCount = new Counter('start_success');
const alreadyStartedCount = new Counter('start_already');
const inProgressCount = new Counter('start_in_progress');
const limitExceededCount = new Counter('start_limit');
const forbiddenCount = new Counter('start_forbidden');
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
  const challengeId = parseEnvInt('START_CHALLENGE_ID', 0) || parseEnvInt('CHALLENGE_ID', 0);
  if (!challengeId) {
    throw new Error('START_CHALLENGE_ID (or CHALLENGE_ID) is required');
  }

  const token = data.tokens
    ? data.tokens[(__VU - 1) % data.tokens.length]
    : data.token;

  const res = http.post(
    buildUrl('/api/Challenge/start'),
    JSON.stringify({ challengeId }),
    { headers: getAuthHeaders(token) }
  );

  let body = null;
  try {
    body = res.json();
  } catch (e) {
    console.log(`start: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  const success = body && body.success === true;
  const error = body && body.error ? `${body.error}` : '';
  const message = body && body.message ? `${body.message}` : '';
  const combined = `${error} ${message}`.toLowerCase();

  if (res.status === 200 && success) {
    if (combined.includes('deploying') || combined.includes('running') || combined.includes('deleting')) {
      inProgressCount.add(1);
    } else {
      startSuccessCount.add(1);
    }
  } else if (res.status === 400) {
    if (combined.includes('already started')) {
      alreadyStartedCount.add(1);
    } else if (combined.includes('in progress')) {
      inProgressCount.add(1);
    } else if (combined.includes('maximum limit')) {
      limitExceededCount.add(1);
    } else {
      unexpectedResponses.add(1);
    }
  } else if (res.status === 403) {
    forbiddenCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'start response handled': (r) => r.status === 200 || r.status === 400 || r.status === 403
  });
}

export function handleSummary(data) {
  const started = data.metrics.start_success ? data.metrics.start_success.values.count : 0;
  const already = data.metrics.start_already ? data.metrics.start_already.values.count : 0;
  const inProgress = data.metrics.start_in_progress ? data.metrics.start_in_progress.values.count : 0;
  const limit = data.metrics.start_limit ? data.metrics.start_limit.values.count : 0;
  const forbidden = data.metrics.start_forbidden ? data.metrics.start_forbidden.values.count : 0;

  let summary = 'concurrent_start_challenge summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `started=${started}, already=${already}, in_progress=${inProgress}, limit=${limit}, forbidden=${forbidden}\n`;

  if (strictMode) {
    const unexpected = data.metrics.unexpected_responses ? data.metrics.unexpected_responses.values.count : 0;
    if (started < 1 || unexpected > 0 || limit > 0 || forbidden > 0) {
      summary += 'STRICT check failed: expected at least 1 start success and no unexpected/limit/forbidden responses.\n';
    } else {
      summary += 'STRICT check passed.\n';
    }
  }

  return { stdout: summary };
}
