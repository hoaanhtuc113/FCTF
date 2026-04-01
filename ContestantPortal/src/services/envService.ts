// Central env helper for gateway and ports (no explicit `any`)
type WindowEnv = {
  VITE_API_URL?: string;
  VITE_BASE_GATEWAY?: string;
  VITE_HTTP_PORT?: string;
  VITE_TCP_PORT?: string;
  [key: string]: string | undefined;
};

const getWindowEnv = (): WindowEnv => {
  const w = window.__ENV__ || {};
  return w;
};

const getMetaEnv = (): Record<string, string | undefined> => {
  const meta = (import.meta as unknown) as { env?: Record<string, string | undefined> };
  return meta.env || {};
};

function getRawEnv(key: keyof WindowEnv): string | undefined {
  const winVal = getWindowEnv()[String(key)];
  if (winVal !== undefined && winVal !== null && winVal !== '') return winVal;

  const metaVal = getMetaEnv()[String(key)];
  if (metaVal !== undefined && metaVal !== null && metaVal !== '') return metaVal;

  return undefined;
}

export function getEnvVar(key: keyof WindowEnv, fallback?: string): string | undefined {
  const v = getRawEnv(key);
  return v !== undefined ? v : fallback;
}

const DEFAULT_GATEWAY = 'challenge3.fctf.site';
const DEFAULT_HTTP_PORT = '30038';
const DEFAULT_TCP_PORT = '30037';

export function getBaseGateway(): string {
  return getEnvVar('VITE_BASE_GATEWAY', DEFAULT_GATEWAY)!;
}

export function getHttpPort(): string {
  return getEnvVar('VITE_HTTP_PORT', DEFAULT_HTTP_PORT)!;
}

export function getTcpPort(): string {
  return getEnvVar('VITE_TCP_PORT', DEFAULT_TCP_PORT)!;
}

export function getChallengeHttpOrigin(): string {
  return `http://${getBaseGateway()}:${getHttpPort()}`;
}

export function getChallengeTcpAddress(): string {
  return `${getBaseGateway()}:${getTcpPort()}`;
}

export default {
  getEnvVar,
  getBaseGateway,
  getHttpPort,
  getTcpPort,
  getChallengeHttpOrigin,
  getChallengeTcpAddress,
};
