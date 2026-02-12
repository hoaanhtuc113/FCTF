# Challenge Gateway - Test Cases (List Format)

Test Case ID: GW-INT-001  
Test Case Description: [Integration] Health endpoint availability  
Test Case Procedure: 1) `cd Test\\Gateway` 2) `k6 run --env-file .env gateway_auth_flow.js` 3) kiểm tra group health endpoint  
Expected Output: `GET /healthz` trả `200`, check pass  
Pre-condition: Gateway đang chạy tại `GATEWAY_BASE_URL`

Test Case ID: GW-INT-002  
Test Case Description: [Integration/Security] Missing token bị chặn  
Test Case Procedure: Chạy `gateway_auth_flow.js`, kiểm tra case missing token  
Expected Output: Request protected path không token trả `401`  
Pre-condition: `PROTECTED_PATH` đúng endpoint challenge

Test Case ID: GW-INT-003  
Test Case Description: [Integration/Security] Invalid token bị chặn  
Test Case Procedure: Set `INVALID_TOKEN` trong `.env`, chạy `gateway_auth_flow.js`  
Expected Output: Invalid token trả `401`  
Pre-condition: Gateway bật auth token

Test Case ID: GW-INT-004  
Test Case Description: [Integration/Security] Expired token bị chặn  
Test Case Procedure: Set `EXPIRED_TOKEN` (hoặc runner tự sinh), chạy `gateway_auth_flow.js`  
Expected Output: Expired token trả `401`  
Pre-condition: Có `PRIVATE_KEY` + `CHALLENGE_ROUTE` hoặc token expired có sẵn

Test Case ID: GW-INT-005  
Test Case Description: [Integration] Valid token -> set cookie + redirect sạch token  
Test Case Procedure: Set `VALID_TOKEN`, chạy `gateway_auth_flow.js`, kiểm tra bootstrap checks  
Expected Output: Có `302`, có cookie `FCTF_Auth_Token`, URL redirect không còn `token`  
Pre-condition: `VALID_TOKEN` hợp lệ theo secret gateway

Test Case ID: GW-INT-006  
Test Case Description: [Integration] Cookie auth hoạt động cho request tiếp theo  
Test Case Procedure: Dùng bootstrap cookie rồi gửi request tiếp qua gateway  
Expected Output: Request được proxy, không bị `401`  
Pre-condition: Upstream route trong token reachable

Test Case ID: GW-INT-007  
Test Case Description: [Integration] Token aliases `token`, `t`, `access_token`  
Test Case Procedure: `k6 run --env-file .env gateway_integration_extended.js`, xem group token aliases  
Expected Output: Cả 3 alias đều redirect + set cookie thành công  
Pre-condition: `VALID_TOKEN` hợp lệ

Test Case ID: GW-INT-008  
Test Case Description: [Integration/Security] Token trong path segment  
Test Case Procedure: Chạy `gateway_integration_extended.js`, xem group token in path segment  
Expected Output: Token path được nhận diện, redirect sạch token  
Pre-condition: `PROTECTED_PATH` hỗ trợ pattern path token

Test Case ID: GW-INT-009  
Test Case Description: [Integration/Security] Gateway cookie không leak vào upstream  
Test Case Procedure: Chạy `gateway_integration_extended.js`, bật `STRICT_ECHO=true` nếu upstream echo headers  
Expected Output: Không thấy `FCTF_Auth_Token` ở upstream echo  
Pre-condition: Upstream có khả năng echo headers (httpbin-like)

Test Case ID: GW-INT-010  
Test Case Description: [Integration] Body nhỏ đi qua bình thường  
Test Case Procedure: Set `SMALL_BODY_BYTES`, chạy `k6 run --env-file .env gateway_body_limits.js`  
Expected Output: Body nhỏ không trả `413`, không bị `401`  
Pre-condition: `VALID_TOKEN` hợp lệ

Test Case ID: GW-INT-011  
Test Case Description: [Integration/Security] Body lớn bị chặn  
Test Case Procedure: Set `HTTP_MAX_BODY_BYTES_EXPECTED`, `BIG_BODY_BYTES`, chạy `gateway_body_limits.js`  
Expected Output: Body vượt ngưỡng trả `413`  
Pre-condition: Gateway bật `HTTP_MAX_BODY_BYTES`

Test Case ID: GW-INT-012  
Test Case Description: [Integration/Policy] Rate limit hoạt động khi flood  
Test Case Procedure: Set `RATE_LIMIT_VUS`, `MIN_429_RATIO`, chạy `k6 run --env-file .env gateway_rate_limit.js`  
Expected Output: Xuất hiện `429`, metric `gateway_rate_limit_seen` vượt ngưỡng  
Pre-condition: Redis limiter hoạt động + policy bật

Test Case ID: GW-INT-013  
Test Case Description: [Integration] Passthrough payload exploit-like  
Test Case Procedure: Chạy `k6 run --env-file .env gateway_passthrough_load.js`  
Expected Output: Payload hợp lệ được proxy, không chặn sai khi auth đúng  
Pre-condition: Upstream ổn định, token hợp lệ

