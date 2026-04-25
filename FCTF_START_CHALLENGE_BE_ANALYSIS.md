# Phân tích Luồng Start Challenge (Backend & Redis)

> **Version:** FCTF-Multiple_Contest  
> **Ngày cập nhật:** 19/04/2026  
> **Ghi chú:** Tài liệu phân tích codebase FCTF-Multiple_Contest — nhánh phát triển Multi-Contest từ FCTF-temp-v5.

Tài liệu này phân tích chi tiết luồng xử lý kỹ thuật của tính năng **Start Challenge** (Khởi tạo máy chủ bài tập cho người chơi) trong hệ thống FCTF. Quá trình này diễn ra chủ yếu tại **ContestantBE**, bao gồm sự kết hợp giữa Controller (`ChallengeController.cs`) và Service (`ChallengeService.cs`), cùng với các cơ chế chống spam/tối ưu hiệu suất sử dụng Redis.

---

## 1. Tổng quan luồng Start Challenge

Khi người chơi nhấn nút "Start" để yêu cầu cấp một môi trường (container) chạy bài tập, yêu cầu sẽ được gửi tới API `POST /api/challenge/start`. Mục tiêu của hệ thống là:
1. Đảm bảo người chơi/đội chơi thỏa mãn tất cả các điều kiện, luật lệ của cuộc thi.
2. Ngăn chặn việc bấm liên tục gây kẹt hệ thống (Race condition / Concurrency Limit).
3. Chuyển tiếp yêu cầu một cách an toàn tới cụm Kubernetes (thông qua `DeploymentCenterAPI`) để cấp phát tài nguyên.

---

## 2. Xử lý Logic tại `ChallengeController.cs`

File `ChallengeController.cs` đóng vai trò là "người gác cổng", chịu trách nhiệm rà soát toàn bộ điều kiện trước khi cho phép yêu cầu đi tiếp. Các bước rà soát bao gồm:

### Bước 2.1: Xác thực Cơ bản
- **Authentication:** Lấy thông tin `UserId` và `TeamId` từ Token. Chỉ các thành viên đã tham gia đội (Team) mới được phép Start Challenge.
- **Tính hợp lệ của Challenge:** Bài tập phải có trạng thái `RequireDeploy = true`, không bị ẩn (`State != HIDDEN`), và không phải dạng dùng chung (`SharedInstant == false`).

### Bước 2.2: Ràng buộc Điều kiện Tiên quyết (Prerequisites)
- Nếu bài tập có trường `Requirements` (dạng JSON), hệ thống sẽ trích xuất danh sách các ID bài tiên quyết.
- So sánh tập hợp các bài đội đã giải (`solve_ids`) với danh sách yêu cầu (`prereqs`). Nếu người chơi cố tình vượt rào (chưa giải đủ bài yêu cầu) thì sẽ bị chặn lại (HTTP 403).

### Bước 2.3: Ràng buộc Luật Thi Đấu
- **Max Attempts (Giới hạn nộp sai):** Kiểm tra số lần đội nộp cờ sai. Nếu vượt quá `MaxAttempts`, hệ thống chặn quyền Start của đội đối với bài này.
- **Max Deploy Count (Giới hạn số lần sinh Pod):** Kiểm tra trong lịch sử `ChallengeStartTrackings`. Nếu số lần cấp phát vượt mức cho phép, từ chối yêu cầu.
- **Already Solved:** Nếu đội đã giải được bài này (có record trong `Solves`), việc sinh lại môi trường là lãng phí tài nguyên và sẽ bị chặn.
- **Captain Only:** Nếu cấu hình `captain_only_start_challenge` đang bật, chỉ có Đội trưởng (Captain) mới được phép gọi API sinh môi trường.

### Bước 2.4: Kiểm soát Giới hạn Đồng thời bằng Redis (Concurrency Limits)
Đây là khâu cốt lõi nhất để chống sập server và giải quyết triệt để bài toán Race Condition khi nhiều thành viên trong cùng một đội nhấn "Start" một lúc, đồng thời ngăn chặn việc sử dụng tài nguyên vượt giới hạn cho phép.

1. **Chuẩn bị dữ liệu Cache:** 
   - Hệ thống khởi tạo một đối tượng `ChallengeDeploymentCacheDTO` với trạng thái ban đầu là `DeploymentStatus.INITIAL`. Đối tượng này chứa các thông tin như `challenge_id`, `team_id`, `user_id`.

2. **Cấp phát Slot Nguyên tử (Atomic Allocation) qua ZSet:**
   - Hệ thống gọi hàm `AtomicCheckAndCreateDeploymentZSet` (sử dụng Lua Script) để thao tác với Redis ZSet (Sorted Set).
   - **Tính chất Atomic:** Lệnh Lua Script được Redis thực thi như một khối nguyên tử duy nhất. Do đó, dù 4 thành viên cùng gửi Request trong cùng 1 mili-giây, thao tác kiểm tra số lượng challenge đang chạy của đội và thêm challenge mới vào danh sách vẫn được khóa đồng bộ tuyệt đối, đảm bảo chỉ 1 request lọt qua (không có Race Condition).
   - **Kiểm soát Limit:** Quá trình chạy kịch bản Lua sẽ đếm số lượng slot hiện có trong ZSet của đội. 
     - Trả về **`LimitExceeded`**: Nếu số lượng challenge đang chạy của đội lớn hơn hoặc bằng ngưỡng `limit_challenges`, chặn ngay lập tức.
     - Trả về **`Pass`**: Nếu hợp lệ, chèn `challengeId` vào ZSet và lưu trữ thông tin trạng thái ban đầu `INITIAL` vào Cache.

