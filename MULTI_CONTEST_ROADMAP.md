# FCTF — Roadmap Triển Khai Multi-Contest

> **Ngày tạo:** 15/04/2026  
> **Ngày cập nhật:** 19/04/2026  
> **Version nguồn:** FCTF-temp-v5  
> **Version mục tiêu:** FCTF-Multiple_Contest  
> **Mục tiêu:** Chuyển đổi từ single-contest sang multi-contest platform — cho phép tổ chức **nhiều cuộc thi độc lập** trên cùng một hệ thống hạ tầng.  
> **Trạng thái:** Đang triển khai trong FCTF-Multiple_Contest.

---

## 📋 Mục Lục

1. [Phân Tích Hiện Trạng — Vấn Đề Single-Contest](#1-phân-tích-hiện-trạng--vấn-đề-single-contest)
2. [Tầm Nhìn Kiến Trúc Multi-Contest](#2-tầm-nhìn-kiến-trúc-multi-contest)
3. [Chiến Lược Triển Khai: Ba Hướng Tiếp Cận](#3-chiến-lược-triển-khai-ba-hướng-tiếp-cận)
4. [Hướng Được Khuyến Nghị: Contest-Per-Schema (Approach B)](#4-hướng-được-khuyến-nghị-contest-per-schema-approach-b)
5. [Thiết Kế Database Schema Multi-Contest](#5-thiết-kế-database-schema-multi-contest)
6. [Thay Đổi Từng Layer Service](#6-thay-đổi-từng-layer-service)
7. [Redis Key Isolation](#7-redis-key-isolation)
8. [Kubernetes & Argo — Namespace Isolation](#8-kubernetes--argo--namespace-isolation)
9. [ChallengeGateway — Routing Multi-Contest](#9-challengegateway--routing-multi-contest)
10. [ContestantPortal — UI Multi-Contest](#10-contestantportal--ui-multi-contest)
11. [FCTF-ManagementPlatform — Admin Multi-Contest](#11-fctf-managementplatform--admin-multi-contest)
12. [Docker Compose & Infrastructure Scaling](#12-docker-compose--infrastructure-scaling)
13. [Migration Plan: Từ v5 Lên Multi-Contest](#13-migration-plan-từ-v5-lên-multi-contest)
14. [Kế Hoạch Thực Thi Theo Giai Đoạn](#14-kế-hoạch-thực-thi-theo-giai-đoạn)
15. [Rủi Ro & Điểm Cần Lưu Ý](#15-rủi-ro--điểm-cần-lưu-ý)

---

## 1. Phân Tích Hiện Trạng — Vấn Đề Single-Contest

### 1.1. Kiến Trúc Hiện Tại (v5)

Toàn bộ hệ thống FCTF-temp-v5 được thiết kế để phục vụ **một cuộc thi duy nhất tại một thời điểm**. Bằng chứng:

| Điểm | Chi tiết |
|---|---|
| **Database** | Tất cả bảng (`challenges`, `users`, `teams`, `submissions`, `solves`, ...) không có cột `contest_id` — toàn bộ dữ liệu flat trong một schema duy nhất |
| **Config table** | Bảng `config` (key-value) chứa cấu hình cuộc thi (`ctf_name`, `start`, `end`, `freeze`...) — chỉ một tập config toàn cục |
| **Redis cache keys** | Pattern: `deploy_challenge_{id}_{teamId}` — không phân biệt contest |
| **K8s namespaces** | Pattern: `deploy-challenge-{id}-team-{teamId}` — không có contest prefix |
| **JWT token** | Payload chứa `challengeId`, `teamId`, `route` — thiếu `contestId` |
| **ContestantBE** | `ConfigService` đọc config từ DB không có contest filter |
| **ContestantPortal** | URL routes không có `/contest/{id}/...` prefix |
| **FCTF-ManagementPlatform** | CTFd fork quản lý một cuộc thi — không có khái niệm multi-contest |

### 1.2. Hậu Quả Nếu Không Thay Đổi

- Chạy hai cuộc thi đồng thời → **dữ liệu lẫn lộn** (solves, submissions của team A cuộc thi 1 lẫn với cuộc thi 2)
- Redis cache key collision → **deployment state bị ghi đè**
- K8s namespace collision → **pod deploy fail hoặc overwrite nhau**
- Scoreboard hiển thị tổng hợp tất cả team của mọi cuộc thi
- Impossible để phân quyền admin theo cuộc thi

---

## 2. Tầm Nhìn Kiến Trúc Multi-Contest

### 2.1. Mô Hình Mục Tiêu

```
                        ┌─────────────────────────────┐
                        │   Contest Manager (Admin)   │  Portal mới — quản lý nhiều contest
                        │   + FCTF-ManagementPlatform │
                        └──────────────┬──────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               │                       │                       │
        ┌──────▼──────┐         ┌──────▼──────┐        ┌───────▼──────┐
        │  Contest #1 │         │  Contest #2 │        │  Contest #3  │
        │  (FCTF-CTF) │         │  (ACMCPC-Q1)│        │  (Security)  │
        │  Jan 2026   │         │  Feb 2026   │        │  Mar 2026    │
        └──────┬──────┘         └──────┬──────┘        └──────┬───────┘
               │                       │                      │
               └───────────────────────┴──────────────────────┘
                                       │
                          ┌────────────▼──────────────┐
                          │    Shared Infrastructure  │
                          │  MariaDB | Redis | K8s    │
                          │  RabbitMQ | Argo          │
                          └───────────────────────────┘
```

### 2.2. Yêu Cầu Cốt Lõi

| Yêu cầu | Mô tả |
|---|---|
| **Isolation dữ liệu** | Mỗi contest có user, team, challenge, submission riêng |
| **Isolation runtime** | Pod K8s của contest A không xung đột với contest B |
| **Isolation cache** | Redis key phân biệt rõ theo contest |
| **Multi-admin** | Mỗi contest có nhóm admin riêng |
| **Concurrent contests** | Nhiều cuộc thi chạy cùng lúc |
| **Contest lifecycle** | Draft → Published → Running → Ended → Archived |
| **Shared challenges** | Có thể tái sử dụng challenge image giữa các contests |
| **Contestant UX** | Thí sinh thấy danh sách cuộc thi, đăng ký và thi |

---

## 3. Chiến Lược Triển Khai: Ba Hướng Tiếp Cận

### Approach A: One Database Schema — Add `contest_id` Column

**Mô tả:** Thêm cột `contest_id` (FK) vào tất cả bảng hiện tại.

```sql
ALTER TABLE challenges ADD COLUMN contest_id INT NOT NULL;
ALTER TABLE users ADD COLUMN contest_id INT;
ALTER TABLE teams ADD COLUMN contest_id INT NOT NULL;
ALTER TABLE submissions ADD COLUMN contest_id INT NOT NULL;
ALTER TABLE solves ADD COLUMN contest_id INT NOT NULL;
-- ... tất cả bảng liên quan
```

| ✅ Ưu điểm | ❌ Nhược điểm |
|---|---|
| Đơn giản nhất về infrastructure | Mọi query phải thêm `WHERE contest_id = ?` — dễ quên, bug |
| Một DB connection pool | Schema hiện tại (CTFd fork) rất phức tạp — dễ miss join |
| Dễ report cross-contest | Index phức tạp hơn — performance giảm khi nhiều contest |
| | FCTF-ManagementPlatform (Python CTFd) không hỗ trợ sẵn |

### Approach B: One Schema Per Contest (Database-Level Isolation)

**Mô tả:** Mỗi contest có một **database schema riêng** (MariaDB database), dùng chung MariaDB server.

```
MariaDB Server:
  ├── fctf_contest_1    ← DB cho contest 1
  ├── fctf_contest_2    ← DB cho contest 2
  ├── fctf_contest_3    ← DB cho contest 3
  └── fctf_master       ← DB global (quản lý contest metadata, super-admin)
```

| ✅ Ưu điểm | ❌ Nhược điểm |
|---|---|
| Isolation hoàn toàn — không có bug contest_id thiếu | Cần dynamic connection switching |
| Schema hiện tại không cần thay đổi | Migration phức tạp hơn A |
| FCTF-ManagementPlatform chạy với DB riêng per contest | Số lượng connection pool tăng |
| Dễ backup, restore, archive từng contest | |
| Có thể chạy multiple CTFd instances nếu cần | |

### Approach C: One Stack Per Contest (Full Isolation via Docker/K8s)

**Mô tả:** Mỗi contest là một bộ service hoàn toàn riêng (ContestantBE, DB, Redis riêng), chỉ share K8s cluster.

| ✅ Ưu điểm | ❌ Nhược điểm |
|---|---|
| Isolation tuyệt đối | Tốn gấp N lần tài nguyên |
| Không cần thay đổi code nhiều | Khó quản lý khi nhiều contests |
| Rollback từng contest độc lập | Không share resources hiệu quả |

### 🏆 Kết Luận

**Khuyến nghị: Approach B (One Schema Per Contest)**

Lý do: Cân bằng tốt giữa isolation và hiệu quả tài nguyên. Schema hiện tại giữ nguyên → ít code change. Phù hợp với scale up tới ~20 contest đồng thời.

---

## 4. Hướng Được Khuyến Nghị: Contest-Per-Schema (Approach B)

### 4.1. Khái Niệm "Master DB"

Tạo một DB `fctf_master` để lưu thông tin contests toàn cục:

```sql
-- fctf_master database
CREATE TABLE contests (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    slug        VARCHAR(100) UNIQUE NOT NULL,   -- 'fctf-2026', 'internal-q1'
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    db_name     VARCHAR(100) NOT NULL,           -- 'fctf_contest_1'
    status      ENUM('draft','published','running','ended','archived') DEFAULT 'draft',
    start_time  DATETIME,
    end_time    DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by  INT,                             -- super-admin user id
    logo_url    VARCHAR(500),
    is_public   BOOLEAN DEFAULT TRUE             -- visible trên trang danh sách contests
);

CREATE TABLE contest_admins (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    contest_id  INT NOT NULL,
    user_id     INT NOT NULL,                    -- user trong fctf_master
    role        ENUM('owner','admin','moderator') DEFAULT 'admin',
    FOREIGN KEY (contest_id) REFERENCES contests(id)
);

CREATE TABLE super_users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(100) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,           -- hash SHA256 (compat CTFd)
    email       VARCHAR(255),
    role        ENUM('superadmin','admin') DEFAULT 'admin',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2. Luồng Tạo Contest Mới

```
Super-Admin tạo contest mới qua Contest Manager:
    │
    ▼
1. Tạo record trong fctf_master.contests (slug, name, db_name='fctf_contest_{id}')
    │
    ▼
2. Tạo database MariaDB mới: CREATE DATABASE fctf_contest_{id}
    │
    ▼
3. Run migrations (tạo toàn bộ table structure y hệt v5)
    │
    ▼
4. Seed dữ liệu mặc định (config table: ctf_name, start, etc.)
    │
    ▼
5. Khởi động instance ContestantBE/DeploymentCenter với env:
   DB_CONNECTION=...fctf_contest_{id}...
   CONTEST_ID={id}
   CONTEST_SLUG={slug}
    │
    ▼
6. Cập nhật routing: /contest/{slug}/api/* → ContestantBE instance đúng
```

### 4.3. Mô Hình Instance Service

#### Option 1: Shared Service + Contest Routing (Recommended cho ≤ 10 contests)

```
ContestantBE (single instance)
    │  Nhận header/path: Contest-Id hoặc /api/c/{contestId}/...
    │  Dynamic connection switching theo contestId
    ▼
Database Router → fctf_contest_{contestId}
```

#### Option 2: One Service Instance Per Contest (Recommended cho > 10 contests)

```
ContestantBE-Contest1 → fctf_contest_1
ContestantBE-Contest2 → fctf_contest_2
ContestantBE-Contest3 → fctf_contest_3
```

Dùng Nginx/K8s Ingress để route:
```
/api/c/fctf-2026/* → ContestantBE-Contest1:5010
/api/c/internal-q1/* → ContestantBE-Contest2:5010
```

---

## 5. Thiết Kế Database Schema Multi-Contest

### 5.1. Schema Dùng Chung (fctf_master)

Như đã mô tả ở mục 4.1. Thêm bảng:

```sql
-- Theo dõi log tạo/xóa contest
CREATE TABLE contest_audit_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    contest_id  INT,
    action      VARCHAR(100),   -- 'create', 'start', 'pause', 'end', 'archive'
    actor_id    INT,
    detail      TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cấu hình chia sẻ giữa contest (challenge images đã build)
CREATE TABLE shared_challenge_images (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    image_name  VARCHAR(255),
    image_tag   VARCHAR(100),
    registry    VARCHAR(255),
    description TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2. Schema Từng Contest (fctf_contest_{id})

**Giữ nguyên 100% schema hiện tại của v5** — không thay đổi structural:

```
challenges, users, teams, submissions, solves, hints, hint_unlocks,
flags, files, config, action_logs, challenge_start_tracking,
deploy_histories, tickets, comments, notifications, ...
```

**Chỉ thêm một số field/table nhỏ:**

```sql
-- Thêm vào bảng users: liên kết với master account (nếu dùng SSO)
ALTER TABLE users ADD COLUMN master_user_id INT;

-- Bảng mới: registration approval (nếu contest cần approval)  
CREATE TABLE contest_registrations (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    team_name   VARCHAR(100),
    status      ENUM('pending','approved','rejected') DEFAULT 'pending',
    applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by INT
);
```

### 5.3. Kế Hoạch Migration từ Schema v5 Hiện Tại

```bash
# Đổi tên DB hiện tại thành contest đầu tiên
RENAME DATABASE ctfd TO fctf_contest_1;

# Tạo DB master mới
CREATE DATABASE fctf_master;

# Seed master với contest đầu tiên
INSERT INTO fctf_master.contests (id, slug, name, db_name, status)
VALUES (1, 'fctf-2026-s1', 'FCTF 2026 Season 1', 'fctf_contest_1', 'running');
```

---

## 6. Thay Đổi Từng Layer Service

### 6.1. ResourceShared — Thay Đổi Core

#### A. Thêm Contest Context vào DI

```csharp
// ResourceShared/Interfaces/IContestContext.cs (NEW)
public interface IContestContext
{
    int ContestId { get; }
    string ContestSlug { get; }
    string DbConnectionString { get; }
}

// ResourceShared/Services/ContestContextMiddleware.cs (NEW)
// Extract contestId từ:
//   - HTTP Header: X-Contest-Id
//   - JWT claim: contest_id
//   - URL path: /api/c/{contestSlug}/...
// Sau đó inject IContestContext vào DI scope
```

#### B. Dynamic Database Connection

```csharp
// ResourceShared/Services/ContestDbContextFactory.cs (NEW)
public class ContestDbContextFactory
{
    private readonly IContestContext _contestContext;
    private readonly IConfiguration _config;
    
    public AppDbContext CreateForContest(int contestId)
    {
        // Lookup connection string từ fctf_master
        var dbName = $"fctf_contest_{contestId}";
        var baseConn = _config["DB_CONNECTION_BASE"]; // host, user, pass
        var connStr = BuildConnectionString(baseConn, dbName);
        
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseMySql(connStr, MySqlVersion)
            .Options;
            
        return new AppDbContext(options);
    }
}
```

#### C. Cập Nhật AppDbContext — Thêm Connection Factory

```csharp
// Hiện tại: Đăng ký một DbContext với connection string cố định
// Mục tiêu: Đăng ký IDbContextFactory<AppDbContext> + ContestDbContextFactory

// Program.cs của mỗi service:
builder.Services.AddDbContextFactory<AppDbContext>(options => ...);
builder.Services.AddScoped<IContestContext, ContestContextFromHeader>();
builder.Services.AddScoped<AppDbContext>(sp => {
    var factory = sp.GetRequiredService<ContestDbContextFactory>();
    var ctx = sp.GetRequiredService<IContestContext>();
    return factory.CreateForContest(ctx.ContestId);
});
```

#### D. Redis Key Helper — Contest Prefix

```csharp
// ResourceShared/Utils/RedisHelper.cs — Thêm contest prefix vào mọi key

// HIỆN TẠI:
public static string GetDeployKey(int challengeId, int teamId)
    => $"deploy_challenge_{challengeId}_{teamId}";

// MỚI:
public static string GetDeployKey(int contestId, int challengeId, int teamId)
    => $"c{contestId}:deploy_challenge_{challengeId}_{teamId}";

// Áp dụng tương tự cho mọi key pattern:
// c{contestId}:active_deploys_team_{teamId}
// c{contestId}:auth:user:{id}
// c{contestId}:kpm_check_{userId}_{minute}
// c{contestId}:submission_cooldown_{challengeId}_{teamId}
// c{contestId}:attempt_count_{challengeId}_{teamId}
```

#### E. ChallengeHelper — Contest ID trong Argo & Namespace

```csharp
// ResourceShared/Utils/ChallengeHelper.cs

// HIỆN TẠI:
// K8s namespace: deploy-challenge-{id}-team-{teamId}
// Redis cache key: deploy_challenge_{id}_{teamId}

// MỚI:
// K8s namespace: c{contestId}-deploy-challenge-{id}-team-{teamId}
// Redis cache key: c{contestId}:deploy_challenge_{id}_{teamId}

// ParseDeploymentAppName cần cập nhật để extract contestId từ namespace name
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

### 6.2. ContestantBE — Backend Thí Sinh

#### Thay Đổi Cần Thiết

| File | Thay đổi |
|---|---|
| `Program.cs` | Đăng ký `IContestContext`, `ContestDbContextFactory`, middleware extract contest |
| `AuthController.cs` | JWT phải include `contest_id` claim |
| `ConfigController.cs` | `ConfigService.GetConfig()` → read từ DB của đúng contest |
| `ChallengeController.cs` | Pass `contestId` xuống tất cả service calls |
| `ScoreboardController.cs` | Query chỉ trong scope của contest |
| `TokenAuthenticationMiddleware.cs` | Decode JWT, extract `contest_id`, inject vào `IContestContext` |

#### API Routes Mới

```
# Thêm contest prefix vào URL (Option 1: Path-based routing)
/api/c/{contestSlug}/auth/login
/api/c/{contestSlug}/challenge/by-topic
/api/c/{contestSlug}/challenge/{id}
/api/c/{contestSlug}/challenge/attempt
/api/c/{contestSlug}/scoreboard
...

# Hoặc dùng header (Option 2: Header-based routing)
GET /api/challenge/by-topic
Headers: X-Contest-Id: 1
```

**Khuyến nghị:** Dùng **path-based routing** (`/api/c/{contestSlug}/...`) — rõ ràng hơn, dễ debug, không cần header custom.

#### JWT Claims Mới

```json
{
  "sub": "42",
  "contest_id": "1",
  "contest_slug": "fctf-2026",
  "team_id": "5",
  "exp": 1777000000
}
```

---

### 6.3. DeploymentCenter — Điều Phối Deploy

#### Thay Đổi Cần Thiết

```csharp
// DeploymentCenter/Services/DeployService.cs

// Method Start phải nhận thêm contestId:
public async Task<...> Start(int contestId, int challengeId, int teamId, ...)
{
    // Redis key bao gồm contestId
    var cacheKey = RedisHelper.GetDeployKey(contestId, challengeId, teamId);
    
    // Message payload cũng phải chứa contestId
    var payload = new DeploymentQueuePayload 
    { 
        ContestId = contestId,
        ChallengeId = challengeId,
        TeamId = teamId,
        ...
    };
}
```

#### Cập Nhật DTOs

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

### 6.4. DeploymentConsumer — Background Worker

#### Thay Đổi Cần Thiết

```csharp
// DeploymentConsumer/Worker.cs & Services/ArgoWorkflowService.cs

// Khi build Argo payload:
var argoPayload = ChallengeHelper.BuildArgoPayload(
    challenge,
    message.ContestId,   // NEW — để tạo namespace có contest prefix
    message.TeamId,
    message.ChallengeId,
    ...
);

// Namespace K8s: c{contestId}-deploy-challenge-{challengeId}-team-{teamId}
```

#### Argo Workflow Template Per Contest (Optional)

Nếu muốn isolation hoàn toàn, tạo Argo WorkflowTemplate riêng cho từng contest:
```
fctf-start-challenge-contest-1
fctf-start-challenge-contest-2
```

Hoặc dùng chung template nhưng truyền `contestId` vào parameter.

---

### 6.5. DeploymentListener — K8s Watcher

#### Thay Đổi Cần Thiết

```csharp
// DeploymentListener/ChallengesInformerService.cs

// Label selector hiện tại: ctf/kind=challenge
// Mới: Có thể thêm label: ctf/contest-id={contestId}
// Khi parse namespace: extract contestId từ namespace name
// Khi update Redis: dùng key có contest prefix

// Watch filter (nếu chạy per-contest listener):
var podWatch = k8sClient.WatchNamespacedPodAsync(
    labelSelector: $"ctf/kind=challenge,ctf/contest-id={contestId}"
);

// Hoặc nếu chạy shared listener:
// Parse contestId từ namespace name khi nhận event
var (contestId, challengeId, teamId) = 
    ChallengeHelper.ParseDeploymentAppName(pod.Metadata.NamespaceName);
```

---

## 7. Redis Key Isolation

### 7.1. Mapping Redis Key Hiện Tại → Mới

| Key cũ (v5) | Key mới (multi-contest) |
|---|---|
| `deploy_challenge_{id}_{teamId}` | `c{cid}:deploy:{id}:{teamId}` |
| `active_deploys_team_{teamId}` | `c{cid}:deploys:team:{teamId}` |
| `auth:user:{id}` | `c{cid}:auth:user:{id}` |
| `kpm_check_{userId}_{minute}` | `c{cid}:kpm:{userId}:{minute}` |
| `submission_cooldown_{chId}_{teamId}` | `c{cid}:cooldown:{chId}:{teamId}` |
| `attempt_count_{chId}_{teamId}` | `c{cid}:attempts:{chId}:{teamId}` |

### 7.2. Redis Database Separation (Alternative)

Thay vì dùng prefix, dùng **Redis DB index khác nhau** per contest:

```
Contest 1 → Redis DB 1  (SELECT 1)
Contest 2 → Redis DB 2  (SELECT 2)
...
Contest N → Redis DB N
```

Lưu ý: Redis mặc định có 16 DB (0-15). Nếu nhiều hơn 16 contests thì cần dùng prefix.

**Khuyến nghị: Dùng key prefix** — linh hoạt hơn, không bị giới hạn số DB.

---

## 8. Kubernetes & Argo — Namespace Isolation

### 8.1. Namespace Naming Convention Mới

```
# Cũ (v5):
deploy-challenge-{challengeId}-team-{teamId}

# Mới (multi-contest):
c{contestId}-deploy-challenge-{challengeId}-team-{teamId}

# Ví dụ:
c1-deploy-challenge-42-team-5    ← contest 1, challenge 42, team 5
c2-deploy-challenge-42-team-5   ← contest 2, challenge 42 (cùng challenge ID, khác contest!)
```

### 8.2. K8s Labels Mới cho Challenge Pods

```yaml
# Argo Workflow template tạo pod với labels:
metadata:
  labels:
    ctf/kind: challenge
    ctf/contest-id: "1"          # NEW
    ctf/challenge-id: "42"
    ctf/team-id: "5"
```

### 8.3. DeploymentListener — Label Selector

```csharp
// Nếu shared listener (một listener cho tất cả contests):
labelSelector: "ctf/kind=challenge"

// Nếu per-contest listener:
labelSelector: "ctf/kind=challenge,ctf/contest-id=1"
```

### 8.4. RBAC — ServiceAccount Per Contest (Optional Security)

```yaml
# Tạo ServiceAccount riêng cho mỗi contest
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fctf-contest-1-sa
  namespace: fctf-system

# Role giới hạn deployment listener chỉ watch namespace của contest mình
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fctf-contest-1-watcher
rules:
- apiGroups: [""]
  resources: ["pods", "namespaces"]
  verbs: ["get", "list", "watch", "delete"]
  resourceNames: []  # Filter by label selector
```

---

## 9. ChallengeGateway — Routing Multi-Contest

### 9.1. Vấn Đề Hiện Tại

JWT payload hiện tại của `fctftoken`:
```json
{
  "route": "10.0.5.100:5000",
  "exp": 1777000000,
  "team_id": 5,
  "challenge_id": 42
}
```

Cần thêm `contest_id`:
```json
{
  "route": "10.0.5.100:5000",
  "exp": 1777000000,
  "team_id": 5,
  "challenge_id": 42,
  "contest_id": 1     // NEW
}
```

### 9.2. Rate Limiter Key — Phân Biệt Theo Contest

```go
// ChallengeGateway/internal/limiter — Rate limit key
// Cũ: {token_hash}:{ip}
// Mới: c{contestId}:{token_hash}:{ip}

func rateLimitKey(contestId int, tokenHash, ip string) string {
    return fmt.Sprintf("c%d:%s:%s", contestId, tokenHash, ip)
}
```

### 9.3. Gateway Routing Per Contest (Advanced)

Nếu muốn mỗi contest có domain/port riêng:

```
contest1.fctf.io → Gateway với JWT secret của contest 1
contest2.fctf.io → Gateway với JWT secret của contest 2
```

Hoặc shared gateway với SNI routing:
```
*.fctf.io → Shared gateway → detect contest từ subdomain → verify JWT đúng secret
```

---

## 10. ContestantPortal — UI Multi-Contest

### 10.1. Trang Mới Cần Thêm

| Route Mới | Trang | Mô tả |
|---|---|---|
| `/` | `ContestList.tsx` | Danh sách cuộc thi đang diễn ra / sắp diễn ra |
| `/contest/{slug}` | `ContestDetail.tsx` | Chi tiết cuộc thi, đăng ký tham gia |
| `/contest/{slug}/login` | `Login.tsx` | Đăng nhập vào cuộc thi |
| `/contest/{slug}/challenges` | `Challenges.tsx` | Danh sách challenge (đã có, chỉ cần adapt) |
| `/contest/{slug}/scoreboard` | `Scoreboard.tsx` | Scoreboard của cuộc thi |
| `/contest/{slug}/profile` | `Profile.tsx` | Hồ sơ trong ngữ cảnh cuộc thi |
| `/contest/{slug}/instances` | `Instances.tsx` | Pod đang chạy |

### 10.2. Context Mới

```typescript
// ContestantPortal/src/context/ContestContext.tsx (NEW)
interface ContestContextType {
  contestSlug: string;
  contestId: number;
  contestName: string;
  contestStatus: 'draft' | 'published' | 'running' | 'ended';
  startTime: Date;
  endTime: Date;
}

export const ContestContext = createContext<ContestContextType | null>(null);

// App.tsx — Wrap mọi route với ContestContext.Provider
// Lấy contestSlug từ URL params
```

### 10.3. API Service Layer — Cập Nhật Base URL

```typescript
// ContestantPortal/src/config/api.ts

// Cũ:
const API_BASE = import.meta.env.VITE_API_BASE_URL;

// Mới:
function getApiBase(contestSlug: string): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  return `${base}/api/c/${contestSlug}`;
}

// Sử dụng:
const api = axios.create({
  baseURL: getApiBase(contestSlug),
  // ...
});
```

### 10.4. Trang ContestList — Landing Page

```
[Danh sách Cuộc Thi]
├── FCTF 2026 Season 1  [ĐANG DIỄN RA]  →  /contest/fctf-2026-s1
├── CTF Nội Bộ Q1       [SẮP DIỄN RA]  →  /contest/internal-q1
└── Security Bootcamp   [ĐÃ KẾT THÚC]  →  /contest/bootcamp-2025
```

API call: `GET /api/master/contests` → `fctf_master` DB → danh sách contest public

---

## 11. FCTF-ManagementPlatform — Admin Multi-Contest

### 11.1. Hướng Tiếp Cận

FCTF-ManagementPlatform là fork CTFd — không có sẵn khái niệm multi-contest. Có hai lựa chọn:

#### Option A: Mỗi Contest Có Một Instance CTFd Riêng

```
ctfd-contest-1:8001  →  fctf_contest_1  (Admin cuộc thi 1 vào đây)
ctfd-contest-2:8002  →  fctf_contest_2  (Admin cuộc thi 2 vào đây)
ctfd-contest-3:8003  →  fctf_contest_3  (Admin cuộc thi 3 vào đây)
```

Docker Compose scale:
```yaml
ctfd-contest-1:
  build: ./FCTF-ManagementPlatform
  environment:
    - DATABASE_URL=mysql://...fctf_contest_1
  ports:
    - "8001:8000"

ctfd-contest-2:
  build: ./FCTF-ManagementPlatform
  environment:
    - DATABASE_URL=mysql://...fctf_contest_2
  ports:
    - "8002:8000"
```

**Pros:** Không cần thay đổi code CTFd.  
**Cons:** Mỗi instance chiếm ~200-400MB RAM.

#### Option B: Thêm Contest Selector vào CTFd (Complex)

Tùy chỉnh CTFd để chọn database khi login. Phức tạp, không khuyến nghị trừ khi team mạnh về Python/Flask.

#### Option C: Tạo Contest Manager Riêng (New Service)

Tạo service mới `ContestManager` (ASP.NET Core hoặc Python Flask nhỏ) làm nhiệm vụ:
- Super-admin đăng nhập → xem danh sách contests
- Click "Manage Contest X" → redirect đến CTFd instance của contest X
- Tạo contest mới → call API provision DB + CTFd instance

**Khuyến nghị: Option A (ngắn hạn) + Option C (dài hạn)**

### 11.2. Nginx Routing Cho Admin

```nginx
# /etc/nginx/conf.d/fctf-admin.conf
server {
    listen 443 ssl;
    server_name admin.fctf.io;
    
    location /contest/1/ {
        proxy_pass http://ctfd-contest-1:8000/;
    }
    
    location /contest/2/ {
        proxy_pass http://ctfd-contest-2:8000/;
    }
    
    location / {
        proxy_pass http://contest-manager:3000/;  # Landing page chọn contest
    }
}
```

---

## 12. Docker Compose & Infrastructure Scaling

### 12.1. Cấu Trúc Docker Compose Mới

```yaml
# docker-compose.yml

services:
  # === SHARED INFRASTRUCTURE ===
  db:
    image: mariadb:10.11
    # ... (giữ nguyên, nhưng init fctf_master + fctf_contest_1)
    volumes:
      - ./initdb:/docker-entrypoint-initdb.d  # SQL scripts tạo DB
  
  cache:
    image: redis:7
    # ... (giữ nguyên)
  
  rabbitmq:
    image: rabbitmq:3-management
    # ...
  
  # === SHARED SERVICES ===
  contestant-be:
    # Service dùng chung — đọc contestId từ URL path
    environment:
      - DB_CONNECTION_BASE=${DB_CONNECTION_BASE}  # host+user+pass, không có DB name
      - MASTER_DB_CONNECTION=${MASTER_DB_CONNECTION}
    
  deployment-center:
    environment:
      - DB_CONNECTION_BASE=${DB_CONNECTION_BASE}
      - MASTER_DB_CONNECTION=${MASTER_DB_CONNECTION}
  
  deployment-worker:
    # DeploymentListener — watch tất cả contest namespaces
  
  # === PER-CONTEST ADMIN ===
  ctfd-contest-1:
    build: ./FCTF-ManagementPlatform
    environment:
      - DATABASE_URL=mysql://ctfd:ctfd@db/fctf_contest_1
    ports:
      - "8001:8000"
  
  ctfd-contest-2:
    build: ./FCTF-ManagementPlatform
    environment:
      - DATABASE_URL=mysql://ctfd:ctfd@db/fctf_contest_2
    ports:
      - "8002:8000"
  
  # === CONTEST MANAGER (NEW) ===
  contest-manager:
    build: ./ContestManager  # Service mới
    ports:
      - "9000:9000"
    environment:
      - MASTER_DB_CONNECTION=${MASTER_DB_CONNECTION}
      - MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}  # Để tạo DB mới
```

### 12.2. Database Init Scripts

```bash
# ./initdb/01-create-databases.sql
CREATE DATABASE IF NOT EXISTS fctf_master;
CREATE DATABASE IF NOT EXISTS fctf_contest_1;
GRANT ALL PRIVILEGES ON fctf_master.* TO 'ctfd'@'%';
GRANT ALL PRIVILEGES ON fctf_contest_1.* TO 'ctfd'@'%';
FLUSH PRIVILEGES;
```

---

## 13. Migration Plan: Từ v5 Lên Multi-Contest

### 13.1. Zero-Downtime Migration Steps

```bash
# Bước 1: Backup toàn bộ
docker exec fctf-db mysqldump -u root -p ctfd > backup_v5_$(date +%Y%m%d).sql

# Bước 2: Tạo DB mới cho contest đầu tiên (từ DB đang chạy)
docker exec fctf-db mysql -u root -p -e "
  CREATE DATABASE fctf_master;
  CREATE DATABASE fctf_contest_1;
  -- Copy data sang fctf_contest_1
"

# Bước 3: Migrate data
docker exec fctf-db mysql -u root -p fctf_contest_1 < backup_v5_$(date +%Y%m%d).sql

# Bước 4: Seed fctf_master
docker exec fctf-db mysql -u root -p fctf_master << 'EOF'
CREATE TABLE contests (...);
INSERT INTO contests (id, slug, name, db_name, status)
VALUES (1, 'fctf-2026-s1', 'FCTF 2026 Season 1', 'fctf_contest_1', 'running');
EOF

# Bước 5: Cập nhật env vars
# DB_CONNECTION_BASE="Server=db;User=ctfd;Password=ctfd"
# MASTER_DB_CONNECTION="Server=db;Database=fctf_master;User=ctfd;Password=ctfd"

# Bước 6: Deploy services mới
docker compose up -d --build

# Bước 7: Migrate Redis keys (nếu cần)
# Script thêm prefix c1: vào tất cả key hiện tại
redis-cli --scan | while read key; do
  redis-cli rename "$key" "c1:$key"
done
```

### 13.2. Compatibility: ContestantPortal URL Forward

Để không phá vỡ URL cũ của contest đang chạy, thêm redirect:

```nginx
# Nginx redirect: /challenges → /contest/fctf-2026-s1/challenges
location ~* ^/(challenges|scoreboard|profile|instances|tickets)(.*)$ {
    return 301 /contest/fctf-2026-s1$1$2;
}
```

---

## 14. Kế Hoạch Thực Thi Theo Giai Đoạn

### Phase 1 — Foundation (2-3 tuần)

**Mục tiêu:** Codebase sẵn sàng cho multi-contest, không break gì ở v5

- [ ] **DB:** Tạo `fctf_master` schema + migration scripts
- [ ] **ResourceShared:** Thêm `IContestContext`, cập nhật `RedisHelper` key prefix
- [ ] **ResourceShared:** Cập nhật `ChallengeHelper` — namespace & key conventions
- [ ] **ResourceShared:** `ContestDbContextFactory` — dynamic connection switching
- [ ] **DeploymentQueuePayload:** Thêm `ContestId` field
- [ ] **Unit tests:** Verify Redis key isolation
- [ ] **Docker Compose:** Thêm cấu hình `fctf_master` DB, test với 1 contest

### Phase 2 — ContestantBE & Gateway (2-3 tuần)

**Mục tiêu:** API hỗ trợ path `/api/c/{contestSlug}/...`

- [ ] **ContestantBE:** Thêm contest extraction middleware
- [ ] **ContestantBE:** Cập nhật JWT auth — include `contest_id` claim
- [ ] **ContestantBE:** Tất cả controllers filter theo contest scope
- [ ] **ChallengeGateway:** Thêm `contest_id` vào `fctftoken` JWT payload
- [ ] **ChallengeGateway:** Cập nhật rate limiter key với contest prefix
- [ ] **Integration test:** Hai contests cùng chạy, verify không leak data

### Phase 3 — Frontend (2 tuần)

**Mục tiêu:** ContestantPortal hiển thị danh sách contest, navigate đúng

- [ ] **ContestantPortal:** Tạo trang `ContestList.tsx`
- [ ] **ContestantPortal:** Tạo `ContestContext`, wrap toàn bộ app
- [ ] **ContestantPortal:** Cập nhật routes → `/contest/{slug}/...`
- [ ] **ContestantPortal:** `api.ts` — dynamic API base URL theo contestSlug
- [ ] **ContestantPortal:** Backward compatible redirect (URL cũ → URL mới)

### Phase 4 — Admin & Operations (2 tuần)

**Mục tiêu:** Admin có thể tạo và quản lý nhiều contest

- [ ] **Docker Compose:** Scale CTFd instances per contest
- [ ] **Nginx/Ingress:** Routing admin panel per contest
- [ ] **ContestManager:** Service tạo contest mới (provision DB, credentials)
- [ ] **Operations scripts:** `create-contest.sh`, `archive-contest.sh`
- [ ] **Monitoring:** Grafana dashboard phân biệt metrics theo contest

### Phase 5 — Production Hardening (1-2 tuần)

- [ ] **Load test:** Hai contest chạy đồng thời với 100 team mỗi contest
- [ ] **K8s resource quotas:** Giới hạn tài nguyên pod per contest namespace
- [ ] **Backup strategy:** Backup riêng từng contest DB
- [ ] **Runbook:** Tài liệu vận hành — tạo/archive/restore contest
- [ ] **Security audit:** Verify không có data leakage giữa contests

---

## 15. Rủi Ro & Điểm Cần Lưu Ý

### 15.1. Rủi Ro Kỹ Thuật

| Rủi Ro | Mức Độ | Biện Pháp Xử Lý |
|---|---|---|
| **Data leak giữa contests** | 🔴 Cao | Unit test + integration test bắt buộc verify isolation. Code review kỹ tất cả query. |
| **Redis key collision** | 🔴 Cao | Enforce prefix trong `RedisHelper` — không allow gọi trực tiếp. Static analysis check. |
| **K8s namespace collision** | 🟡 Trung bình | namespace naming unique theo contest + challenge + team. Regex validate. |
| **Connection pool exhaustion** | 🟡 Trung bình | Monitor pool size. Set max pool per contest. Xem xét PgBouncer/ProxySQL. |
| **CTFd instance RAM** | 🟡 Trung bình | Mỗi CTFd ~300MB. 10 contests = 3GB. Monitor và set limit. |
| **Backward compatibility break** | 🟡 Trung bình | Thêm redirect, không xóa route cũ ngay. Deploy dần. |
| **JWT secret per contest** | 🟢 Thấp | Có thể dùng shared secret hoặc per-contest. Document rõ ràng. |

### 15.2. Các Quyết Định Kiến Trúc Cần Confirm

> **Cần quyết định trước khi code:**
>
> 1. **Shared or per-instance ContestantBE?**  
>    - Shared (dynamic DB switching) → Ít tài nguyên, code phức tạp hơn
>    - Per-instance → Đơn giản, nhưng tốn RAM nhiều hơn
>
> 2. **URL routing strategy?**  
>    - Path-based: `/api/c/{contestSlug}/...` → Rõ ràng, SEO-friendly
>    - Header-based: `X-Contest-Id` → Đơn giản API nhưng khó debug  
>    - Subdomain: `contest1.api.fctf.io` → Cần wildcard TLS cert
>
> 3. **User account model?**  
>    - Một account cho tất cả contests (SSO via fctf_master)
>    - Account riêng cho từng contest (đăng ký lại mỗi lần)
>    - Hybrid: Account global + join contest thủ công
>
> 4. **Challenge sharing between contests?**  
>    - Challenges belong to contest (không share)
>    - Challenges belong to "challenge bank" (share image, clone per contest)

### 15.3. Điểm Kỹ Thuật Khó Nhất

1. **Dynamic DB Context Switching** — EF Core không natively hỗ trợ đổi connection mid-request. Cần implement đúng pattern Factory/Scope.

2. **DeploymentListener Shared Watch** — Listener hiện tại watch tất cả pod. Khi multi-contest, cần parse `contestId` từ namespace và route event đến đúng Redis scope. Race condition phức tạp hơn.

3. **FCTF-ManagementPlatform (CTFd)** — Đây là phần Python khó tùy chỉnh nhất. Nếu team không quen Python/Flask, nên giữ nguyên approach "one CTFd instance per contest" thay vì sửa code.

4. **Migration không downtime** — DB hiện tại đang chạy production. Phải test migration script kỹ trên staging trước.

---

## 📎 Phụ Lục: File Cần Tạo Mới

| File | Service | Mục Đích |
|---|---|---|
| `ResourceShared/Interfaces/IContestContext.cs` | ResourceShared | Interface context contest |
| `ResourceShared/Services/ContestContextMiddleware.cs` | ResourceShared | Extract contestId từ request |
| `ResourceShared/Services/ContestDbContextFactory.cs` | ResourceShared | Dynamic DB connection |
| `ResourceShared/Services/MasterDbContext.cs` | ResourceShared | DbContext cho fctf_master |
| `database-migration/create-contest-db.sql` | Infra | Template SQL tạo DB mới |
| `database-migration/migrate-v5-to-multicontest.sh` | Infra | Migration script |
| `ContestManager/` | New Service | Web app quản lý contests |
| `ContestantPortal/src/pages/ContestList.tsx` | Frontend | Trang danh sách contest |
| `ContestantPortal/src/context/ContestContext.tsx` | Frontend | Contest React context |
| `FCTF-k3s-manifest/prod/contest-manager/` | K8s | K8s manifests cho ContestManager |

---

## 📎 Phụ Lục: File Cần Sửa Đổi (Top Priority)

| File | Thay Đổi Chính |
|---|---|
| `ResourceShared/Utils/RedisHelper.cs` | Thêm `contestId` prefix vào tất cả key methods |
| `ResourceShared/Utils/ChallengeHelper.cs` | Cập nhật namespace pattern, ParseDeploymentAppName |
| `ResourceShared/DTOs/Deployments/DeploymentQueuePayload.cs` | Thêm `ContestId` field |
| `ResourceShared/Models/AppDbContext.cs` | Hỗ trợ dynamic connection |
| `ControlCenterAndChallengeHostingServer/ContestantBE/Program.cs` | Đăng ký contest middleware |
| `ControlCenterAndChallengeHostingServer/ContestantBE/Services/AuthService.cs` | JWT include contestId |
| `ControlCenterAndChallengeHostingServer/DeploymentCenter/Services/DeployService.cs` | Pass contestId qua mọi operation |
| `ControlCenterAndChallengeHostingServer/DeploymentListener/ChallengesInformerService.cs` | Parse contestId từ namespace |
| `ChallengeGateway/internal/gateway/util.go` | Thêm contestId vào JWT payload |
| `ChallengeGateway/internal/limiter/` | Contest-aware rate limit keys |
| `ContestantPortal/src/App.tsx` | Thêm contest routing |
| `docker-compose.yml` | Multi-contest service config |

---

*Tài liệu này được tạo bởi Antigravity AI dựa trên phân tích source code FCTF-temp-v5 (15/04/2026).*  
*Cần cập nhật khi có quyết định kiến trúc cụ thể hoặc khi bắt đầu implementation.*
