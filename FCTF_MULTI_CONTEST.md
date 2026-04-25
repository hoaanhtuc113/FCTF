# FCTF — Tổng Hợp Các Phần Cần Sửa Cho Multi-Contest

> **Ngày tạo:** 15/04/2026  
> **Ngày cập nhật:** 19/04/2026  
> **Mục tiêu:** Liệt kê toàn bộ thành phần cần thay đổi để hệ thống hỗ trợ nhiều cuộc thi đồng thời  
> **Repo hiện tại:** FCTF-Multiple_Contest (triển khai từ đây)

---

## 0. Background — Tại Sao Cần Multi-Contest?

### 0.1. Hệ Thống Hiện Tại (v5) Đang Gặp Vấn Đề Gì?

FCTF-temp-v5 được thiết kế để phục vụ **một cuộc thi duy nhất tại một thời điểm**. Toàn bộ kiến trúc — database, Redis, K8s namespace, JWT token — đều không có khái niệm phân biệt giữa các cuộc thi.

Hệ quả thực tế khi tổ chức muốn chạy 2 cuộc thi cùng lúc:

| Vấn đề | Biểu Hiện |
|---|---|
| **Database dùng chung** | Submissions, solves, scoreboard của contest A lẫn lộn với contest B |
| **Redis key collision** | `deploy_challenge_42_5` của contest 1 ghi đè lên contest 2 → deployment state sai |
| **K8s namespace collision** | `deploy-challenge-42-team-5` bị tạo trùng → pod deploy fail hoặc overwrite nhau |
| **JWT không có contest scope** | Token của thí sinh contest 1 có thể dùng để truy cập challenge của contest 2 |
| **Scoreboard sai** | Bảng xếp hạng tổng hợp tất cả team của mọi cuộc thi vào cùng 1 bảng |
| **Config toàn cục** | `ctf_name`, `start`, `end`, `freeze` chỉ có 1 tập — không thể cấu hình riêng từng contest |
| **Admin không phân quyền được** | Không có cơ chế giới hạn admin chỉ quản lý contest của mình |

### 0.2. Tại Sao Cần Mở Rộng?

FCTF hiện tại chỉ phục vụ được **1 đơn vị tổ chức** tại 1 thời điểm. Khi nhu cầu mở rộng sang nhiều đơn vị hoặc nhiều vòng thi, hệ thống không thể đáp ứng mà không có sự thay đổi kiến trúc căn bản:

- **Nhiều đơn vị tổ chức** muốn chạy cuộc thi riêng trên cùng hạ tầng — ví dụ công ty A tổ chức vòng sơ loại, công ty B tổ chức giải nội bộ cùng thời điểm.
- **Nhiều vòng thi liên tiếp hoặc song song** — vòng sơ loại, bán kết, chung kết chạy overlap nhau.
- **Tái sử dụng hạ tầng** — thay vì dựng lại toàn bộ hệ thống mỗi lần tổ chức thi, chỉ cần tạo thêm contest mới trên cùng cluster.
- **Quản lý tập trung** — super-admin nhìn thấy toàn bộ các cuộc thi, từng contest có admin riêng.

### 0.3. Tại Sao Argo Workflows Là Điểm Nghẽn Chính?

Khi số contest tăng, số lượng người dùng đồng thời tăng theo cấp số nhân. Argo Workflows là thành phần chịu tải nặng nhất vì **mỗi lần thí sinh click "Start Challenge" = 1 Argo Workflow được submit**.

```
1 contest  × 100 teams × 5 challenge đang deploy = 500 workflows
3 contests × 100 teams × 5 challenge đang deploy = 1.500 workflows  ← Argo bắt đầu lag
5 contests × 100 teams × 5 challenge đang deploy = 2.500 workflows  ← Argo quá tải
```

Vấn đề cụ thể:

- **Argo Controller** là single-process — reconcile loop chậm lại khi queue tích tụ, thí sinh thấy challenge "pending" mãi không lên.
- **Global `MAX_RUNNING_WORKFLOW`** không phân biệt contest — contest 1 có thể flood hết slot, contest 2 và 3 không submit được workflow nào (starvation).
- **etcd bị hammered** khi hàng trăm workflow submit gần cùng lúc (đầu giờ thi) → K8s API Server throttle → toàn bộ hệ thống chậm.

### 0.4. Mục Tiêu Của Đợt Refactor Này

- Cho phép chạy **nhiều cuộc thi độc lập** trên cùng 1 hạ tầng mà không có data leak giữa các contest.
- Giải quyết bottleneck Argo bằng **per-contest quota** và **namespace isolation**.
- Giữ chi phí hạ tầng hợp lý — không tốn gấp N lần tài nguyên khi có N contests.
- Không phá vỡ cuộc thi đang chạy trong quá trình migration.

