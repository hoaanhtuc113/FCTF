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
- `gateway_race_under_load.js`: race-style burst (concurrent) dưới nền tải cao.
- `gateway_spike.js`: spike test tăng tải đột ngột.
- `gateway_soak.js`: soak test dài hạn.
- `gateway_tcp_auth.ps1`: TCP integration smoke auth.
- `gateway_tcp_limits.ps1`: TCP concurrency/limit test (per-token connection limit).
- `gateway_helpers.js`: helper chung cho k6 scripts.
- `generate-gateway-token.ps1`: tạo token hợp lệ/hết hạn bằng `PRIVATE_KEY`.
- `generate-gateway-token.py`: bản Linux/macOS (Python) để tạo token giống gateway.
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
- Runner sẽ tự sinh `VALID_TOKEN` + `EXPIRED_TOKEN` (bash runner dùng `generate-gateway-token.py`; PowerShell runner dùng `.ps1`).

Nếu đã có token sẵn:
- điền trực tiếp `VALID_TOKEN` (và optional `EXPIRED_TOKEN`).

### Linux/macOS (không cần PowerShell)

`k6` không có flag `--env-file` ở một số phiên bản; cách ổn định là **export env vars từ `.env`** rồi chạy `k6 run`.

```bash
cd Test/Gateway
set -a
source ./.env
set +a

# cần có VALID_TOKEN hợp lệ để pass full integration
export VALID_TOKEN='<token>'

k6 run gateway_auth_flow.js
```

TCP smoke nhanh (empty/invalid token) có thể probe bằng `nc`:

```bash
printf "\n" | nc -w 5 "$TCP_GATEWAY_HOST" "$TCP_GATEWAY_PORT"
printf "invalid.token\n" | nc -w 5 "$TCP_GATEWAY_HOST" "$TCP_GATEWAY_PORT"
```

## Chạy test

### Chạy tự động (Linux/macOS) – khuyên dùng

Runner Bash sẽ:

- `source` file `.env`
- chạy curl smoke + các k6 script theo `--type`
- tự tạo folder log theo timestamp trong `test-results/<timestamp>/`
- tự sinh file báo cáo `TestReport_<timestamp>.md`

```bash
cd Test/Gateway
chmod +x ./run-gateway-tests.sh
./run-gateway-tests.sh --type quick
```

Chạy full (bỏ long-running nếu cần):

```bash
./run-gateway-tests.sh --type all --skip-long-running
```

Chạy full **bao gồm** load/spike/soak (có thể mất lâu, tuỳ `SOAK_DURATION`):

```bash
./run-gateway-tests.sh --type all
```

Chạy riêng bài race-under-load (mô phỏng burst đồng thời dưới nền tải):

```bash
./run-gateway-tests.sh --type race
```

Mô phỏng **nhiều team** cùng lúc (mỗi token ~ 1 team):

- Cách 1 (ngắn): set `RACE_TOKENS_CSV` trong `.env` (phân tách bằng dấu phẩy), ví dụ: `RACE_TOKENS_CSV=tokA,tokB,tokC`
- Cách 2 (nhiều token): tạo file (mỗi dòng 1 token) và set `RACE_TOKENS_FILE=./race_tokens.txt` trong `.env`, runner bash sẽ tự nạp vào `RACE_TOKENS_CSV`.

Lưu ý: chạy từ 1 máy sẽ dùng chung 1 source IP ⇒ dễ đụng limiter theo IP sớm hơn thực tế. Nếu cần sát thực tế nhiều team từ nhiều IP, nên chạy distributed load từ nhiều host.

Nếu bạn muốn chạy body-limit (không khuyến nghị nếu upstream không support POST):

```bash
./run-gateway-tests.sh --type integration --include-body-limits
```

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
./run-gateway-tests.ps1 -Type integration

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
| `gateway_race_under_load.js` | Race/Load |
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
