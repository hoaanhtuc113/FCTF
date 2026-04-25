# Approach B — Chi Tiết Shared vs. Riêng Từng Thành Phần

> **Ngày tạo:** 15/04/2026  
> **Liên quan:** [MULTI_CONTEST_ROADMAP.md](./MULTI_CONTEST_ROADMAP.md)  
> **Mục tiêu:** Làm rõ trong Approach B (Contest-Per-Schema), mỗi thành phần hạ tầng và service được dùng **chung** hay **riêng** như thế nào.

---

## 1. 🗄️ Database (MariaDB)

**Dùng chung: MariaDB Server**  
**Riêng: Database/Schema per contest**

```
MariaDB Server (1 instance duy nhất)
  ├── fctf_master          ← Global: quản lý danh sách contests, super-admin
  ├── fctf_contest_1       ← Contest 1: toàn bộ data riêng biệt
  ├── fctf_contest_2       ← Contest 2
  └── fctf_contest_3       ← Contest 3
```

> MariaDB **server** dùng chung, nhưng mỗi contest hoàn toàn không thể truy cập data của nhau vì ở khác **database**. Schema bên trong mỗi `fctf_contest_{id}` giữ nguyên 100% so với v5 hiện tại — không cần thêm cột `contest_id`.

---

## 2. ⚡ Redis (Cache)

**Dùng chung: Redis instance**  
**Riêng: Key prefix per contest**

```
Redis (1 instance)
  ├── c1:deploy_challenge_42_5    ← Contest 1, challenge 42, team 5
  ├── c2:deploy_challenge_42_5    ← Contest 2, cùng challengeId/teamId NHƯNG isolated
  ├── c1:auth:user:100
  └── c2:auth:user:100            ← Cùng userId nhưng token riêng
```

### Mapping Key Cũ → Mới

| Key cũ (v5) | Key mới (multi-contest) |
|---|---|
| `deploy_challenge_{id}_{teamId}` | `c{cid}:deploy:{id}:{teamId}` |
| `active_deploys_team_{teamId}` | `c{cid}:deploys:team:{teamId}` |
| `auth:user:{id}` | `c{cid}:auth:user:{id}` |
| `kpm_check_{userId}_{minute}` | `c{cid}:kpm:{userId}:{minute}` |
| `submission_cooldown_{chId}_{teamId}` | `c{cid}:cooldown:{chId}:{teamId}` |
| `attempt_count_{chId}_{teamId}` | `c{cid}:attempts:{chId}:{teamId}` |

> Tất cả dữ liệu ở chung bộ nhớ Redis, nhưng không bao giờ conflict vì prefix `c{contestId}:`. Thay đổi duy nhất cần làm: cập nhật `RedisHelper.cs` để tất cả phương thức nhận thêm tham số `contestId`.

---

## 3. ☸️ Kubernetes (K8s / K3s)

**Dùng chung: Cluster K8s (tất cả nodes)**  
**Riêng: Namespace per challenge deployment**

```
K8s Cluster (chung)
  ├── Namespace: fctf-system                 ← System services (dùng chung)
  ├── Namespace: c1-deploy-ch42-team5         ← Contest 1 → Challenge pod
  ├── Namespace: c2-deploy-ch42-team5         ← Contest 2 → Challenge pod (isolated)
  └── Namespace: c1-deploy-ch10-team8         ← Contest 1 → Challenge pod khác
```

### Namespace Naming Convention

```
# Cũ (v5):
deploy-challenge-{challengeId}-team-{teamId}

# Mới (multi-contest):
c{contestId}-deploy-challenge-{challengeId}-team-{teamId}

# Ví dụ:
c1-deploy-challenge-42-team-5    ← contest 1, challenge 42, team 5
c2-deploy-challenge-42-team-5    ← contest 2 — cùng IDs nhưng KHÔNG đụng nhau!
```

### K8s Labels Mới Cho Challenge Pods

```yaml
metadata:
  labels:
    ctf/kind: challenge
    ctf/contest-id: "1"       # NEW — thêm so với v5
    ctf/challenge-id: "42"
    ctf/team-id: "5"
```