Test Case ID: GW-SEC-014  
Test Case Description: [Security-Negative] Token fuzzing không bypass auth  
Test Case Procedure: Chạy `k6 run --env-file .env gateway_security_negative.js`  
Expected Output: Fuzz token luôn bị reject `401`, bypass rate = 0  
Pre-condition: Gateway auth đang bật

Test Case ID: GW-SEC-015  
Test Case Description: [Security-Negative] Malformed aliases không được phép truy cập  
Test Case Procedure: Chạy `gateway_security_negative.js`, kiểm tra case alias malformed  
Expected Output: Token lỗi qua `t`/`access_token` đều `401`  
Pre-condition: `PROTECTED_PATH` đúng

Test Case ID: GW-RES-016  
Test Case Description: [Resilience] Broken upstream trả lỗi có kiểm soát  
Test Case Procedure: Set `BROKEN_TOKEN` hoặc `BROKEN_ROUTE`, chạy `k6 run --env-file .env gateway_resilience.js`  
Expected Output: Proxy request trả `502`, không panic  
Pre-condition: Có `PRIVATE_KEY` để sinh token broken route

Test Case ID: GW-RES-017  
Test Case Description: [Resilience] Health vẫn sống sau lỗi upstream  
Test Case Procedure: Chạy `gateway_resilience.js`, kiểm tra group health after error  
Expected Output: `GET /healthz` vẫn `200` sau khi gặp lỗi upstream  
Pre-condition: Gateway process không bị crash

Test Case ID: GW-LOAD-018  
Test Case Description: [Load/Stress] Tải liên tục ở mức vận hành  
Test Case Procedure: Set `DURATION`, `REQUEST_RATE`, chạy `gateway_passthrough_load.js`  
Expected Output: Đạt threshold latency/error của script  
Pre-condition: Hạ tầng đủ tải + upstream chạy ổn

Test Case ID: GW-SPIKE-019  
Test Case Description: [Spike] Chịu tải đột biến  
Test Case Procedure: Set `SPIKE_WARM_VUS`, `SPIKE_PEAK_VUS`, chạy `k6 run --env-file .env gateway_spike.js`  
Expected Output: Hệ thống xử lý spike, không 5xx bất thường kéo dài  
Pre-condition: Gateway + upstream được monitor trong lúc test

Test Case ID: GW-SOAK-020  
Test Case Description: [Soak] Ổn định dài hạn  
Test Case Procedure: Set `SOAK_VUS`, `SOAK_DURATION`, chạy `k6 run --env-file .env gateway_soak.js`  
Expected Output: Không suy giảm rõ rệt, giữ threshold p95/p99/error  
Pre-condition: Môi trường test ổn định, không deploy trong lúc soak

Test Case ID: GW-TCP-021  
Test Case Description: [TCP Integration] Empty/invalid token bị từ chối  
Test Case Procedure: Chạy `powershell -ExecutionPolicy Bypass -File .\\gateway_tcp_auth.ps1 -GatewayHost localhost -GatewayPort 1337 -InvalidToken invalid.token`  
Expected Output: Empty/invalid token nhận `Auth failed`  
Pre-condition: TCP gateway mở cổng `1337`

Test Case ID: GW-TCP-022  
Test Case Description: [TCP Integration] Valid token được cấp quyền  
Test Case Procedure: Chạy `gateway_tcp_auth.ps1` với `-ValidToken` hợp lệ  
Expected Output: Nhận `Access Granted!`  
Pre-condition: `VALID_TOKEN` hợp lệ + upstream route TCP reachable

Test Case ID: GW-TCP-023  
Test Case Description: [TCP Stress-lite] Giới hạn concurrent kết nối theo token  
Test Case Procedure: Set `TCP_LIMIT_CONNECTIONS` cao hơn limit thực tế, chạy `gateway_tcp_limits.ps1`  
Expected Output: Có cả `granted` và `token_limited`, không exception bất thường  
Pre-condition: Gateway bật `TCP_MAX_CONNS_PER_TOKEN`

Test Case ID: GW-E2E-024  
Test Case Description: [Automation/Runner] Chạy nhanh pre-release  
Test Case Procedure: 1) `cd Test\\Gateway` 2) `./run-gateway-tests.ps1 -Type quick`  
Expected Output: Các script quick pass, summary rõ pass/fail  
Pre-condition: `.env` đã cấu hình tối thiểu

Test Case ID: GW-E2E-025  
Test Case Description: [Automation/Runner] Chạy full suite có phân loại  
Test Case Procedure: `./run-gateway-tests.ps1 -Type all -SkipLongRunning` (thêm `-StopOnFail` nếu cần)  
Expected Output: Runner chạy đúng thứ tự nhóm test, in summary đầy đủ  
Pre-condition: k6 cài sẵn, gateway + dependencies đang chạy
