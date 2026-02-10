import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 5);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';
const startBeforeStop = (__ENV.START_BEFORE_STOP || 'true').toLowerCase() === 'true';
const startWaitSeconds = parseEnvInt('START_WAIT_SECONDS', 2);
const useTokenList = (__ENV.USE_TOKEN_LIST || 'false').toLowerCase() === 'true';

const stopSuccessCount = new Counter('stop_success');
const alreadyStoppedCount = new Counter('stop_already');
const notFoundCount = new Counter('stop_not_found');
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
  return parseEnvInt('STOP_CHALLENGE_ID', 0)
    || parseEnvInt('START_CHALLENGE_ID', 0)
    || parseEnvInt('CHALLENGE_ID', 0);
}

export function setup() {
  let tokens = null;
  if (useTokenList) {
    const tokenListRaw = __ENV.TOKEN_LIST;
    if (tokenListRaw) {
      tokens = parseTokenList(tokenListRaw);
      if (tokens.length === 0) {
        throw new Error('TOKEN_LIST is provided but empty');
      }
      if (tokens.length < concurrency) {
        throw new Error(`TOKEN_LIST must have at least ${concurrency} tokens for this test`);
      }
    } else if (_tokenFileTokens) {
      tokens = _tokenFileTokens;
      if (tokens.length === 0) {
        throw new Error(`TOKEN_FILE (${_tokenFilePath}) exists but contains no tokens`);
      }
      if (tokens.length < concurrency) {
        throw new Error(`TOKEN_FILE must have at least ${concurrency} tokens for this test`);
      }
    } else {
      throw new Error('USE_TOKEN_LIST=true requires TOKEN_LIST or TOKEN_FILE');
    }
  }

  const token = tokens ? tokens[0] : (pickSingleToken() || loginAndGetToken());
  const challengeId = resolveChallengeId();
  if (!challengeId) {
    throw new Error('STOP_CHALLENGE_ID (or START_CHALLENGE_ID/CHALLENGE_ID) is required');
  }

  if (startBeforeStop) {
    http.post(
      buildUrl('/api/Challenge/start'),
      JSON.stringify({ challengeId }),
      { headers: getAuthHeaders(token) }
    );

    if (startWaitSeconds > 0) {
      sleep(startWaitSeconds);
    }
  }

  return { token, challengeId, tokens };
}

export default function (data) {
  const token = data.tokens
    ? data.tokens[(__VU - 1) % data.tokens.length]
    : data.token;

  const res = http.post(
    buildUrl('/api/Challenge/stop-by-user'),
    JSON.stringify({ challengeId: data.challengeId }),
    { headers: getAuthHeaders(token) }
  );

  let body = null;
  try {
    body = res.json();
  } catch (e) {
    console.log(`stop: json parse error ${e.message} status=${res.status} body=${res.body}`);
  }

  const success = body && body.success === true;
  const error = body && body.error ? `${body.error}` : '';
  const message = body && body.message ? `${body.message}` : '';
  const combined = `${error} ${message}`.toLowerCase();

  if (res.status === 200 && success) {
    stopSuccessCount.add(1);
  } else if (res.status === 400) {
    if (combined.includes('not started') || combined.includes('already stopped') || combined.includes('no active cache')) {
      alreadyStoppedCount.add(1);
    } else {
      unexpectedResponses.add(1);
    }
  } else if (res.status === 404) {
    notFoundCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'stop response handled': (r) => r.status === 200 || r.status === 400 || r.status === 404
  });
}

export function handleSummary(data) {
  const stopped = data.metrics.stop_success ? data.metrics.stop_success.values.count : 0;
  const already = data.metrics.stop_already ? data.metrics.stop_already.values.count : 0;
  const notFound = data.metrics.stop_not_found ? data.metrics.stop_not_found.values.count : 0;

  let summary = 'concurrent_stop_challenge summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `stopped=${stopped}, already=${already}, not_found=${notFound}\n`;

  if (strictMode) {
    const unexpected = data.metrics.unexpected_responses ? data.metrics.unexpected_responses.values.count : 0;
    if (startBeforeStop && stopped < 1) {
      summary += 'STRICT check failed: expected at least 1 stop success.\n';
    } else if (unexpected > 0) {
      summary += 'STRICT check failed: unexpected responses detected.\n';
    } else {
      summary += 'STRICT check passed.\n';
    }
  }

  return { stdout: summary };
}