> Pods của các contest **không thể communicate** với nhau nhờ K8s Network Policy áp dụng ở cấp namespace.

---

## 4. 🐰 RabbitMQ (Message Queue)

**Dùng chung: RabbitMQ server**  
**Riêng: Routing key / message payload chứa contestId**

```
Exchange: deployment_exchange  (chung)

Message payload (thêm contestId):
{
  "contestId": 1,        ← NEW — thêm trường này
  "challengeId": 42,
  "teamId": 5,
  "createdAt": "...",
  "expiry": "..."
}
```

> Consumer xử lý message sẽ đọc `contestId` để biết dùng DB nào, namespace nào. Không cần tạo queue riêng — chỉ cần enriched payload.

---

## 5. 🔧 Argo Workflows

**Dùng chung: Argo Workflows server**  
**Riêng: Namespace và labels của từng workflow**

```
Argo Workflows (chung)
  ├── Workflow: c1-deploy-ch42-team5-xxxxx    ← Contest 1
  └── Workflow: c2-deploy-ch42-team5-yyyyy    ← Contest 2
```

> WorkflowTemplate có thể **dùng chung**, chỉ truyền tham số namespace khác nhau qua `DeploymentConsumer`. Không cần tạo WorkflowTemplate riêng per contest.

---

## 6. ⚙️ ContestantBE (ASP.NET Core)

Đây là **điểm quyết định kiến trúc quan trọng nhất** — có hai sub-option:

### Sub-option B1: Shared ContestantBE ✅ Khuyến nghị bước đầu

```
                    ┌─────────────────────────┐
                    │    ContestantBE         │  ← 1 instance duy nhất
                    │    (Port 5010)          │
                    └──────────┬──────────────┘
                               │
          URL: /api/c/{contestSlug}/...
          Middleware extract slug
          Lookup connection string từ fctf_master
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌───────▼──────┐ ┌──────▼──────────┐
    │ fctf_contest_1 │ │fctf_contest_2│ │ fctf_contest_3  │
    └────────────────┘ └──────────────┘ └─────────────────┘
```

**Cơ chế hoạt động:**
```
Request: GET /api/c/fctf-2026/challenges
  ↓
ContestContextMiddleware:
  1. Extract slug = "fctf-2026" từ URL
  2. Query fctf_master: SELECT db_name WHERE slug = "fctf-2026"
  3. Build connection string → fctf_contest_1
  4. Inject IContestContext vào DI scope của request này
  ↓
ChallengeController nhận request
  ↓
AppDbContext được inject với connection → fctf_contest_1
Tất cả query trong scope này chỉ đọc/ghi fctf_contest_1
```

| ✅ Pros | ❌ Cons |
|---|---|
| 1 container duy nhất → ít RAM | Code phức tạp hơn (dynamic DbContext) |
| Dễ deploy ban đầu | Shared thread pool — 1 contest tải cao có thể ảnh hưởng nhau |
| Không cần scale infra ngay | Phải implement EF Core Factory pattern cẩn thận |

### Sub-option B2: Per-Contest ContestantBE

```
contestant-be-1 (Port 5011) → fctf_contest_1
contestant-be-2 (Port 5012) → fctf_contest_2
contestant-be-3 (Port 5013) → fctf_contest_3

Nginx / K8s Ingress routing:
  /api/c/fctf-2026/*   →  contestant-be-1
  /api/c/internal-q1/* →  contestant-be-2
  /api/c/bootcamp/*    →  contestant-be-3
```

| ✅ Pros | ❌ Cons |
|---|---|
| Isolation hoàn toàn — crash 1 không ảnh hưởng 2 | N contests = N instances → N × RAM (~200MB/instance) |
| Code không cần thay đổi nhiều (env var per instance) | Phức tạp về deployment và ops |
| Scale riêng từng contest | Cần quản lý nhiều container hơn |

> **Lộ trình thực tế:** Bắt đầu với B1 (shared), khi có bottleneck hoặc nhiều hơn 5 contest cùng lúc → migrate dần sang B2.

