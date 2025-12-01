// test nhiều user cùng 1 team start 1 challenge đồng thời


import http from "k6/http";
import { check } from "k6";

// =========================================
// 1. TẠO DANH SÁCH USER1 → USER100
// =========================================
const USERS = [];
for (let i = 1; i <= 200; i++) {
  USERS.push(`user${i}`);
}

// 2 challenge dùng để random
const CHALLENGE_IDS = [4];

const PASSWORD = "Fctf2025@";

const LOGIN_URL =
  "https://api.fctf.cloud/contestant-be/api/auth/login-contestant";
const START_URL =
  "https://api.fctf.cloud/contestant-be/api/challenge/start";

// Chỉ cần 1 VU, 1 iteration → dùng batch để gửi đồng thời
export const options = {
  vus: 1,
  iterations: 1,
};

// =========================================
// 2. SETUP → LOGIN 100 USER, LẤY GENERATED TOKEN (ĐỒNG THỜI + TIMEOUT DÀI)
// =========================================
export function setup() {
  const sessions = [];

  // Tạo batch request login cho tất cả user
  const loginRequests = [];

  for (let i = 0; i < USERS.length; i++) {
    const username = USERS[i];

    const loginBody = JSON.stringify({
      username: username,
      password: PASSWORD,
    });

    const loginParams = {
      headers: { "Content-Type": "application/json" },
      timeout: "260s", // ⬅ tăng thời gian chờ login lên 60 giây
    };

    // Mỗi phần tử trong batch: [method, url, body, params]
    loginRequests.push(["POST", LOGIN_URL, loginBody, loginParams]);
  }

  // 🚀 Gửi TẤT CẢ login cùng lúc
  const loginResponses = http.batch(loginRequests);

  // Xử lý kết quả login
  for (let i = 0; i < loginResponses.length; i++) {
    const res = loginResponses[i];
    const username = USERS[i];

    console.log(`LOGIN user=${username} status=${res.status}`);

    let token = null;

    if (res.status === 200) {
      try {
        const json = res.json();
        // Format login:
        // {
        //   "generatedToken": "...",
        //   "user": {...}
        // }
        token = json.generatedToken || null;
      } catch (err) {
        console.log(`❌ Parse JSON lỗi cho user=${username}: ${err}`);
      }
    } else {
      console.log(`❌ Login FAIL user=${username} body=${res.body}`);
    }

    sessions.push({
      username,
      token,
    });
  }

  return { sessions };
}

// =========================================
// 3. DEFAULT → 100 USER START CHALLENGE ĐỒNG THỜI (RANDOM 2 CHALLENGE)
// =========================================
export default function (data) {
  const sessions = data.sessions;

  const requests = [];
  const meta = []; // lưu meta để map lại response

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];

    if (!s.token) {
      console.log(`❌ User ${s.username} KHÔNG có token → bỏ qua`);
      continue;
    }

    // Chọn challenge ngẫu nhiên từ CHALLENGE_IDS
    const randomIndex = Math.floor(Math.random() * CHALLENGE_IDS.length);
    const challengeId = CHALLENGE_IDS[randomIndex];

    const body = JSON.stringify({
      challengeId: challengeId,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.token}`,
      },
    };

    // Lưu meta để dùng lại sau khi batch xong
    meta.push({
      username: s.username,
      challengeId: 4,
    });

    // Mỗi phần tử trong batch: [method, url, body, params]
    requests.push(["POST", START_URL, body, params]);
  }

  // Nếu không có user nào login thành công thì dừng
  if (requests.length === 0) {
    console.log("❌ Không có request nào được gửi (không có token hợp lệ)");
    return;
  }

  // Thời gian bắt đầu gửi batch (ms)
  const batchStart = Date.now();
  console.log(`\n===== BATCH START AT: ${batchStart} ms =====`);

  // Gửi tất cả request start challenge cùng lúc
  const responses = http.batch(requests);

  const batchEnd = Date.now();
  console.log(`===== BATCH END AT: ${batchEnd} ms =====`);
  console.log(
    `===== BATCH TOTAL TIME: ${batchEnd - batchStart} ms =====\n`
  );

  // Log từng response + timestamp
  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    const info = meta[i];

    const duration = res.timings.duration; // ms
    const receivedAt = batchStart + duration;

    check(res, {
      "start challenge status 200": (r) => r.status === 200,
    });

    console.log(
      JSON.stringify({
        username: info.username,
        challengeId: info.challengeId,
        sentAt_ms: batchStart,
        receivedAt_ms: receivedAt,
        duration_ms: duration,
        status: res.status,
        body: res.body,
      })
    );
  }
}
