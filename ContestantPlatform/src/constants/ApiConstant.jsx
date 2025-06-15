export const BASE_URL = "https://banchuyenmonsec2025.fpt.edu.vn";
//export const MANAGEMENT_API_URL = 'https://admin.fctf.site';
export const MANAGEMENT_API_URL = "https://banchuyenmonsec2025.fpt.edu.vn";

export const LOGIN_PATH = "/api/login-contestant";
export const USER_DETAILS = "/api/v1/users";
export const REGISTER_CONTESTANT = "/api/register-contestant";

//Cache
export const API_CHALLENGGE_GET_CACHE = "/api/challenge/check_cache";
export const API_CHALLENGE_CHECK_STATUS_ATTEMPT = "/api/attempt/check_cache";

export const GET_CHALLENGE_CATEGORIES_PATH = "/api/challenge/by-topic";
export const GET_CHALLENGE_LIST_PATH = "/api/challenge/list_challenge/";
export const GET_CHALLENGE_DETAILS = "/api/challenge";
export const API_CHALLENGE_GET_TOPICS = "/api/challenge/by-topic";
export const API_CHALLENGE_GET_LIST = "/api/challenges";
export const SUBMIT_FLAG = "/api/v1/challenges/attempt";

//hints
export const APi_GET_CHALLENGES_HINTS = "/api/v1/hints"; //+id
export const API_UNLOCK_HINTS = "/api/v1/unlocks"; //unlock hint
export const API_GET_UNLOCKED_HINT = "/api/v1/unlocks"; //get unlock

//Scoreboard
export const API_SCOREBOARD_TOP_STANDINGS = "/api/v1/scoreboard/top/10";

//Ticket
export const API_LIST_TICKET = "/api/tickets-user";
export const API_DETAIL_TICKET = "/api/tickets"; //details
export const API_TICKET_CREATE_BY_USER = "/api/sendticket";

export const API_CHALLEGE_START = "/api/challenge/start";
export const API_CHALLENGE_STOP = "/api/challenge/stop-by-user";
export const API_CHALLENGE_CHECK_CACHE = "/api/challenge/check_cache";

//User
export const API_USER_PROFILE = "/api/v1/users/profile";
export const API_TEAM_POINT = "/api/v1/teams/contestant";
export const API_TEAM_PERFORMANCE = "/api/team/solves";
export const API_CHANGE_PASSWORD = "/api/changepassword";
//export const API_TEAM_ACHIEVEMENT = "/api/changepassword";

//Team
export const API_CREATE_NEW_TEAM = "/api/team/create";
export const API_JOIN_TEAM = "/api/team/join";

//dowload files
export const API_FILE_DOWLOAD = "/api/files";

//config
export const API_GET_DATE_CONFIG = "/api/get_date_config";
export const API_GET_REGISTER_STATE = "/api/get_register_config";

//notifications
export const API_GET_NOTIFICATION = "/api/v1/notifications";

//action_logs
export const API_ACTION_LOGS = "api/v1/action_logs";

//replay
export const API_PUBLIC_CHALLENGE_GET_TOPICS = "/api/public/challenge/by-topic";