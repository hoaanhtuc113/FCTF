import http from "k6/http";
import { check } from "k6";

// =========================================
// 1. DANH SÁCH USER + CHALLENGE MAPPING
// =========================================
const USERS = [
  "user3",
  "user3a1",
  "user3a2",
  "user3a4",
  "user3a5",
  "user3a6",
  "user3a7",
  "user3a8",
];

const CHALLENGE_IDS = [4, 7, 10, 1, 19, 28, 18, 31]; // mapping theo index

const PASSWORD = "1";

const LOGIN_URL =
  "https://api.fctf.cloud/contestant-be/api/auth/login-contestant";
const START_URL =
  "https://api.fctf.cloud/contestant-be/api/challenge/start";

// Chỉ cần 1 VU, 1 iteration
export const options = {
  vus: 1,
  iterations: 1,
};

// =========================================
// 2. SETUP → LOGIN 8 USER, LẤY GENERATED TOKEN
// =========================================
export function setup() {
  const sessions = [];

  for (let i = 0; i < USERS.length; i++) {
    const username = USERS[i];

    const loginBody = JSON.stringify({
      username: username,
      password: PASSWORD,
    });

    const loginParams = {
      headers: { "Content-Type": "application/json" },
    };

    const res = http.post(LOGIN_URL, loginBody, loginParams);

    console.log(`LOGIN user=${username} status=${res.status}`);

    let token = null;

    if (res.status === 200) {
      try {
        const json = res.json();

        // ⭐ ĐÚNG FORMAT BẠN ĐÃ CUNG CẤP:
        // {
        //   "generatedToken": "...",
        //   "user": {...}
        // }
        token = json.generatedToken || null;
      } catch (err) {
        console.log(`❌ Parse JSON lỗi cho user=${username}: ${err}`);
      }
    }

    sessions.push({
      username,
      challengeId: CHALLENGE_IDS[i],
      token,
    });
  }

  return { sessions };
}

// =========================================
// 3. DEFAULT → START CHALLENGE ĐỒNG THỜI
// =========================================
export default function (data) {
  const sessions = data.sessions;

  // Build mảng request cho batch()
  const requests = [];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];

    if (!s.token) {
      console.log(`❌ User ${s.username} KHÔNG có token`);
      continue;
    }

    const body = JSON.stringify({
      challengeId: s.challengeId,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.token}`,
      },
    };

    requests.push(["POST", START_URL, body, params]);
  }

  // Thời gian bắt đầu gửi batch (ms)
  const batchStart = Date.now();
  console.log(`\n===== BATCH START AT: ${batchStart} ms =====`);

  // Gửi tất cả request cùng lúc
  const responses = http.batch(requests);

  const batchEnd = Date.now();
  console.log(`===== BATCH END AT: ${batchEnd} ms =====`);
  console.log(
    `===== BATCH TOTAL TIME: ${batchEnd - batchStart} ms =====\n`
  );

  // Log từng response + timestamp
  let idx = 0;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (!s.token) continue;

    const res = responses[idx++];
    const duration = res.timings.duration; // ms

    const receivedAt = batchStart + duration;

    console.log(
      JSON.stringify({
        username: s.username,
        challengeId: s.challengeId,
        sentAt_ms: batchStart,
        receivedAt_ms: receivedAt,
        status: res.status,
        body: res.body,
      })
    );
  }
}