---

## Kiến Trúc Mục Tiêu

```
1 Server (K3s cluster)
  │
  ├── Shared (1 pod, dùng chung cho tất cả contest)
  │     ├── MariaDB          ← nhiều database bên trong
  │     ├── Redis            ← nhiều key prefix bên trong
  │     ├── RabbitMQ         ← nhiều queue bên trong
  │     ├── Argo Controller  ← nhiều namespace bên trong
  │     ├── DeploymentConsumer
  │     ├── DeploymentListener
  │     └── DeploymentCenter
  │
  └── Per-Contest (thêm 2 pod mỗi khi tạo contest mới)
        ├── ContestantBE-contest-{id}
        └── CTFd-contest-{id}
```

---

## 1. Database (MariaDB)

**Thay đổi:** Tạo thêm database `fctf_master` và mỗi contest có 1 database riêng.

```
MariaDB (1 instance)
  ├── fctf_master        ← quản lý danh sách contests, super-admin
  ├── fctf_contest_1     ← toàn bộ data contest 1
  ├── fctf_contest_2     ← toàn bộ data contest 2
  └── fctf_contest_3     ← toàn bộ data contest 3
```

**Cần làm:**

- Tạo database `fctf_master` với các bảng:

```sql
CREATE TABLE contests (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    name        VARCHAR(255) NOT NULL,
    db_name     VARCHAR(100) NOT NULL,
    status      ENUM('draft','published','running','ended','archived') DEFAULT 'draft',
    start_time  DATETIME,
    end_time    DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- Schema bên trong mỗi `fctf_contest_{id}` giữ nguyên 100% so với v5 — không cần thêm cột `contest_id`.
- Viết script migration đổi tên DB hiện tại thành `fctf_contest_1`, seed `fctf_master` với contest đầu tiên.

---

## 2. Redis

**Thay đổi:** Thêm prefix `c{contestId}:` vào tất cả key.

| Key cũ (v5) | Key mới |
|---|---|
| `deploy_challenge_{id}_{teamId}` | `c{cid}:deploy:{id}:{teamId}` |
| `active_deploys_team_{teamId}` | `c{cid}:deploys:team:{teamId}` |
| `auth:user:{id}` | `c{cid}:auth:user:{id}` |
| `kpm_check_{userId}_{minute}` | `c{cid}:kpm:{userId}:{minute}` |
| `submission_cooldown_{chId}_{teamId}` | `c{cid}:cooldown:{chId}:{teamId}` |
| `attempt_count_{chId}_{teamId}` | `c{cid}:attempts:{chId}:{teamId}` |

**Thêm key mới** để track quota per contest:

```
c{cid}:running_workflows   ← đếm số workflow đang chạy của contest đó
```

**File cần sửa:** `ResourceShared/Utils/RedisHelper.cs` — thêm tham số `contestId` vào tất cả method.

---

## 3. RabbitMQ

**Thay đổi:** Tạo queue riêng per contest thay vì 1 queue chung.

```
RabbitMQ (1 instance)
  ├── Queue: deploy.contest.1
  ├── Queue: deploy.contest.2
  └── deploy.contest.{n}  ← tạo tự động khi có contest mới
```

**Cập nhật message payload** — thêm `ContestId`:

```csharp
// ResourceShared/DTOs/Deployments/DeploymentQueuePayload.cs
public class DeploymentQueuePayload
{
    public int ContestId { get; set; }   // NEW
    public int ChallengeId { get; set; }
    public int TeamId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime Expiry { get; set; }
    public string? Data { get; set; }
}
```

---

## 4. Argo Workflows

**Thay đổi:** Không tách Argo thành nhiều instance — vẫn dùng 1 Argo Controller. Dùng **namespace isolation + parallelism quota** per contest.

```
Argo Controller (1 instance)
  ├── Namespace: argo-contest-1  (quota: 30 workflows đồng thời)
  ├── Namespace: argo-contest-2  (quota: 30 workflows đồng thời)
  └── Namespace: argo-contest-3  (quota: 20 workflows đồng thời)
```

**Cấu hình quota:**

```yaml
# workflow-controller-configmap
data:
  namespaceParallelism: |
    argo-contest-1: 30
    argo-contest-2: 30
    argo-contest-3: 20
```

**K8s namespace naming convention** cho challenge pods:

```
# Cũ:
deploy-challenge-{challengeId}-team-{teamId}

