export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login-contestant',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    ME: '/auth/me',
  },
  CONFIG: {
    DATE_CONFIG: '/Config/get_date_config',
  },
  CHALLENGES: {
    BY_TOPIC: '/challenge/by-topic',
    LIST: '/challenge/list_challenge/', 
    DETAIL: (id: string | number) => `/challenge/${id}`,
    SUBMIT: (id: string | number) => `/challenges/${id}/submit`,
    START: '/challenge/start',
    STOP: '/challenge/stop-by-user',
    CHECK_CACHE: '/challenge/check_cache',
    START_CHECKING: '/statuscheck/start',
  },
  HINTS: {
    GET_ALL: (challengeId: string | number) => `/hint/${challengeId}/all`,
    GET_DETAIL: (hintId: string | number) => `/hint/${hintId}`,
    UNLOCK: '/hint/unlock',
  },
  TICKET: {
    LIST: '/ticket/tickets-user',
    CREATE: '/ticket/sendticket',
    DETAIL: (id: string) => `/ticket/tickets/${id}`,
  },
  USER: {
    PROFILE: '/users/profile',
  },
  ACTION_LOGS: {
    GET: '/ActionLogs/get-logs',
    POST: '/ActionLogs/save-logs',
  },
  FLAGS: {
    SUBMIT: '/v1/challenges/attempt',
  },
  SCOREBOARD: {
    TOP_STANDINGS: '/scoreboard/top/200',
  },
} as const;
