# Kế Hoạch Triển Khai Cập Nhật Multi-Contest (Chi Tiết Code)

Dựa trên tài liệu `FCTF_MULTI_CONTEST.md`, `MULTI_CONTEST_ROADMAP.md` và mã nguồn hiện tại tôi đã đọc, dưới đây là **bản triển khai chi tiết từng phần cần sửa đổi** trong source code để đáp ứng kiến trúc đa cuộc thi (Multi-Contest) sử dụng chiến lược **Database-Level Isolation (Mỗi Contest 1 Schema)**.

## Giai Đoạn 1: Cập Nhật Core Library (`ResourceShared`)
Đây là bước nền tảng. Mọi service khác đều phụ thuộc vào các thay đổi này.

### 1. Quản Lý Context & Database
*   **Tạo file mới `ResourceShared/Interfaces/IContestContext.cs`**:
    *   Khai báo interface chứa `ContestId`, `ContestSlug`, `DbConnectionString`.
*   **Tạo file mới `ResourceShared/Middlewares/ContestContextMiddleware.cs`**:
    *   Middleware này sẽ bắt request từ API (vd: path `/api/c/{slug}/...`), truy vấn database `fctf_master` (có thể dùng Redis cache) để lấy thông tin DB tương ứng với `{slug}`, sau đó inject thông tin vào `IContestContext` cho vòng đời Request Scope.
*   **Tạo file mới `ResourceShared/Services/ContestDbContextFactory.cs`**:
    *   Tạo Factory để khởi tạo `AppDbContext` động dựa trên thông tin từ `IContestContext` (thay vì cố định 1 chuỗi kết nối từ `appsettings.json` trong `Program.cs` như hiện tại).
*   **Sửa đổi `ResourceShared/Models/AppDbContext.cs`**:
    *   Cập nhật logic hoặc cung cấp Constructor nhận `DbContextOptions` linh hoạt từ Factory để có thể trỏ tới `fctf_contest_1`, `fctf_contest_2`, v.v.

### 2. Cập Nhật Redis Key Isolation
Tất cả các key lưu trong Redis cần được thêm tiền tố `c{contestId}:` để tránh đụng độ giữa các cuộc thi.
*   **Sửa đổi `ResourceShared/Utils/ChallengeHelper.cs`**:
    *   `GetCacheKey(int challengeId, int teamId)` $\rightarrow$ Thêm tham số `contestId`, trả về `c{contestId}:deploy_challenge_{challengeId}_{teamId}`.
    *   `GetZSetKKey(int teamId)` $\rightarrow$ Thêm tham số `contestId`, trả về `c{contestId}:active_deploys_team_{teamId}`.
*   **Sửa đổi `ResourceShared/Utils/RedisHelper.cs`**:
    *   Cập nhật logic trong các phương thức (đặc biệt là chứa Lua script): `AtomicCheckAndCreateDeploymentZSet`, `AtomicUpdateExpiration`, `AtomicRemoveDeploymentZSet`. Các Lua script này đang dựa vào `GetZSetKKey` và `GetCacheKey`, nếu hàm Helper đã sửa thì phải đảm bảo gọi đúng.
    *   Các hàm check RateLimit, kpm, submit attempts cũng cần update thêm prefix.

### 3. Cập Nhật Kubernetes/Argo Isolation
Phân lập tên ứng dụng và namespace khi deploy pod.
*   **Sửa đổi `ResourceShared/Utils/ChallengeHelper.cs`**:
    *   `GetDeploymentAppName`: Thêm tham số `contestId`. Định dạng mới: `c{contestId}-team-{teamId}-{challengeId}-...`.
    *   `ParseDeploymentAppName`: Sửa logic regex để bóc tách thêm `contestId`. Regex mới: `@"^c(\d+)-team-(?:(\d+)|shared)-(\d+)-.*$"` (cần điều chỉnh khớp với logic của bạn).
    *   `BuildArgoPayload`: Nhận thêm `contestId`, truyền thẳng vào thiết lập K8s (thông qua Argo parameter) để pod sinh ra nằm trong đúng namespace/nhãn `c{contestId}`.
*   **Sửa đổi `ResourceShared/DTOs/RabbitMQ/ChallengeStartStopReqDTO.cs`** (hoặc Payload tương đương):
    *   Thêm thuộc tính `public int ContestId { get; set; }`.

---

## Giai Đoạn 2: Cập Nhật API Thí Sinh (`ContestantBE`)

### 1. Cấu Hình Routing & Middleware
*   **Sửa đổi `ContestantBE/Program.cs`**:
    *   Đăng ký `IContestContext`, `ContestDbContextFactory` vào DI container.
    *   Thay đổi cách `builder.Services.AddDbContext<AppDbContext>` để dùng Factory cấp phát động (trỏ tới `fctf_contest_{id}`) thay vì fix cứng.
    *   Đăng ký `ContestContextMiddleware` vào pipeline trước `TokenAuthenticationMiddleware`.