# Mới:
c{contestId}-deploy-challenge-{challengeId}-team-{teamId}
```

**K8s labels** thêm `ctf/contest-id`:

```yaml
metadata:
  labels:
    ctf/kind: challenge
    ctf/contest-id: "1"       # NEW
    ctf/challenge-id: "42"
    ctf/team-id: "5"
```

**File cần sửa:** `ResourceShared/Utils/ChallengeHelper.cs`
- Cập nhật namespace naming pattern
- Cập nhật `ParseDeploymentAppName()` để extract `contestId` từ namespace name:

```csharp
public static (int contestId, int challengeId, int teamId) ParseDeploymentAppName(string appName)
{
    // Pattern: "c{cid}-deploy-challenge-{chid}-team-{tid}"
    var match = Regex.Match(appName, @"^c(\d+)-deploy-challenge-(\d+)-team-(\d+)$");
    return (int.Parse(match.Groups[1].Value),
            int.Parse(match.Groups[2].Value),
            int.Parse(match.Groups[3].Value));
}
```

---

## 5. ResourceShared (Core Library)

Đây là phần quan trọng nhất — thay đổi ở đây ảnh hưởng toàn bộ services.

**Các file cần tạo mới:**

### IContestContext.cs
```csharp
public interface IContestContext
{
    int ContestId { get; }
    string ContestSlug { get; }
    string DbConnectionString { get; }
}
```

### ContestContextMiddleware.cs
Extract `contestId` từ URL path `/api/c/{contestSlug}/...`, lookup `fctf_master` để lấy connection string, inject `IContestContext` vào DI scope của request.

### ContestDbContextFactory.cs
```csharp
public class ContestDbContextFactory
{
    public AppDbContext CreateForContest(int contestId)
    {
        var dbName = $"fctf_contest_{contestId}";
        // build connection string động
        // return new AppDbContext với connection string đó
    }
}
```

### MasterDbContext.cs
DbContext riêng để đọc `fctf_master` — tra cứu danh sách contest, slug → db_name.

**Các file cần sửa:**

| File | Thay đổi |
|---|---|
| `Utils/RedisHelper.cs` | Thêm `contestId` prefix vào tất cả key method |
| `Utils/ChallengeHelper.cs` | Cập nhật namespace pattern, ParseDeploymentAppName |
| `DTOs/Deployments/DeploymentQueuePayload.cs` | Thêm `ContestId` field |
| `Models/AppDbContext.cs` | Hỗ trợ dynamic connection switching |

---

## 6. ContestantBE

**Thay đổi:** Mỗi contest chạy 1 pod riêng, kết nối vào database của contest đó.

**Cách hoạt động:**
```
Request: GET /api/c/fctf-2026/challenges
  ↓
ContestContextMiddleware:
  1. Extract slug = "fctf-2026" từ URL
  2. Query fctf_master → lấy db_name = "fctf_contest_1"
  3. Inject IContestContext vào DI scope
  ↓
Controller xử lý request với đúng database
```

**API routes mới** — thêm contest prefix:

```
/api/c/{contestSlug}/auth/login
/api/c/{contestSlug}/challenge/by-topic
/api/c/{contestSlug}/challenge/{id}
/api/c/{contestSlug}/challenge/attempt
/api/c/{contestSlug}/scoreboard
```

**JWT claims mới** — thêm `contest_id`:

```json
{
  "sub": "42",
  "contest_id": "1",
  "contest_slug": "fctf-2026",
  "team_id": "5",
  "exp": 1777000000
}
```

**Các file cần sửa:**

| File | Thay đổi |
|---|---|
| `Program.cs` | Đăng ký `IContestContext`, `ContestDbContextFactory`, middleware |
| `AuthController.cs` | JWT include `contest_id` claim |
| `TokenAuthenticationMiddleware.cs` | Extract `contest_id` từ JWT, inject vào `IContestContext` |
| `ChallengeController.cs` | Pass `contestId` xuống tất cả service calls |
| `ConfigController.cs` | Đọc config từ đúng database contest |
| `ScoreboardController.cs` | Query chỉ trong scope của contest |

---

## 7. DeploymentCenter

**Thay đổi:** Giữ 1 pod chung — chỉ cần nhận thêm `contestId` trong mọi API call.

**Các file cần sửa:**

```csharp
// DeploymentCenter/Services/DeployService.cs
public async Task Start(int contestId, int challengeId, int teamId, ...)
{
    // Redis key có contest prefix
    var cacheKey = RedisHelper.GetDeployKey(contestId, challengeId, teamId);

    // Message payload chứa contestId
    var payload = new DeploymentQueuePayload
    {
        ContestId = contestId,
        ChallengeId = challengeId,
        TeamId = teamId,
        ...
    };

    // Push vào đúng queue của contest
    await _rabbitMq.PublishAsync($"deploy.contest.{contestId}", payload);
}
```

| File | Thay đổi |
|---|---|
| `Services/DeployService.cs` | Nhận `contestId`, dùng Redis prefix + đúng RabbitMQ queue |
| `Controllers/ChallengeController.cs` | Extract `contestId` từ request, pass xuống service |

---

## 8. DeploymentConsumer

**Thay đổi:** Giữ 1 pod chung — cần listen nhiều queue + áp dụng per-contest quota.

**Per-contest quota:**

```csharp
// Trước khi submit Argo:
var contestRunning = await redis.IncrAsync($"c{contestId}:running_workflows");
if (contestRunning > CONTEST_MAX_WORKFLOW)
{
    await redis.DecrAsync($"c{contestId}:running_workflows");
    // Re-queue với delay
    return;
}

