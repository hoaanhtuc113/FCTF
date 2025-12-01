import http from "k6/http";
import { check } from "k6";

// =========================================
// 1. LOAD TOKENS TỪ FILE JSON
// =========================================
const TOKENS = JSON.parse(open("./tokens.json")); // { user1: "xxx", user2: "yyy" }

// =========================================
// 2. NHẬP MẢNG CHALLENGE TẠI ĐÂY
// =========================================
const CHALLENGE_IDS = [ 7, 10, 12, 19, 28, 18, 31];  
// hoặc chỉ 1 challenge:
// const CHALLENGE_IDS = [4];

const START_URL =
  "https://api.fctf.cloud/contestant-be/api/challenge/start";

export const options = {
  vus: 1,
  iterations: 1,
};

// =========================================
// HÀM CHỌN CHALLENGE (THEO INDEX HOẶC RANDOM)
// =========================================

// CÁCH 1 — Random challenge
function getChallengeRandom() {
  return CHALLENGE_IDS[Math.floor(Math.random() * CHALLENGE_IDS.length)];
}

// CÁCH 2 — Theo index user (User1 -> challenge1, User2 -> challenge2)
// function getChallengeByIndex(index) {
//   return CHALLENGE_IDS[index % CHALLENGE_IDS.length];
// }

// =========================================
// DEFAULT — START CHALLENGE ĐỒNG THỜI
// =========================================
export default function () {
  const entries = Object.entries(TOKENS); // [ ["user1","token"], ["user2","token"] ]

  if (entries.length === 0) {
    console.log("❌ tokens.json không có token nào!");
    return;
  }

  const requests = [];
  const meta = [];

  for (let i = 0; i < entries.length; i++) {
    const [username, token] = entries[i];

    // Chọn challenge:
    const challengeId = getChallengeRandom(); // <-- đổi sang getChallengeByIndex(i) nếu cần

    const body = JSON.stringify({
      challengeId: challengeId,
    });

    const params = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: "60s",
    };

    meta.push({ username, challengeId });
    requests.push(["POST", START_URL, body, params]);
  }

  const batchStart = Date.now();
  console.log(`\n===== START ${requests.length} REQUESTS AT: ${batchStart} ms =====`);

  const responses = http.batch(requests);

  const batchEnd = Date.now();
  console.log(`===== END AT: ${batchEnd} ms =====`);
  console.log(`===== TOTAL TIME: ${batchEnd - batchStart} ms =====`);

  // LOG chi tiết response từng user
  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    const info = meta[i];
    const duration = res.timings.duration;
    const receivedAt = batchStart + duration;

    check(res, {
      "status is 200": (r) => r.status === 200,
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
