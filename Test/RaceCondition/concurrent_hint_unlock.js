import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildUrl, loginAndGetToken, getAuthHeaders, parseEnvInt } from './helpers.js';

const concurrency = parseEnvInt('CONCURRENCY', 10);
const strictMode = (__ENV.STRICT || 'false').toLowerCase() === 'true';
const hintType = __ENV.HINT_TYPE || 'hints';

const unlockedCount = new Counter('unlock_success');
const alreadyUnlockedCount = new Counter('unlock_already');
const inProgressCount = new Counter('unlock_in_progress');
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
const _tokenFilePath_hint = __ENV.TOKEN_FILE || null;
let _tokenFileTokens_hint = null;
if (_tokenFilePath_hint) {
  try {
    const _content = open(_tokenFilePath_hint).trim();
    _tokenFileTokens_hint = _content.indexOf(',') >= 0
      ? _content.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      : _content.split(/\r?\n/).map((t) => t.trim()).filter((t) => t.length > 0);
  } catch (e) {
    throw new Error(`Unable to open TOKEN_FILE: ${_tokenFilePath_hint} (${e.message})`);
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

  if (_tokenFileTokens_hint) {
    if (_tokenFileTokens_hint.length === 0) {
      throw new Error(`TOKEN_FILE (${_tokenFilePath_hint}) exists but contains no tokens`);
    }
    if (_tokenFileTokens_hint.length < concurrency) {
      throw new Error(`TOKEN_FILE must have at least ${concurrency} tokens for this test`);
    }
    return { tokens: _tokenFileTokens_hint };
  }

  const token = loginAndGetToken();
  return { token };
}

export default function (data) {
  const hintId = parseEnvInt('HINT_ID', 0);
  if (!hintId) {
    throw new Error('HINT_ID is required');
  }

  const token = data.tokens
    ? data.tokens[(__VU - 1) % data.tokens.length]
    : data.token;

  const res = http.post(
    buildUrl('/api/Hint/unlock'),
    JSON.stringify({ type: hintType, target: hintId }),
    { headers: getAuthHeaders(token) }
  );

  const body = res.json();
  const error = body && body.error ? body.error : '';

  if (res.status === 200 && body && body.success === true) {
    unlockedCount.add(1);
  } else if (res.status === 400 && error.toLowerCase().includes('already unlocked')) {
    alreadyUnlockedCount.add(1);
  } else if (res.status === 400 && error.toLowerCase().includes('another unlock operation is in progress')) {
    inProgressCount.add(1);
  } else {
    unexpectedResponses.add(1);
  }

  check(res, {
    'unlock response handled': (r) => r.status === 200 || r.status === 400
  });
}

export function teardown(data) {
  const hintId = parseEnvInt('HINT_ID', 0);
  if (!hintId) {
    return;
  }
  const res = http.get(
    buildUrl(`/api/Hint/${hintId}`),
    { headers: getAuthHeaders(data.token) }
  );
  if (res.status !== 200) {
    console.log(`Hint teardown: status=${res.status} body=${res.body}`);
    return;
  }
  if (!res.body || res.body.length === 0) {
    console.log('Hint teardown: empty body');
    return;
  }
  const ct = res.headers['Content-Type'] || res.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('application/json')) {
    console.log(`Hint teardown: non-json content-type=${ct} body=${res.body}`);
    return;
  }
  let body;
  try {
    body = res.json();
  } catch (e) {
    console.log(`Hint teardown: json parse error ${e.message} body=${res.body}`);
    return;
  }
  const view = body && body.data ? body.data.view : null;
  if (view !== 'unlocked') {
    console.log(`Hint view is not unlocked after test. view=${view}`);
  }
}

export function handleSummary(data) {
  const unlocked = data.metrics.unlock_success ? data.metrics.unlock_success.values.count : 0;
  const already = data.metrics.unlock_already ? data.metrics.unlock_already.values.count : 0;
  const inProgress = data.metrics.unlock_in_progress ? data.metrics.unlock_in_progress.values.count : 0;

  let summary = 'concurrent_hint_unlock summary\n';
  summary += `concurrency=${concurrency}\n`;
  summary += `success=${unlocked}, already_unlocked=${already}, in_progress=${inProgress}\n`;

  if (strictMode) {
    const expectedAlready = Math.max(concurrency - 1, 0);
    // Consider "in_progress" responses as acceptable alternatives to "already_unlocked" when evaluating STRICT
    if (unlocked !== 1 || (already + inProgress) < expectedAlready) {
      summary += 'STRICT check failed: expected 1 success and others already unlocked or in-progress.\n';
    } else {
      summary += 'STRICT check passed.\n';
    }
  }

  return { stdout: summary };
}
