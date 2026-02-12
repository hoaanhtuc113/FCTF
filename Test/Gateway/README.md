# Gateway Test Suite (ChallengeGateway)

Bộ test này tập trung vào đúng mục tiêu của gateway: **token-based access control + proxy transparency** để thí sinh có thể exploit challenge gần như truy cập trực tiếp.

## Mục tiêu test

- Xác thực token đúng/sai/hết hạn cho cả HTTP và TCP gateway.
- Kiểm tra flow query token -> set cookie -> redirect sạch token.
- Đo khả năng passthrough traffic kiểu exploit (XSS payload, SQLi-like payload, race-style burst).
- Đo hành vi rate-limit để tránh phá hạ tầng nhưng không chặn nhầm người dùng hợp lệ.
- Đảm bảo không xuất hiện 5xx từ gateway khi upstream hoạt động bình thường.

## Bộ metric khuyến nghị

### 1) Availability & Reliability
- `http_req_failed` (k6): lỗi HTTP tổng thể.
- `gateway_upstream_5xx`: số phản hồi 5xx (script custom metric).
- `gateway_auth_unexpected`: số case auth lệch kỳ vọng trong smoke test.

### 2) Latency (UX exploit-realistic)
- `http_req_duration p(95), p(99)` cho kịch bản `passthrough`.
- Mục tiêu ban đầu:
  - p(95) < 1200ms
  - p(99) < 2500ms
  (tinh chỉnh theo hạ tầng thật)

### 3) Security Gate Behavior
- Tỷ lệ `401` cho missing/invalid/expired token phải đúng.
- Xác nhận redirect loại bỏ `token` khỏi URL.
- `gateway_blocked_ratio`: tỷ lệ 401/403/429 trong luồng tải hợp lệ (nên thấp).

### 4) Rate-Limit Behavior
- `gateway_rate_limit_seen`: tỷ lệ 429 trong kịch bản cố tình flood.
- `MIN_429_RATIO` để fail test nếu limiter không hoạt động.

### 5) TCP Auth Path
- Empty token -> `Auth failed`.
- Invalid token -> `Auth failed`.
- Valid token -> có `Access Granted`.

## File trong thư mục

- `gateway_auth_flow.js`: integration smoke (missing/invalid/expired/valid token, redirect + cookie).
- `gateway_integration_extended.js`: integration nâng cao (token aliases, token in path, cookie strip check).
- `gateway_body_limits.js`: integration boundary (small/large body, kiểm tra 413).
- `gateway_rate_limit.js`: integration policy (rate limit behavior, 429 ratio).
- `gateway_security_negative.js`: security-negative (token fuzzing, malformed aliases).
- `gateway_resilience.js`: resilience (broken upstream -> 502, health vẫn sống).
- `gateway_passthrough_load.js`: load test payload exploit-like liên tục.
- `gateway_spike.js`: spike test tăng tải đột ngột.
- `gateway_soak.js`: soak test dài hạn.
- `gateway_tcp_auth.ps1`: TCP integration smoke auth.
- `gateway_tcp_limits.ps1`: TCP concurrency/limit test (per-token connection limit).
- `gateway_helpers.js`: helper chung cho k6 scripts.
- `generate-gateway-token.ps1`: tạo token hợp lệ/hết hạn bằng `PRIVATE_KEY`.
- `run-gateway-tests.ps1`: runner full suite theo loại test (`-Type`).
- `.env.example`: mẫu cấu hình.

## Chuẩn bị nhanh

```powershell
cd Test\Gateway
Copy-Item .env.example .env
notepad .env
```

Nếu có `PRIVATE_KEY` giống gateway và route challenge test:
- Chỉ cần điền `PRIVATE_KEY`, `CHALLENGE_ROUTE`.
- Runner sẽ tự sinh `VALID_TOKEN` + `EXPIRED_TOKEN`.

Nếu đã có token sẵn:
- điền trực tiếp `VALID_TOKEN` (và optional `EXPIRED_TOKEN`).

## Chạy test

### Chạy full suite (khuyên dùng cho staging)
```powershell
cd Test\Gateway
.\run-gateway-tests.ps1 -Type all -SkipLongRunning
```

### Chạy nhanh trước release
```powershell
.\run-gateway-tests.ps1 -Type quick
```

### Chạy theo loại test
```powershell
# Integration
.\run-gateway-tests.ps1 -Type integration

# Security negative
.\run-gateway-tests.ps1 -Type security

# Resilience
.\run-gateway-tests.ps1 -Type resilience

# Load
.\run-gateway-tests.ps1 -Type load -SkipTcp

# Spike
.\run-gateway-tests.ps1 -Type spike -SkipTcp

# Soak (long running)
.\run-gateway-tests.ps1 -Type soak -SkipTcp

# TCP only
.\run-gateway-tests.ps1 -Type tcp
```

### Chạy fail-fast
`-StopOnFail` để dừng ngay khi có script fail.

### Chạy TCP script riêng lẻ
```powershell
.\gateway_tcp_auth.ps1 -GatewayHost localhost -GatewayPort 1337 -ValidToken "<token>"

.\gateway_tcp_limits.ps1 -GatewayHost localhost -GatewayPort 1337 -ValidToken "<token>" -ConnectionCount 30
```

## Mapping: script nào là loại test nào

| Script | Loại test |
|---|---|
| `gateway_auth_flow.js` | Integration (smoke) |
| `gateway_integration_extended.js` | Integration |
| `gateway_body_limits.js` | Integration + Boundary/Security |
| `gateway_rate_limit.js` | Integration (policy) |
| `gateway_security_negative.js` | Security-Negative |
| `gateway_resilience.js` | Resilience |
| `gateway_passthrough_load.js` | Load/Stress |
| `gateway_spike.js` | Spike |
| `gateway_soak.js` | Soak |
| `gateway_tcp_auth.ps1` | TCP Integration |
| `gateway_tcp_limits.ps1` | TCP Stress-lite/Limit |

## Gợi ý đánh giá pass/fail theo mục tiêu vận hành

- Auth smoke: tất cả check pass, `gateway_auth_unexpected == 0`.
- Passthrough load:
  - `http_req_failed < 5%`
  - `gateway_upstream_5xx == 0`
  - `gateway_blocked_ratio < 2%` (khi không cố tình vượt ngưỡng)
- Rate-limit test:
  - `gateway_rate_limit_seen > MIN_429_RATIO`
  - không có 5xx bất thường.
- TCP smoke: cả 3 case pass (empty/invalid/valid).

## Lưu ý thực tế cho CTF gateway

- Nếu challenge app không có endpoint echo, đặt `ASSERT_ECHO=false` (mặc định).
- Để đo “trải nghiệm thí sinh như direct access”, nên chạy thêm A/B:
  - direct vào challenge service,
  - qua gateway,
  rồi so sánh p95/p99 và tỷ lệ lỗi.
- Với test race/exploit thực chiến, giữ payload đa dạng nhưng tránh payload phá dữ liệu production.
