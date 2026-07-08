# Danh sách câu hỏi Security Review chuyên sâu cho hệ thống FCTF

Danh sách này được chia theo các chủ đề thiết kế lõi, tập trung vào việc **khai thác các kẽ hở (edge cases)** và **đảm bảo tính nhất quán của hệ thống**. Sử dụng tài liệu này để bảo vệ dự án (defend), phỏng vấn, hoặc tổ chức các buổi review sâu về khía cạnh Security.

---

## 1. Kiến trúc định danh SSO (Keycloak OIDC Integration)
Nhóm câu hỏi này tập trung vào kẽ hở khi tích hợp giữa hai hệ thống độc lập (FCTF và KYPO) qua Keycloak.

1. **Quản lý vòng đời Token:** Nếu tài khoản của một thí sinh bị vô hiệu hóa (Disabled/Banned) ngay giữa cuộc thi trên Keycloak, làm sao FCTF biết để thu hồi quyền truy cập (Revoke Access) ngay lập tức khi mà JWT Token vẫn còn hạn sử dụng? Hệ thống có dùng cơ chế Token Introspection hay chỉ dựa vào chữ ký (JWKS)?
2. **User Identity Mapping:** FCTF map user qua claim `sub` của JWT. Chuyện gì sẽ xảy ra nếu cơ sở dữ liệu FCTF có một `user_id` bị trùng lặp hoặc nếu ID từ KYPO thay đổi? Có cơ chế nào phòng chống "Account Takeover" qua việc thao túng luồng redirect OIDC không?
3. **Session Fixation / Replay Attack:** Khi redirect từ Keycloak về FCTF, làm sao hệ thống đảm bảo Authorization Code hoặc Access Token không bị đánh cắp ở giữa (MITM) và dùng lại bởi attacker? FCTF có cài đặt các chuẩn bảo mật như PKCE (Proof Key for Code Exchange) hay xác minh state parameter không?

---

## 2. Cách ly logic và Multi-Tenancy (Logic Isolation)
Nhóm câu hỏi này kiểm tra tính an toàn của việc chỉ dùng `contest_id` để chia tách dữ liệu thay vì dùng schema/database riêng (vốn an toàn tuyệt đối hơn).

4. **IDOR (Insecure Direct Object Reference):** Nếu một thí sinh ở `contest_A` biết được `challenge_id` hoặc `team_id` của `contest_B`, và họ gửi request API lên server nhưng thao tác ở các bảng không trực tiếp chứa `contest_id` (ví dụ bảng con của bảng challenge), hệ thống làm sao để chặn truy cập chéo này ở Service Layer?
5. **Race Condition trong Logic Validation:** Nếu hai request được gửi đồng thời lên server: một request xin đổi team sang contest khác, một request xin lấy cờ của contest hiện tại, hệ thống có lock row hoặc kiểm tra tính toàn vẹn (ACID transactions) để tránh việc lấy được cờ của contest mới không?
6. **Redis Key Overwrite:** Nếu lập trình viên quên thêm prefix `contest_{id}` ở một tính năng mới trong Redis, điều gì ngăn chặn việc team ở contest này ghi đè state (ví dụ thời gian hết hạn) của team ở contest kia?

---

## 3. Vấn đề "Ghost Pods" và Quản lý vòng đời Hạ tầng
Nhóm câu hỏi này xoáy vào tính chịu lỗi (Fault Tolerance) của hệ thống tương tác với Kubernetes.

7. **Message Queue Failure:** Khi Admin cập nhật Challenge, hệ thống bắn `ForceStop` vào RabbitMQ. Nếu RabbitMQ bị sập ngay thời điểm đó, K8s Pod sẽ trở thành Ghost Pod mãi mãi (vì hệ thống lỡ xóa DB/Redis rồi). Làm sao hệ thống phát hiện ra Pod bị "mồ côi" này?
8. **Reconciliation Delay (Độ trễ đồng bộ):** Khi Listener chờ K8s phát event `Deleted` rồi mới cập nhật DB, nếu API K8s bị quá tải và event này bị rớt (dropped), Redis cache sẽ kẹt ở trạng thái "Đang chạy" mãi mãi. Fallback cơ chế "Orphan Synchronization" chạy bao lâu một lần và xử lý ra sao?
9. **Khai thác thời gian chờ dọn dẹp:** Hàm `StopAll` khi kết thúc cuộc thi chạy từ từ qua từng namespace. Nếu có 1000 pods cần xoá và mất 5 phút để xoá xong, liệu thí sinh có thể tranh thủ "cày điểm" trong 5 phút đó không?

---

## 4. An toàn của Dynamic Flags (Chống chia sẻ cờ)
Cơ chế sinh cờ động là một điểm sáng, nhưng cũng có thể bị qua mặt nếu luồng tiêm (injection) không chặt chẽ.

10. **Container Escape / Secret Leakage:** Dynamic Flag được chèn vào Kubernetes Secret và mount vào Environment Variable của Pod. Nếu challenge yêu cầu thí sinh có quyền RCE (Remote Code Execution) trong Pod, làm sao ngăn thí sinh này dùng lệnh `env` hoặc đọc `/proc/self/environ` để lấy ra cờ thẳng thay vì phải thực sự giải bài?
11. **Random Generator Entropy:** Chuỗi sinh cờ động (`FCTF{teamId_randomSecret}`) dùng thuật toán sinh số ngẫu nhiên nào? Nếu dùng `Math.random()` thì attacker có thể đoán trước (predict) được chuỗi của các instance khởi tạo cùng thời điểm không?
12. **Tính kiên định của Flag (Flag Persistence):** Nếu pod bị CrashLoopBackOff và K8s tự động khởi động lại pod đó, cờ động được sinh ra lại từ đầu hay vẫn giữ nguyên cờ của instance trước đó? Nếu đổi cờ liên tục thì thí sinh submit có bị lỗi không?

---

## 5. Challenge Gateway & Bypass Network Policy
Gateway là cổng duy nhất, đây là ranh giới sống còn của hệ thống.

13. **Gateway Token Theft:** `FCTF_Auth_Token` được lưu vào Cookie HttpOnly. Nếu attacker lợi dụng lỗ hổng CSRF trên một trang khác của FCTF để gọi vào Gateway, liệu Gateway có cơ chế SameSite Cookie hay Anti-CSRF token để chặn request mạo danh này không?
14. **Rate Limit Bypass qua X-Forwarded-For:** Gateway rate limit dựa trên IP. Vì hệ thống nằm sau Nginx Ingress, nếu attacker thao túng HTTP Header `X-Forwarded-For: <IP_GIẢ>`, họ có thể bypass toàn bộ Rate Limit (vượt quá 1000 conns/IP) để làm sập hệ thống không?
15. **Denial of Service qua Gateway State:** Gateway sử dụng `TCPIPConn.Acquire()` để đếm số lượng kết nối TCP. Attacker mở 4.000 TCP connections ảo (Half-open / SYN Flood) và giữ nguyên không nhập Token, liệu cơ chế Timeout (5 giây) có đủ nhanh để ngăn Gateway cạn kiệt tài nguyên (Connection Pool Exhaustion) không?
