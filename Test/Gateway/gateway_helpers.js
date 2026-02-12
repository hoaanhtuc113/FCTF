import http from 'k6/http';

const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8080';
const AUTH_COOKIE_NAME = __ENV.AUTH_COOKIE_NAME || 'FCTF_Auth_Token';

export function gatewayBaseUrl() {
  return (__ENV.GATEWAY_BASE_URL || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
}

export function buildGatewayUrl(path) {
  const base = gatewayBaseUrl();
  if (!path.startsWith('/')) {
    return `${base}/${path}`;
  }
  return `${base}${path}`;
}

export function parseEnvInt(name, defaultValue) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function parseEnvFloat(name, defaultValue) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function requireEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export function extractCookieHeaderFromSetCookie(setCookieHeader) {
  if (!setCookieHeader) {
    return '';
  }

  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw || typeof raw !== 'string') {
    return '';
  }

  const first = raw.split(';')[0]?.trim() || '';
  if (!first.startsWith(`${AUTH_COOKIE_NAME}=`)) {
    return '';
  }
  return first;
}

export function establishAuthCookie(validToken, protectedPath) {
  return establishAuthCookieWithQueryKey(validToken, protectedPath, 'token');
}

export function establishAuthCookieWithQueryKey(validToken, protectedPath, keyName) {
  const delimiter = protectedPath.includes('?') ? '&' : '?';
  const key = keyName || 'token';
  const url = buildGatewayUrl(`${protectedPath}${delimiter}${encodeURIComponent(key)}=${encodeURIComponent(validToken)}&gw_test=1`);

  const res = http.get(url, {
    redirects: 0,
    tags: { endpoint: 'bootstrap_cookie' }
  });

  const cookieHeader = extractCookieHeaderFromSetCookie(res.headers['Set-Cookie'] || res.headers['set-cookie']);

  return {
    bootstrapStatus: res.status,
    location: res.headers.Location || res.headers.location || '',
    cookieHeader,
    status: res.status,
    response: res,
  };
}

export function establishAuthCookieWithPathToken(validToken, protectedPath) {
  const normalizedPath = protectedPath.startsWith('/') ? protectedPath : `/${protectedPath}`;
  const url = buildGatewayUrl(`${normalizedPath}/${encodeURIComponent(validToken)}?gw_test=1`);
  const res = http.get(url, {
    redirects: 0,
    tags: { endpoint: 'bootstrap_cookie_path' }
  });

  const cookieHeader = extractCookieHeaderFromSetCookie(res.headers['Set-Cookie'] || res.headers['set-cookie']);
  return {
    bootstrapStatus: res.status,
    location: res.headers.Location || res.headers.location || '',
    cookieHeader,
    status: res.status,
    response: res,
  };
}

export function buildRandomBody(sizeBytes) {
  const size = Math.max(0, sizeBytes || 0);
  if (size === 0) {
    return '';
  }
  const chunk = '0123456789abcdef';
  let output = '';
  while (output.length < size) {
    output += chunk;
  }
  return output.slice(0, size);
}

export function isUpstreamSuccessStatus(status) {
  if (status === 401 || status === 403 || status === 502) {
    return false;
  }
  return status >= 200 && status < 500;
}