---

## 7. 📦 DeploymentCenter (ASP.NET Core)

**Dùng chung: 1 instance**  
**Cách isolation: contestId trong API call và RabbitMQ message**

```
ContestantBE → POST /api/challenge/start
{
  "contestId": 1,      ← NEW
  "challengeId": 42,
  "teamId": 5
}
  ↓
DeploymentCenter kiểm tra Redis: c1:deploy_challenge_42_5
Đẩy message vào RabbitMQ với contestId
```

---

## 8. 🔁 DeploymentConsumer (Background Worker)

**Dùng chung: 1 instance**  
**Cách isolation: Đọc contestId từ message, dùng đúng DB + namespace**

```
Poll RabbitMQ → message chứa contestId=1
  ↓
Load challenge từ fctf_contest_1 (dùng contestId để chọn DB)
  ↓
Build Argo payload với namespace: c1-deploy-challenge-42-team-5
  ↓
Cập nhật Redis: c1:deploy_challenge_42_5
```

---

## 9. 👁️ DeploymentListener (K8s Watcher)

**Dùng chung: 1 instance**  
**Cách isolation: Parse contestId từ namespace name khi nhận K8s event**

```
K8s Pod event: ADDED namespace "c1-deploy-challenge-42-team-5"
  ↓
ParseDeploymentAppName("c1-deploy-challenge-42-team-5")
  → contestId=1, challengeId=42, teamId=5
  ↓
Cập nhật Redis: c1:deploy_challenge_42_5  ← đúng key prefix
Cập nhật DB: fctf_contest_1              ← đúng database
```

---

## 10. 🚪 ChallengeGateway (Go)

**Dùng chung: 1 instance (hoặc per-domain nếu muốn)**  
**Cách isolation: contestId trong JWT payload, rate limit key có prefix**

### JWT Token Mới

```json
{
  "route": "10.0.5.100:5000",
  "exp": 1777000000,
  "team_id": 5,
  "challenge_id": 42,
  "contest_id": 1        ← NEW
}
```

### Rate Limit Key

```go
// Cũ: "{token_hash}:{ip}"
// Mới: "c{contestId}:{token_hash}:{ip}"

func rateLimitKey(contestId int, tokenHash, ip string) string {
    return fmt.Sprintf("c%d:%s:%s", contestId, tokenHash, ip)
}
```

### Advanced: Per-Contest Domain (Optional)

```
contest1.fctf.io → Gateway với JWT secret của contest 1
contest2.fctf.io → Gateway với JWT secret của contest 2

(Mỗi contest có JWT signing secret riêng — bảo mật hơn nhưng phức tạp hơn)
```

---

## 11. 🎛️ FCTF-ManagementPlatform (CTFd / Python Flask)

**Riêng hoàn toàn: Mỗi contest một CTFd instance**

```
ctfd-contest-1 (Port 8001) → fctf_contest_1   (Admin cuộc thi 1)
ctfd-contest-2 (Port 8002) → fctf_contest_2   (Admin cuộc thi 2)
ctfd-contest-3 (Port 8003) → fctf_contest_3   (Admin cuộc thi 3)

Nginx routing:
  admin.fctf.io/contest/1/ → ctfd-contest-1
  admin.fctf.io/contest/2/ → ctfd-contest-2
```

> CTFd không có khái niệm multi-contest và code Python rất khó sửa để support. Giữ mỗi instance riêng là giải pháp an toàn và thực tế nhất.  
> **Chi phí:** Mỗi CTFd instance ~300MB RAM. 5 contests = 1.5GB chỉ riêng admin portal.

---

## 12. 🖥️ ContestantPortal (React Frontend)

**Dùng chung: 1 frontend app (SPA)**  
**Cách isolation: URL slug + ContestContext + dynamic API base URL**

```
Người dùng vào: fctf.io/contest/fctf-2026/challenges
  ↓
React Router extract slug = "fctf-2026"
  ↓
ContestContext load thông tin contest từ API
  ↓
Toàn bộ API call trong trang này đều prefix:
  GET /api/c/fctf-2026/challenge/list_challenge/Web
  POST /api/c/fctf-2026/challenge/attempt
```

