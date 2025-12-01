// login_and_save_tokens.js
import fs from "fs";

// =====================
// CONFIG
// =====================

const LOGIN_URL =
  "https://api.fctf.cloud/contestant-be/api/auth/login-contestant";

const PASSWORD = "Fctf2025@";
const TOTAL_USERS = 2000;
const OUTPUT_FILE = "tokens.json";

// Số request login chạy song song một lúc
const CONCURRENCY = 50; // chỉnh lên/xuống tùy sức server (vd: 20, 50, 100)

// =====================
// TẠO DANH SÁCH USER
// =====================

function generateUsers() {
  const arr = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    arr.push(`user${i}`);
  }
  return arr;
}

const USERS = generateUsers();

// =====================
// HÀM LOGIN USER
// =====================

async function loginUser(username) {
  try {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username,
        password: PASSWORD,
      }),
    });

    if (!res.ok) {
      console.log(`❌ Login FAIL for ${username} | status=${res.status}`);
      return null;
    }

    const data = await res.json();

    // Format: { "generatedToken": "...", "user": {...} }
    const token = data.generatedToken || null;

    if (!token) {
      console.log(`⚠️ Login OK nhưng KHÔNG có generatedToken cho ${username}`);
      return null;
    }

    console.log(`✅ Login OK for ${username}`);
    return token;
  } catch (err) {
    console.log(`❌ Error login ${username}:`, err);
    return null;
  }
}

// =====================
// HELPER: CHẠY VỚI GIỚI HẠN CONCURRENCY
// =====================

async function runWithConcurrency() {
  const TOKENS = {};

  console.log(`🚀 Bắt đầu login ${TOTAL_USERS} user với CONCURRENCY = ${CONCURRENCY}...\n`);

  for (let i = 0; i < USERS.length; i += CONCURRENCY) {
    const batch = USERS.slice(i, i + CONCURRENCY);
    console.log(`\n➡️ Đang xử lý batch từ index ${i} đến ${i + batch.length - 1}`);

    // Login song song cho cả batch
    const results = await Promise.all(
      batch.map((username) => loginUser(username))
    );

    // Lưu token cho từng user trong batch
    results.forEach((token, idx) => {
      const username = batch[idx];
      if (token) {
        TOKENS[username] = token;
      }
    });
  }

  // Ghi file JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(TOKENS, null, 2), "utf8");

  console.log(
    `\n🎉 Hoàn tất! Đã lưu ${Object.keys(TOKENS).length}/${TOTAL_USERS} token vào file: ${OUTPUT_FILE}`
  );
}

// chạy script
runWithConcurrency();
