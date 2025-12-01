import http from "k6/http";
import { check } from "k6";

// =========================================
// CẤU HÌNH
// =========================================
const ATTEMPT_URL =
  "https://api.fctf.cloud/contestant-be/api/challenge/attempt";

// Challenge & flag dùng chung cho tất cả user (sửa ở đây)
const CHALLENGE_ID = 4;
const SUBMISSION = "FLAG={TXT1}";

// Đọc file tokens.json (phải nằm cùng thư mục, hoặc sửa path)
// tokens.json dạng: { "user1": "token...", "user2": "token..." }
const TOKENS = JSON.parse(open("./tokens.json"));

// K6 options – 1 VU, 1 iteration, dùng batch để gửi đồng thời
export const options = {
  vus: 1,
  iterations: 1,
};

// =========================================
// 1) SETUP – LOAD HẾT DỮ LIỆU JSON TRƯỚC
// =========================================
export function setup() {
  const attempts = [];

  for (const [username, token] of Object.entries(TOKENS)) {
    attempts.push({
      username,
      token,
      challengeId: CHALLENGE_ID,
      submission: SUBMISSION,
    });
  }

  console.log(
    `✅ Đã load ${attempts.length} user từ tokens.json, chuẩn bị submit flag đồng thời`
  );

  return { attempts };
}

// =========================================
// 2) DEFAULT – GỬI TẤT CẢ REQUEST SUBMIT FLAG CÙNG LÚC
// =========================================
export default function (data) {
  const attempts = data.attempts;

  if (!attempts || attempts.length === 0) {
    console.log("❌ Không có attempt nào (tokens rỗng), dừng test");
    return;
  }

  const requests = [];
  const meta = [];

  for (const attempt of attempts) {
    const body = JSON.stringify({
      challengeId: attempt.challengeId,
      submission: attempt.submission,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attempt.token}`,
      },
      timeout: "60s",
    };

    meta.push({
      username: attempt.username,
      challengeId: attempt.challengeId,
      submission: attempt.submission,
    });

    // Mỗi phần tử: [method, url, body, params]
    requests.push(["POST", ATTEMPT_URL, body, params]);
  }

  const batchStart = Date.now();
  console.log(
    `\n===== BATCH ATTEMPT (${requests.length} users) START AT: ${batchStart} ms =====`
  );

  // 🚀 Gửi tất cả submit flag cùng lúc
  const responses = http.batch(requests);

  const batchEnd = Date.now();
  console.log(`===== BATCH ATTEMPT END AT: ${batchEnd} ms =====`);
  console.log(
    `===== BATCH TOTAL TIME: ${batchEnd - batchStart} ms =====\n`
  );

  // Log kết quả từng user
  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    const info = meta[i];

    const duration = res.timings.duration; // ms
    const receivedAt = batchStart + duration;

    check(res, {
      "attempt status is 200": (r) => r.status === 200,
    });

    console.log(
      JSON.stringify({
        username: info.username,
        challengeId: info.challengeId,
        submission: info.submission,
        sentAt_ms: batchStart,
        receivedAt_ms: receivedAt,
        duration_ms: duration,
        status: res.status,
        body: res.body,
      })
    );
  }
}