**Trang mới cần thêm:**

| Route | Trang | Mô tả |
|---|---|---|
| `/` | `ContestList.tsx` | Danh sách tất cả cuộc thi |
| `/contest/{slug}` | `ContestDetail.tsx` | Chi tiết + đăng ký |
| `/contest/{slug}/login` | `Login.tsx` | Đăng nhập cho contest cụ thể |
| `/contest/{slug}/challenges` | `Challenges.tsx` | Có sẵn, adapt lại |
| `/contest/{slug}/scoreboard` | `Scoreboard.tsx` | Có sẵn, adapt lại |

---

## 13. 📊 Bảng Tổng Hợp Cuối Cùng

| Thành Phần | Dùng Chung? | Cơ chế Isolation |
|---|---|---|
| **MariaDB Server** | ✅ Chung | Riêng **database** per contest |
| **Redis** | ✅ Chung | Key prefix **`c{contestId}:`** |
| **K8s Cluster** | ✅ Chung | Riêng **Namespace** per pod |
| **RabbitMQ** | ✅ Chung | `contestId` trong **message payload** |
| **Argo Workflows** | ✅ Chung | Riêng **namespace + labels** |
| **ContestantBE** | ⚙️ Tùy chọn | B1: Shared + dynamic routing / B2: Per-instance |
| **DeploymentCenter** | ✅ Chung | Pass `contestId` qua API |
| **DeploymentConsumer** | ✅ Chung | Đọc `contestId` từ message |
| **DeploymentListener** | ✅ Chung | Parse `contestId` từ namespace name |
| **ChallengeGateway** | ✅ Chung | `contestId` trong JWT + rate limit key |
| **CTFd (Admin)** | ❌ **Riêng hoàn toàn** | 1 instance per contest |
| **ContestantPortal** | ✅ Chung | URL slug + ContestContext |

---

## 14. 🧮 Ước Tính Tài Nguyên (5 Contests Đồng Thời)

| Thành Phần | Sub-option B1 | Sub-option B2 |
|---|---|---|
| ContestantBE | ~200MB (1 instance) | ~1GB (5 instances) |
| DeploymentCenter | ~100MB (1 instance) | ~100MB (shared) |
| DeploymentConsumer | ~100MB (1 instance) | ~100MB (shared) |
| DeploymentListener | ~100MB (1 instance) | ~100MB (shared) |
| CTFd Admin (5 instances) | ~1.5GB | ~1.5GB |
| MariaDB | ~500MB | ~500MB |
| Redis | ~100MB | ~100MB |
| RabbitMQ | ~150MB | ~150MB |
| **Tổng** | **~2.75GB** | **~3.55GB** |

---

## 15. 💡 Lộ Trình Thực Hành

```
Giai đoạn 1 — MVP (≤ 3 contests):
  ┌─ ContestantBE: Shared (B1) — implement dynamic DB routing
  ├─ Redis: Key prefix c{contestId}:
  ├─ K8s: Namespace với contest prefix
  └─ CTFd: Per-instance (cách thủ công nhất, thêm vào docker-compose)

Giai đoạn 2 — Scale (3-10 contests):
  ┌─ ContestantBE: Cân nhắc chuyển sang B2 nếu bị bottleneck
  ├─ ContestManager: Service mới để tạo contest tự động (provision DB + CTFd)
  └─ Monitoring: Grafana dashboard phân tách metrics theo contestId

Giai đoạn 3 — Enterprise (10+ contests):
  ├─ ContestantBE: Per-instance (B2) với K8s auto-scaling
  ├─ MariaDB: Cân nhắc ProxySQL hoặc tách server
  └─ Redis Cluster: Phân tách theo hash slot contest
```

---

*Tài liệu được tạo bởi Antigravity AI — 15/04/2026*  
*Xem thêm: [MULTI_CONTEST_ROADMAP.md](./MULTI_CONTEST_ROADMAP.md)*