*   **Sửa đổi `ResourceShared/Middlewares/TokenAuthenticationMiddleware.cs`**:
    *   Bổ sung logic đọc `contest_id` từ Claims của JWT Token.
    *   Kiểm tra `contest_id` trong Token có khớp với `IContestContext.ContestId` của request hiện tại hay không. Chặn nếu token thuộc contest A nhưng truy cập URL contest B.
    *   Cập nhật các cache key xác thực `auth:user:{id}` thành `c{contestId}:auth:user:{id}`.

### 2. Cập Nhật Controller & Service
*   **Sửa đổi `ContestantBE/Controllers/AuthController.cs` & `Services/AuthService.cs`**:
    *   Trong hàm `LoginContestant` và `GenerateToken`: Đưa thêm `contest_id` và `contest_slug` vào JWT payload.
*   **Sửa đổi `ContestantBE/Controllers/ChallengeController.cs` & `Services/ChallengeService.cs`**:
    *   Trích xuất `ContestId` từ context (qua URL path `/api/c/{slug}`) và truyền nó vào payload RabbitMQ khi submit yêu cầu Start Challenge tới `DeploymentCenter`.
*   **Cập nhật Route Prefix của tất cả Controller**:
    *   Chuyển Route của các API (Auth, Challenge, Scoreboard, User...) thành dạng `/api/c/{contestSlug}/[controller]`.

---

## Giai Đoạn 3: Cập Nhật Điều Phối & Lắng Nghe Background

### 1. Dịch vụ Đẩy Yêu Cầu (`DeploymentCenter`)
*   **Sửa đổi `DeploymentCenter/Services/DeployService.cs`**:
    *   Bổ sung tham số `contestId` vào payload trước khi đẩy vào RabbitMQ.
    *   Tách biệt hàng đợi (Queue): Đẩy message vào queue có tên động dạng `deploy.contest.{contestId}` thay vì `deployment_queue` chung, giúp phân luồng và quản lý quota độc lập từng cuộc thi.

### 2. Dịch vụ Xử Lý Yêu Cầu (`DeploymentConsumer`)
*   **Sửa đổi `DeploymentConsumer/Worker.cs`**:
    *   Đọc `ContestId` từ message bóc ra từ RabbitMQ.
    *   Sử dụng `ContestId` khi gọi `ChallengeHelper.BuildArgoPayload`.
    *   Sử dụng `ContestId` khi thực hiện `_redisHelper.AtomicUpdateExpiration` và các update Redis khác (key có tiền tố cuộc thi).
*   **Sửa đổi `DeploymentConsumer/Services/DeploymentConsumerService.cs`**:
    *   Thay đổi logic khai báo Queue từ cố định `deployment_queue` sang cơ chế lắng nghe đa queue (sử dụng Routing keys `deploy.contest.*` với Topic Exchange hoặc đọc danh sách các contest động).

### 3. Dịch vụ Lắng Nghe K8s (`DeploymentListener`)
Dịch vụ này nhận sự kiện Pod thay đổi từ K8s và ghi lại vào Redis/DB.
*   **Sửa đổi `DeploymentListener/ChallengesInformerService.cs`**:
    *   Trong hàm `ProcessPodChangeAsync`, lấy Namespace hoặc Tên Pod, dùng `ChallengeHelper.ParseDeploymentAppName` đã sửa để trích xuất được bộ ba: `(contestId, teamId, challengeId)`.
    *   Cập nhật/Xoá trạng thái trên Redis thông qua key prefix dựa trên `contestId`.
    *   **Đặc biệt quan trọng đối với DB**: Ở các hàm có liên kết tới CSDL (như update `ChallengeStartTrackings` ở hàm `HandleDeletion`, hoặc hàm `ReconcileOrphanedCachesAsync`), bạn phải tạo `DbContext` trỏ vào đúng CSDL của `contestId` thông qua `ContestDbContextFactory`, thay vì dùng DbContext mặc định (do Pod Listener này chạy chung cho MỌI contest).

---

## Tóm Tắt Quy Trình Triển Khai (Roadmap)
1. **Pha 1 (Shared Library)**: Thêm các class `IContestContext`, Update `RedisHelper`, `ChallengeHelper` (với default = 1 để code cũ vẫn biên dịch được).
2. **Pha 2 (Multi-DB & Middleware)**: Khởi tạo Master DB `fctf_master` và thiết lập `ContestDbContextFactory`. Gắn `ContestContextMiddleware` vào ContestantBE.
3. **Pha 3 (Auth & Routing)**: Update JWT logic chứa `contest_id` và chỉnh sửa prefix Route API toàn bộ Backend.
4. **Pha 4 (Background Services)**: Sửa DeploymentConsumer & Listener để lấy `contest_id` từ payload/namespace, và điều hướng thao tác DB đến đúng CSDL của contest đó.