3. **Xử lý linh hoạt các kịch bản trùng lặp (AlreadyExists):**
   - Nếu `challengeId` đã tồn tại trong danh sách cấp phát của đội trên Redis, hệ thống đọc lại bộ nhớ Cache của challenge đó và phản hồi tùy theo `status`:
     - **`INITIAL`**: Một thành viên khác vừa mới ấn Start và request vẫn đang ở khâu xử lý nội bộ -> Chặn request sau để tránh gọi Kubernetes API 2 lần.
     - **`PENDING`**: Pod đang được Kubernetes tạo (kéo image, init...) -> Báo frontend hiển thị *"Challenge is deploying"*.
     - **`RUNING`**: Máy chủ đã chạy hoàn tất. Hệ thống tính toán thời gian còn lại (`time_limit`) từ mốc `time_finished` trong cache và trả về URL để người chơi truy cập.
     - **`DELETING`**: Máy chủ đang được dọn dẹp -> Báo hiển thị *"Challenge is deleting"*.

---

## 3. Vai trò của `ChallengeService.cs`

Sau khi `ChallengeController` đã duyệt mọi điều kiện và giành được 1 slot trên Redis, yêu cầu sẽ được đẩy xuống hàm `ChallengeStart` của `ChallengeService.cs`.

**Đáng chú ý:** Hàm `ChallengeStart(...)` trong `ChallengeService.cs` **không hề thao tác với Redis**. Nhiệm vụ chính của nó là **Secure RPC (Gọi hàm từ xa có bảo mật)**:

1. **Tạo Chữ ký Bảo mật (HMAC):** 
   - Lấy Timestamp (`unixTime`).
   - Gộp `challengeId`, `teamId`, `userId` lại.
   - Gọi `SecretKeyHelper.CreateSecretKey` để sinh ra một mã Hash (Chữ ký).
2. **Giao tiếp nội bộ:**
   - Đính kèm Chữ ký vào Headers (`SecretKey`).
   - Bắn HTTP POST sang hệ thống nội bộ **Deployment Center** (`ContestantBEConfigHelper.DeploymentCenterAPI`).
   - Chữ ký này chống lại các cuộc tấn công phát lại (Replay Attacks) hoặc tấn công giả mạo (Spoofing) nếu kẻ xấu chọc được vào mạng nội bộ.

---

## 4. Các cơ chế Redis Xuyên suốt Luồng Start/Stop

Dù hàm `ChallengeStart` không dùng Redis, kiến trúc của hệ thống vẫn phụ thuộc sâu vào Redis ở các luồng liên quan:

### 4.1. Cơ chế Rollback Nguyên tử (Hoàn tác Slot ZSet)
Tại `ChallengeController`, bước gọi API xuống Deployment Center (`_challengeServices.ChallengeStart`) để thực tế tạo Pod có thể thất bại do: lỗi mạng nội bộ, cụm Kubernetes phía sau quá tải, hoặc hết tài nguyên phần cứng.
- Nếu `ChallengeStart` trả về status thất bại (không phải HTTP OK) hoặc văng ra `Exception`, hệ thống lập tức chui vào catch-block để chạy lệnh:
  `_redisHelper.AtomicRemoveDeploymentZSet(teamId, deploymentKey, challengeId)`
- **Ý nghĩa sống còn:** Cơ chế này giải phóng "slot" đã chiếm thành công ở Bước 2.4 ra khỏi danh sách ZSet của đội trên Redis, đồng thời xóa luôn dữ liệu Cache trạng thái. Nó đảm bảo tính toàn vẹn (consistency) giữa Database/Cluster và Redis, để đội chơi không bị "kẹt" slot ảo (tức là không trừ được lượt chạy challenge) bởi một tiến trình sinh Pod đã chết yểu giữa chừng.

### 4.2. Distributed Lock (Khóa phân tán) khi Stop Challenge
Ở hàm `ForceStopChallenge` (trong `ChallengeService.cs`), hệ thống đối mặt với bài toán: *Nhiều người cùng nhấn Stop một lúc*.
- Hệ thống dùng `_redisLockHelper.AcquireLock` để sinh ra một "ổ khóa" Redis.
- Chỉ người gọi đầu tiên cầm được khóa và được phép gửi lệnh Stop sang Kubernetes. Những người gọi trong vòng 30 giây tiếp theo sẽ bị văng lỗi *"Stop request is already in progress"*. Việc này giúp giảm tải triệt để cho Cluster.

### 4.3. Polling trạng thái (Đọc Cache tốc độ cao)
Hàm `CheckChallengeStart` (API để frontend liên tục tải lại xem Pod sinh xong chưa) không đụng vào Database. Nó sử dụng `_redisHelper.GetFromCacheAsync` đọc trực tiếp từ RAM, mang lại độ trễ cực thấp (< 5ms) và bảo vệ Database SQL khỏi hàng ngàn request / giây.

---

## Tổng kết
Luồng Start Challenge của hệ thống FCTF được thiết kế rất chặt chẽ. Việc dời phần kiểm tra và cấp phát giới hạn (Redis ZSet) lên Controller giúp loại bỏ sớm các request không hợp lệ. Việc tách biệt `ChallengeService` thành Cổng giao tiếp bảo mật (Secure RPC) giúp cô lập hệ thống Contestant với hệ thống Kubernetes nhạy cảm phía sau.

---
*Tài liệu được cập nhật lần cuối 19/04/2026 — Phân tích source code FCTF-Multiple_Contest. Bởi Antigravity AI.*
