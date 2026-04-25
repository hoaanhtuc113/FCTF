# C# & ASP.NET Core trong Hệ Thống FCTF

> **Tài liệu:** Giới thiệu công nghệ C# / ASP.NET Core  
> **Dự án:** FCTF-temp-v5 (CTF Platform)  
> **Ngày soạn:** 10/04/2026  
> **Mục tiêu:** Giúp các thành viên nhóm hiểu C# là gì, tại sao dùng, và hoạt động như thế nào trong hệ thống

---

## 📌 Mục Lục

1. [C# là gì?](#1-c-là-gì)
2. [ASP.NET Core là gì?](#2-aspnet-core-là-gì)
3. [C# được dùng ở đâu trong FCTF?](#3-c-được-dùng-ở-đâu-trong-fctf)
4. [Giải thích từng service C#](#4-giải-thích-từng-service-c)
5. [Các khái niệm C# quan trọng trong dự án](#5-các-khái-niệm-c-quan-trọng-trong-dự-án)
6. [Luồng hoạt động thực tế — Minh họa bằng code](#6-luồng-hoạt-động-thực-tế--minh-họa-bằng-code)
7. [Bảo mật & Hiệu năng với C#](#7-bảo-mật--hiệu-năng-với-c)
8. [Tóm tắt vai trò C# trong hệ thống](#8-tóm-tắt-vai-trò-c-trong-hệ-thống)

---

## 1. C# Là Gì?

**C#** (đọc là "C Sharp") là ngôn ngữ lập trình **hướng đối tượng, kiểu tĩnh (statically typed)**, được Microsoft phát triển năm 2000. Đây là ngôn ngữ chính của hệ sinh thái **.NET**, được thiết kế để xây dựng ứng dụng **web, desktop, cloud, game** và nhiều hơn nữa.

### Tại sao C# được chọn cho FCTF?

| Lý do | Giải thích |
|---|---|
| **Hiệu năng cao** | C# chạy trên .NET runtime được JIT-compiled, gần bằng C++ về tốc độ |
| **Type-safe** | Lỗi được phát hiện ngay lúc compile, không phải runtime |
| **Async/Await native** | Xử lý hàng nghìn request đồng thời mà không block thread |
| **Hệ sinh thái phong phú** | NuGet packages cho Redis, RabbitMQ, Kubernetes, JWT,... |
| **ASP.NET Core** | Framework web production-grade, được dùng bởi Microsoft, Stack Overflow, v.v. |
| **Tương thích Kubernetes** | C# SDK chính thức cho Kubernetes (KubernetesClient) |

### C# trong FCTF vs các ngôn ngữ khác

```
ContestantPortal    → TypeScript (Frontend UI)
ContestantBE        → C# / ASP.NET Core ← Nghiệp vụ thí sinh
DeploymentCenter    → C# / ASP.NET Core ← Điều phối deploy
DeploymentConsumer  → C# / BackgroundService ← Worker xử lý queue
DeploymentListener  → C# / ASP.NET Core ← Watch Kubernetes
ChallengeGateway    → Go (Gateway hiệu năng cực cao)
ManagementPlatform  → Python Flask (Admin portal)
```

> C# đảm nhận **phần lõi nghiệp vụ** — nơi cần xử lý logic phức tạp, transaction an toàn và API mạnh mẽ.

---

## 2. ASP.NET Core Là Gì?

**ASP.NET Core** là framework web **cross-platform, open-source** của Microsoft, chạy trên **.NET 8** (phiên bản LTS mới nhất). Đây là phiên bản hiện đại, được thiết kế lại hoàn toàn từ ASP.NET cũ.

### Kiến trúc ASP.NET Core

```
┌─────────────────────────────────────────────────────┐
│                   HTTP Request                      │
└──────────────────────┬──────────────────────────────┘
                       │
           ┌───────────▼──────────────┐
           │    Middleware Pipeline   │
           │  CORS → Rate Limit →     │
           │  Auth → Route → Handler  │
           └───────────┬──────────────┘
                       │
           ┌───────────▼──────────────┐
           │       Controller         │
           │   (nhận request, gọi     │
           │   Service, trả response) │
           └───────────┬──────────────┘
                       │
           ┌───────────▼──────────────┐
           │       Service Layer      │
           │  (business logic chính)  │
           └───────────┬──────────────┘
                       │
           ┌───────────▼──────────────┐
           │  Data Layer (EF Core)    │
           │  MariaDB / Redis         │
           └──────────────────────────┘
```

### Các thành phần chính ASP.NET Core

| Thành phần | Chức năng |
|---|---|
| **Controller** | Nhận HTTP request, validate, gọi service, trả response |
| **Service** | Chứa business logic (không biết về HTTP) |
| **Middleware** | Xử lý request/response ở tầng trung (logging, auth, rate limit) |
| **Dependency Injection (DI)** | Tiêm phụ thuộc tự động — không cần `new` thủ công |
| **Entity Framework Core** | ORM: ánh xạ C# class → database table |
| **Background Service** | Chạy task nền bất đồng bộ (worker, queue consumer) |

---

## 3. C# Được Dùng Ở Đâu Trong FCTF?

Toàn bộ phần backend của hệ thống FCTF đều viết bằng C#, được tổ chức thành **1 Visual Studio Solution** với 5 project:

```
ControlCenterAndChallengeHostingServer/
│
├── ContestantBE/          ← API backend cho thí sinh (Port 5010)
├── DeploymentCenter/      ← Điều phối deploy (Port 5020)
├── DeploymentConsumer/    ← Worker xử lý RabbitMQ queue
├── DeploymentListener/    ← Watch sự kiện Kubernetes (Port 5030)
└── ResourceShared/        ← Thư viện dùng chung (không có HTTP port)
```

### Sơ đồ tổng quan các service C#

```
[Thí sinh]
    │
    ▼
ContestantBE (C#) ──────────────────────→ MariaDB
    │                                     Redis
    │ HTTP POST (start/stop challenge)
    ▼
DeploymentCenter (C#) ──────────────────→ RabbitMQ (publish)
    │                                     Redis
    │ (async)
    ▼
DeploymentConsumer (C# Worker) ─────────→ Argo Workflows API
    │
    │ [Argo deploy Pod lên Kubernetes]
    │
    ▼
DeploymentListener (C#) ←────────────── Kubernetes (watch events)
    │                                     Redis (update status)
    │                                     MariaDB (update DB)
    ▼
[Thí sinh nhận URL challenge]
```

---

## 4. Giải Thích Từng Service C#

### 4.1. `ContestantBE` — "Não" của Thí Sinh

**Vai trò:** Là API duy nhất mà frontend (React) giao tiếp. Xử lý mọi nghiệp vụ liên quan đến thí sinh.

**Công nghệ:**
- ASP.NET Core 8 Web API
- JWT Bearer Authentication
- Redis (rate limiting, cache, distributed lock)
- Entity Framework Core + MariaDB

**Các Controller chính:**

| Controller | Endpoint chính | Chức năng |
|---|---|---|
| `AuthController` | `POST /api/auth/login` | Đăng nhập, cấp JWT token |
| `ChallengeController` | `GET /api/challenge/{id}` | Xem challenge, start/stop, submit flag |
| `HintController` | `POST /api/hint/{id}` | Mua và xem gợi ý |
| `ScoreboardController` | `GET /api/scoreboard` | Bảng xếp hạng |
| `TicketController` | `POST /api/ticket` | Tạo ticket hỗ trợ |

**Cách tổ chức code:**

```
ContestantBE/
├── Program.cs              ← Khởi động app, đăng ký DI
├── Controllers/            ← Nhận HTTP request
├── Services/               ← Business logic
├── Interfaces/             ← Abstraction layer (DI)
├── RateLimiting/           ← Cấu hình giới hạn request
├── Filters/                ← Action filter (validation)
└── Attribute/              ← Custom attribute ([RequireCaptain])
```

**Middleware pipeline:**
```
Request đến
    → [CORS] — cho phép cross-origin từ frontend
    → [Rate Limit Redis] — giới hạn IP
    → [TokenAuthenticationMiddleware] — decode JWT
    → [Controller] — xử lý nghiệp vụ
    → Response trả về
```

---

### 4.2. `DeploymentCenter` — "Tổng Đài" Deploy

**Vai trò:** Nhận lệnh start/stop challenge từ ContestantBE, kiểm tra trạng thái Redis, đẩy message vào RabbitMQ, nhận callback từ Argo Workflows.

**Công nghệ:**
- ASP.NET Core 8 Web API, Port 5020
- RabbitMQ (Producer)
- Redis (lưu deployment state)
- Kubernetes C# SDK (để xóa namespace khi stop)

**Endpoints:**

| Method | Endpoint | Chức năng |
|---|---|---|
| `POST` | `/api/challenge/start` | Khởi động challenge pod |
| `POST` | `/api/challenge/stop` | Dừng challenge pod |
| `POST` | `/api/challenge/stop-all` | Admin: dừng tất cả |
| `POST` | `/api/challenge/upload` | Submit workflow build Docker image |
| `POST` | `/api/challenge/argo-callback` | Nhận callback từ Argo Workflows |

**Bảo mật service-to-service:** Không dùng JWT (vì đây là internal API). Thay vào đó dùng **SecretKey HMAC** — ContestantBE tạo key từ timestamp + data hash, DeploymentCenter verify trước khi xử lý.

---

### 4.3. `DeploymentConsumer` — "Thợ Làm" Thực Sự

**Vai trò:** Background worker liên tục poll RabbitMQ và gọi Argo Workflows API để thực sự deploy challenge pod lên Kubernetes.

**Tại sao tách riêng?**
- Không block API của DeploymentCenter
- Có thể scale độc lập (nhiều consumer chạy song song)
- **Throttle thông minh**: chỉ submit workflow mới khi số workflow đang chạy < giới hạn

**Công nghệ:**
- ASP.NET Core 8 **Worker Service** (BackgroundService)
- RabbitMQ Consumer
- Argo Workflows REST API
- Redis

**Cấu hình quan trọng (environment variables):**

| Biến | Ý nghĩa | Ví dụ |
|---|---|---|
| `MAX_RUNNING_WORKFLOW` | Max workflow Argo chạy song song | `10` |
| `BATCH_SIZE` | Số message xử lý mỗi lần | `5` |
| `WORKER_POLL_INTERVAL_SECONDS` | Tần suất poll (giây) | `3` |
| `ARGO_WORKFLOWS_URL` | Địa chỉ Argo API | `http://argo:2746` |

**Vòng lặp chính:**
```
[Mỗi N giây]
    → Kiểm tra: running workflows < MAX?
    → Tính available slots
    → Dequeue batch từ RabbitMQ
    → Với mỗi message:
        - Load challenge từ DB
        - Build Argo Workflow spec (JSON)
        - POST tới Argo /submit
        - Ack message
        - Cập nhật Redis: status=PENDING
    → Nếu lỗi: Nack (trả về queue)
```

---

### 4.4. `DeploymentListener` — "Tai Nghe" Kubernetes

**Vai trò:** Watch tất cả Pod trên Kubernetes có label `ctf/kind=challenge`, cập nhật trạng thái vào Redis và MariaDB khi pod thay đổi trạng thái.

**Công nghệ:**
- ASP.NET Core 8, Port 5030
- **Kubernetes C# SDK** (`KubernetesClient` — `WatchAsync<V1Pod>`)
- Redis
- System.Threading.Channels (sharded processing)

**Cơ chế Sharding (tránh bottleneck):**
```
Pod events từ Kubernetes
    ↓
hash(pod.UID) % N → chọn shard worker
    ↓
Shard worker xử lý tuần tự
(event của cùng 1 pod → cùng 1 worker → đúng thứ tự)
```

**Xử lý từng loại event:**

| Event K8s | Hành động |
|---|---|
| `ADDED / MODIFIED` (Pod ready) | Lấy URL pod → cập nhật Redis: `RUNNING` |
| `ADDED / MODIFIED` (Pod stuck) | Xóa namespace → Redis: `FAILED` |
| `ADDED / MODIFIED` (Pod restart) | Reset `ready=false` trong Redis |
| `DELETED` | Xóa Redis ZSet, cập nhật DB: `StoppedAt = UtcNow` |
| Ghost pod (không có Redis cache) | Xóa namespace K8s ngay |

**Self-healing khi restart:**
```
DeploymentListener restart →
    1. List tất cả pod hiện tại (ctf/kind=challenge)
    2. Tìm ChallengeStartTracking có StoppedAt=null
       nhưng namespace không còn tồn tại trong K8s
    3. Fix StoppedAt = UtcNow (missed event trong downtime)
    4. Tiếp tục watch stream
```

---

### 4.5. `ResourceShared` — "Xương Sống" Dùng Chung

**Vai trò:** Thư viện C# được tham chiếu bởi tất cả 4 project còn lại. Chứa toàn bộ code dùng chung.

**Nội dung chính:**

| Thư mục | Nội dung |
|---|---|
| `Models/` | EF Core entity models (32+ bảng: Challenge, User, Team, Submission,...) |
| `DTOs/` | Data Transfer Objects (request/response models) |
| `Services/K8sService.cs` | Kubernetes client wrapper (delete namespace, get pods, get URL) |
| `Middlewares/` | `TokenAuthenticationMiddleware` — decode JWT → inject UserContext |
| `Utils/ChallengeHelper.cs` | `BuildArgoPayload()`, `Attempt()` (so sánh flag), `GenerateChallengeToken()` |
| `Utils/RedisHelper.cs` | CRUD Redis, atomic operations, ZSet management |
| `Utils/SHA256Helper.cs` | Hash password tương thích Python CTFd |
| `Utils/ItsDangerousCompatHelper.cs` | Tạo signed URL tương thích Python `itsdangerous` |
| `Enums.cs` | Toàn bộ enum: `DeploymentStatus`, `ChallengeState`, `SubmissionTypes`,... |

---

## 5. Các Khái Niệm C# Quan Trọng Trong Dự Án

### 5.1. Dependency Injection (DI)

Thay vì tạo đối tượng thủ công bằng `new`, ASP.NET Core tự động inject phụ thuộc:

```csharp
// Program.cs — Đăng ký service
builder.Services.AddScoped<IChallengeService, ChallengeService>();
builder.Services.AddScoped<IDeployService, DeployService>();
builder.Services.AddSingleton<RedisHelper>();

// Controller — Nhận qua constructor (DI tự inject)
public class ChallengeController : ControllerBase
{
    private readonly IChallengeService _challengeService;
    
    public ChallengeController(IChallengeService challengeService)
    {
        _challengeService = challengeService; // DI tự tiêm vào đây
    }
}
```

**Lợi ích:** Dễ test (mock interface), không coupling, quản lý lifetime tự động.

---

### 5.2. Async/Await — Xử Lý Bất Đồng Bộ

C# hỗ trợ `async/await` native. Mọi I/O operation (DB, Redis, HTTP call) đều async:

```csharp
// Ví dụ từ DeploymentCenter ChallengeController
[HttpPost("start")]
[RequireSecretKey]
public async Task<IActionResult> StartChallenge(
    [FromBody] ChallengeStartStopReqDTO challengeStartReq)
{
    // Await — không block thread, cho phép xử lý request khác trong khi đợi
    var response = await _deployService.Start(challengeStartReq);
    
    // Pattern matching với switch expression
    return response.status switch
    {
        (int)HttpStatusCode.OK => Ok(response),
        (int)HttpStatusCode.BadRequest => BadRequest(response),
        (int)HttpStatusCode.NotFound => NotFound(response),
        _ => StatusCode(response.status, response)
    };
}
```

**Tại sao quan trọng?** Khi 500 thí sinh cùng start challenge, server không bị block — mỗi request `await` DB/Redis xong sẽ trả thread về pool để xử lý request khác.

---

### 5.3. Entity Framework Core — ORM

EF Core ánh xạ C# class → database table, không cần viết SQL:

```csharp
// Model (ResourceShared/Models/Challenge.cs)
public partial class Challenge
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public string State { get; set; } = null!;  // "visible" | "hidden"
    public bool RequireDeploy { get; set; }      // true nếu cần deploy pod
    public string? ImageLink { get; set; }        // JSON chứa Docker image info
    public int? TimeLimit { get; set; }           // Giới hạn thời gian (phút)
    public int? CpuLimit { get; set; }            // CPU limit (millicores)
    public int? MemoryLimit { get; set; }         // Memory limit (MB)
    public bool? UseGvisor { get; set; }          // Dùng sandbox gVisor?
    public bool? HardenContainer { get; set; }    // Container hardening?
    
    // Navigation properties — EF tự JOIN khi cần
    public virtual ICollection<Submission> Submissions { get; set; }
    public virtual ICollection<Solf> Solves { get; set; }
    public virtual ICollection<Hint> Hints { get; set; }
}

// Truy vấn với LINQ — EF tự sinh SQL
var challenge = await _dbContext.Challenges
    .AsNoTracking()                              // Không track thay đổi (readonly)
    .Include(c => c.Flags)                       // JOIN bảng Flags
    .Include(c => c.Files)                       // JOIN bảng Files
    .FirstOrDefaultAsync(c => c.Id == id);       // WHERE id = @id LIMIT 1
```

---

### 5.4. Middleware — Xử Lý Tầng Trung

Middleware là vòng bọc bao quanh request pipeline. FCTF dùng middleware tùy chỉnh để decode JWT:

```csharp
// TokenAuthenticationMiddleware (ResourceShared/Middlewares/)
public class TokenAuthenticationMiddleware
{
    private readonly RequestDelegate _next;
    
    public async Task InvokeAsync(HttpContext context)
    {
        // Lấy JWT từ header Authorization: Bearer <token>
        var token = context.Request.Headers["Authorization"]
            .ToString()
            .Replace("Bearer ", "");
        
        if (!string.IsNullOrEmpty(token))
        {
            // Verify JWT và decode payload
            var payload = TokenHelper.DecodeToken(token);
            if (payload != null)
            {
                // Inject vào HttpContext để controller dùng
                context.Items["UserId"] = payload.UserId;
                context.Items["TeamId"] = payload.TeamId;
            }
        }
        
        // Tiếp tục pipeline
        await _next(context);
    }
}
```

---

### 5.5. Background Service — Worker Nền

`DeploymentConsumer` dùng `BackgroundService` — một class đặc biệt của ASP.NET Core chạy vòng lặp nền:

```csharp
// DeploymentConsumer/Worker.cs
public class Worker : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Vòng lặp chạy mãi mãi (đến khi app shutdown)
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Kiểm tra số workflow đang chạy
                var runningCount = await _argoService.GetRunningWorkflowsCountAsync();
                
                if (runningCount < MAX_RUNNING_WORKFLOW)
                {
                    // Dequeue batch từ RabbitMQ
                    var messages = await _consumerService
                        .DequeueAvailableBatchAsync(batchSize);
                    
                    // Submit Argo Workflow cho mỗi message
                    foreach (var message in messages)
                    {
                        await ProcessMessageAsync(message);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Worker error");
            }
            
            // Nghỉ N giây trước lần poll tiếp theo
            await Task.Delay(POLL_INTERVAL_MS, stoppingToken);
        }
    }
}
```

---

### 5.6. Custom Attribute — Bảo Vệ Internal API

DeploymentCenter dùng Custom Attribute để enforce SecretKey:

```csharp
// [RequireSecretKey] — đặt trên action cần xác thực service-to-service
[HttpPost("start")]
[RequireSecretKey]  // ← Filter này chạy TRƯỚC khi controller method được gọi
public async Task<IActionResult> StartChallenge(...)
{
    // Chỉ đến đây nếu SecretKey hợp lệ
}

// Bên trong RequireSecretKeyAttribute:
public class RequireSecretKeyAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        // Lấy secret key từ header
        var secretKey = context.HttpContext.Request.Headers["X-Secret-Key"];
        
        // Verify HMAC (timestamp + challenge_id + team_id)
        if (!SecretKeyHelper.Verify(secretKey, ...))
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        
        base.OnActionExecuting(context);
    }
}
```

---

## 6. Luồng Hoạt Động Thực Tế — Minh Họa Bằng Code

### Luồng: Thí Sinh Nhấn "Start Challenge"

```
[1] ContestantPortal (React)
    POST /api/challenge/start { challengeId: 42 }
    
[2] ContestantBE — ChallengeController.StartChallenge()
    ├─ TokenAuthMiddleware inject UserId=5, TeamId=3
    ├─ Check: user có team không? (TeamId != null)
    ├─ Check: challenge có RequireDeploy không?
    ├─ Check: challenge state != HIDDEN
    ├─ Check: prerequisites đã hoàn thành chưa?
    ├─ Check: MaxAttempts, MaxDeployCount
    ├─ Check: limit_challenges (đang chạy bao nhiêu instance?)
    ├─ Acquire Redis lock: "start_lock_42_3" (SETNX, TTL=30s)
    │   └─ Nếu không acquire được → 409 Conflict
    └─ Gọi ChallengeService.ChallengeStart()
    
[3] ChallengeService.ChallengeStart()
    ├─ Tạo SecretKey (HMAC: timestamp + challenge_id + team_id)
    └─ HTTP POST → DeploymentCenter :5020/api/challenge/start
       payload: { challengeId, teamId, userId, secretKey }
       
[4] DeploymentCenter — DeployService.Start()
    ├─ Verify SecretKey (HMAC check)
    ├─ Đọc Redis key: "deploy_challenge_42_3"
    │   - PENDING → "đang deploy, đợi"
    │   - RUNNING → "đang chạy, trả URL"
    │   - DELETING → "đang xóa, đợi"
    │   - Không có → tiếp tục
    ├─ Publish message vào RabbitMQ:
    │   exchange: deployment_exchange, key: deploy
    │   payload: { challengeId: 42, teamId: 3, userId: 5, expiry: ... }
    └─ Ghi Redis: { status: "PENDING_DEPLOY", createdAt: ... }
       TTL = DEPLOYMENT_QUEUE_TIMEOUT_MINUTES
       
[5] DeploymentConsumer — Worker (background, chạy song song)
    ├─ Poll: runningWorkflows (3) < MAX (10) → OK
    ├─ Dequeue message từ RabbitMQ
    ├─ Load challenge từ DB (ImageLink, CpuLimit, UseGvisor,...)
    ├─ ChallengeHelper.BuildArgoPayload():
    │   Tạo Argo Workflow spec JSON:
    │   { image: "registry.fctf.io/challenge-42:latest",
    │     cpu: "500m", memory: "256Mi",
    │     runtime: "gvisor",
    │     namespace: "deploy-challenge-42-team-3" }
    ├─ POST → Argo Workflows API /submit
    ├─ Nhận workflow_name: "challenge-42-team-3-abc123"
    ├─ Ack message RabbitMQ
    └─ Cập nhật Redis: { status: "PENDING", workflow_name: "..." }
    
[6] Argo Workflows → Kubernetes
    Tạo namespace: deploy-challenge-42-team-3
    Deploy Pod từ Docker image
    Áp dụng CPU/Memory limit, gVisor, network policy
    
[7] DeploymentListener — ChallengesInformerService (K8s Watch)
    Nhận event ADDED/MODIFIED
    Pod state = Running, containers ready
    → Lấy service URL: "challenge-42.deploy-challenge-42-team-3.svc:8080"
    → Cập nhật Redis:
       deploy_challenge_42_3 = {
           status: "RUNNING",
           challenge_url: "https://gateway.fctf.io/?fctftoken=eyJ...",
           ready: true,
           time_finished: <unix_timestamp>
       }
       
[8] ContestantPortal polling GET /api/challenge/42
    ContestantBE đọc Redis → trả về:
    { is_started: true, challenge_url: "...", time_remaining: 3600 }
    
[9] Thí sinh click URL → ChallengeGateway → Challenge Pod
```

---

## 7. Bảo Mật & Hiệu Năng Với C#

### 7.1. Rate Limiting với Redis

```csharp
// AspNetCoreRateLimit — cấu hình trong ContestantBE/RateLimiting/
// Giới hạn số request per IP per endpoint
services.Configure<IpRateLimitOptions>(options =>
{
    options.GeneralRules = new List<RateLimitRule>
    {
        new RateLimitRule
        {
            Endpoint = "POST:/api/challenge/attempt",
            Period = "1m",
            Limit = 30   // Tối đa 30 lần submit/phút per IP
        }
    };
});
```

### 7.2. Distributed Lock với Redis

```csharp
// RedisLockHelper — tránh race condition khi start/stop challenge
public async Task<bool> TryAcquireLockAsync(string key, TimeSpan ttl)
{
    // Redis SETNX (SET if Not eXists) — atomic operation
    return await _redis.StringSetAsync(
        key,
        "locked",
        ttl,
        When.NotExists  // Chỉ set nếu key chưa tồn tại
    );
}

// Sử dụng trong ChallengeController:
var lockKey = $"start_lock_{challengeId}_{teamId}";
if (!await _redisLock.TryAcquireLockAsync(lockKey, TimeSpan.FromSeconds(30)))
{
    return Conflict("Another start request is in progress");
}
```

### 7.3. Atomic Flag Submission Check

```csharp
// Kiểm tra MaxAttempts bằng Lua script (atomic Redis operation)
// Tránh race condition khi nhiều request cùng lúc
var luaScript = @"
    local current = redis.call('INCR', KEYS[1])
    if current > tonumber(ARGV[1]) then
        return -1  -- vượt quá giới hạn
    end
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return current
";

var result = await _redis.ScriptEvaluateAsync(
    luaScript,
    new RedisKey[] { $"attempt_count_{challengeId}_{teamId}" },
    new RedisValue[] { maxAttempts, ttlSeconds }
);
```

### 7.4. Output Cache & Redis Cache

```csharp
// Kết quả scoreboard được cache để giảm tải DB
[OutputCache(Duration = 30)]  // Cache 30 giây
public async Task<IActionResult> GetScoreboard()
{
    // Chỉ query DB nếu cache miss
    var data = await _scoreboardService.GetTopTeams();
    return Ok(data);
}
```

---

## 8. Tóm Tắt Vai Trò C# Trong Hệ Thống

```
┌─────────────────────────────────────────────────────────────┐
│                    C# / ASP.NET Core                         │
│                  (4 projects, 1 solution)                     │
│                                                              │
│  ContestantBE ──── Não nghiệp vụ thí sinh                   │
│      ↓              Auth, Challenge, Flag, Hint, Scoreboard  │
│      ↓                                                       │
│  DeploymentCenter ── Tổng đài điều phối                     │
│      ↓               Nhận lệnh, check state, push queue     │
│      ↓                                                       │
│  DeploymentConsumer ── Thợ thực sự                          │
│      ↓                 Poll queue, submit Argo              │
│      ↓                                                       │
│  DeploymentListener ── Tai nghe K8s                         │
│                        Watch pods, update Redis/DB          │
│                                                             │
│  ResourceShared ── Xương sống dùng chung                    │
│                    Models, DTOs, Helpers, K8sService        │
└─────────────────────────────────────────────────────────────┘
```

### C# chịu trách nhiệm:

| Trách nhiệm | Service C# |
|---|---|
| Xác thực người dùng (JWT) | ContestantBE |
| Validate và xử lý flag submission | ContestantBE |
| Kiểm soát race condition (Redis lock, Lua atomic) | ContestantBE + DeploymentCenter |
| Điều phối lifecycle challenge pod | DeploymentCenter |
| Throttle số pod deploy song song | DeploymentConsumer |
| Watch Kubernetes events real-time | DeploymentListener |
| Tự phục hồi sau downtime (reconcile) | DeploymentListener |
| Tương thích Python CTFd (SHA256, ItsDangerous) | ResourceShared |

---

*Tài liệu được soạn dựa trên phân tích source code thực tế của FCTF-temp-v5 — 10/04/2026*