// Submit Argo workflow vào namespace argo-contest-{contestId}...

// Sau khi workflow done:
await redis.DecrAsync($"c{contestId}:running_workflows");
```

**Round-robin consumer** qua các contest queue thay vì FIFO thuần:

```
Thay vì: contest1, contest1, contest1... (flood)
Dùng:    contest1, contest2, contest3, contest1, contest2...
```

**Các file cần sửa:**

| File | Thay đổi |
|---|---|
| `Worker.cs` | Listen nhiều queue, round-robin poll |
| `Services/ArgoWorkflowService.cs` | Submit workflow vào namespace đúng contest |

---

## 9. DeploymentListener

**Thay đổi:** Giữ 1 pod chung — parse `contestId` từ namespace name khi nhận K8s event.

```csharp
// Nhận Pod event từ K8s
// namespace: "c1-deploy-challenge-42-team-5"
var (contestId, challengeId, teamId) =
    ChallengeHelper.ParseDeploymentAppName(pod.Metadata.NamespaceName);

// Cập nhật đúng Redis key
var cacheKey = RedisHelper.GetDeployKey(contestId, challengeId, teamId);

// Cập nhật đúng database
var dbContext = _contestDbContextFactory.CreateForContest(contestId);

// Giảm quota counter
await redis.DecrAsync($"c{contestId}:running_workflows");
```

**Các file cần sửa:**

| File | Thay đổi |
|---|---|
| `ChallengesInformerService.cs` | Parse `contestId` từ namespace, route event đến đúng Redis scope + DB |

---

## 10. ChallengeGateway (Go)

**Thay đổi:** Thêm `contest_id` vào JWT payload, cập nhật rate limit key.

**JWT token mới:**

```json
{
  "route": "10.0.5.100:5000",
  "exp": 1777000000,
  "team_id": 5,
  "challenge_id": 42,
  "contest_id": 1        // NEW
}
```

**Rate limit key mới:**

```go
// Cũ: "{token_hash}:{ip}"
// Mới: "c{contestId}:{token_hash}:{ip}"
func rateLimitKey(contestId int, tokenHash, ip string) string {
    return fmt.Sprintf("c%d:%s:%s", contestId, tokenHash, ip)
}
```

**Các file cần sửa:**

| File | Thay đổi |
|---|---|
| `internal/gateway/util.go` | Thêm `contest_id` vào JWT payload |
| `internal/limiter/` | Cập nhật rate limit key có contest prefix |

---

## 11. CTFd (FCTF-ManagementPlatform)

**Thay đổi:** Mỗi contest chạy 1 CTFd pod riêng, trỏ vào database của contest đó. Không sửa code CTFd.

```yaml
# docker-compose.yml hoặc K8s manifest
ctfd-contest-1:
  image: fctf-management-platform
  environment:
    - DATABASE_URL=mysql://user:pass@db/fctf_contest_1
  # Nginx route: admin.fctf.io/contest/1/ → ctfd-contest-1

ctfd-contest-2:
  image: fctf-management-platform
  environment:
    - DATABASE_URL=mysql://user:pass@db/fctf_contest_2
  # Nginx route: admin.fctf.io/contest/2/ → ctfd-contest-2
```

---

## 12. ContestantPortal (React Frontend)

**Thay đổi:** Thêm contest slug vào URL, tạo ContestContext.

**Routes mới:**

| Route | Trang |
|---|---|
| `/` | `ContestList.tsx` — danh sách cuộc thi |
| `/contest/{slug}` | `ContestDetail.tsx` — chi tiết + đăng ký |
| `/contest/{slug}/login` | `Login.tsx` |
| `/contest/{slug}/challenges` | `Challenges.tsx` — có sẵn, adapt lại |
| `/contest/{slug}/scoreboard` | `Scoreboard.tsx` — có sẵn, adapt lại |

**API base URL động:**

```typescript
// Cũ:
const API_BASE = import.meta.env.VITE_API_BASE_URL;

// Mới:
function getApiBase(contestSlug: string): string {
    return `${import.meta.env.VITE_API_BASE_URL}/api/c/${contestSlug}`;
}
```

**Các file cần sửa/tạo:**

| File | Thay đổi |
|---|---|
| `App.tsx` | Thêm contest routing |
| `context/ContestContext.tsx` | Tạo mới — wrap toàn bộ app |
| `config/api.ts` | Dynamic API base URL theo contestSlug |
| `pages/ContestList.tsx` | Tạo mới |
| `pages/ContestDetail.tsx` | Tạo mới |

---

## 13. Infrastructure & Deployment

**Docker Compose / K8s manifest cần cập nhật:**

```yaml
services:
  # SHARED — không đổi gì nhiều
  db:
    # Thêm init script tạo fctf_master + fctf_contest_1
  cache:
    # Giữ nguyên
  rabbitmq:
    # Giữ nguyên — queue tạo tự động khi consumer kết nối
  argo:
    # Giữ nguyên — thêm namespaceParallelism config
  deployment-consumer:
    # Giữ nguyên image, sửa code bên trong
  deployment-listener:
    # Giữ nguyên image, sửa code bên trong
  deployment-center:
    # Giữ nguyên image, sửa code bên trong

  # PER-CONTEST — thêm mỗi khi tạo contest mới
  contestant-be-contest-1:
    environment:
      - CONTEST_ID=1
      - CONTEST_SLUG=fctf-2026
      - DB_NAME=fctf_contest_1

  ctfd-contest-1:
    environment:
      - DATABASE_URL=mysql://...fctf_contest_1
```

---

## 14. Bảng Tổng Hợp

| Thành Phần | Pod | Thay Đổi Chính |
|---|---|---|
| **MariaDB** | 1 chung | Thêm `fctf_master`, tạo DB per contest |
| **Redis** | 1 chung | Prefix `c{contestId}:` cho tất cả key |
| **RabbitMQ** | 1 chung | Queue riêng `deploy.contest.{id}` per contest |
| **Argo Controller** | 1 chung | Namespace + parallelism quota per contest |
| **ResourceShared** | — | Thêm `IContestContext`, `ContestDbContextFactory`, cập nhật `RedisHelper`, `ChallengeHelper` |
| **DeploymentConsumer** | 1 chung | Listen nhiều queue, per-contest quota |
| **DeploymentListener** | 1 chung | Parse `contestId` từ namespace name |
| **DeploymentCenter** | 1 chung | Nhận `contestId` qua API, pass xuống service |
| **ContestantBE** | **Per-Contest** | Dynamic DB connection, JWT có `contest_id`, routes có slug |
| **CTFd** | **Per-Contest** | 1 instance per contest, không sửa code |
| **ChallengeGateway** | 1 chung | Thêm `contest_id` vào JWT, rate limit key có prefix |
| **ContestantPortal** | 1 chung (SPA) | Routes mới, ContestContext, dynamic API URL |

---

## 15. Thứ Tự Thực Hiện Khuyến Nghị

```
Tuần 1-2 — Foundation
  ├─ Tạo fctf_master schema + migration script
  ├─ Cập nhật ResourceShared: IContestContext, RedisHelper, ChallengeHelper
  ├─ Cập nhật DeploymentQueuePayload thêm ContestId
  └─ Unit test Redis key isolation

Tuần 3-4 — Backend
  ├─ ContestantBE: middleware extract contest, dynamic DB, JWT mới
  ├─ DeploymentCenter: nhận + pass contestId
  ├─ DeploymentConsumer: multi-queue listener, per-contest quota
  └─ DeploymentListener: parse contestId từ namespace

Tuần 5 — Gateway & Infra
  ├─ ChallengeGateway: cập nhật JWT + rate limit key
  ├─ Argo: cấu hình namespaceParallelism
  └─ Docker Compose / K8s manifest per-contest

Tuần 6-7 — Frontend
  ├─ ContestantPortal: ContestContext, routes mới, dynamic API URL
  └─ Trang ContestList, ContestDetail

Tuần 8 — Kiểm Thử
  ├─ Integration test: 2 contest chạy đồng thời, verify không leak data
  ├─ Load test: 100 team per contest, đo latency Argo
  └─ Security audit: Redis key isolation, JWT scope
```

---

*Tài liệu tổng hợp kiến trúc FCTF Multi-Contest — 15/04/2026*
