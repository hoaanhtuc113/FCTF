# FCTF Platform — Phân Tích Kiến Trúc & Luồng Hoạt Động Chi Tiết

> **Ngày phân tích:** 19/04/2026  
> **Version:** FCTF-Multiple_Contest  
> **Người phân tích:** Antigravity AI
> **Ghi chú:** Tài liệu này phân tích codebase FCTF-Multiple_Contest — nhánh phát triển Multi-Contest từ FCTF-temp-v5.

---

## 1. Tổng Quan Hệ Thống

FCTF là nền tảng CTF (Capture The Flag) dạng **microservices**, được thiết kế để chạy các cuộc thi quy mô lớn với khả năng **deploy challenge động (dynamic deployment)**, môi trường cô lập (isolated per team), và quản lý vòng đời đầy đủ trên hạ tầng **Kubernetes (K3s)**.

### Stack Công Nghệ

| Thành phần | Công nghệ |
|---|---|
| Frontend (Portal thi) | React + TypeScript + Vite + Tailwind CSS |
| Backend xử lý thi | ASP.NET Core 8 (C#) |
| Quản lý nền tảng | Python Flask (CTFd fork) |
| Gateway challenge | Go (reverse proxy HTTP + TCP) |
| Message Queue | RabbitMQ |
| Cache / Lock | Redis |
| Database | MariaDB 10.11 |
| Container Orchestration | Kubernetes (K3s) |
| Workflow Engine | Argo Workflows |
| Log aggregation | Loki + Grafana |

---

## 2. Sơ Đồ Kiến Trúc Tổng Quát

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTERNET / Users                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          ┌───────────▼───────────┐
          │   ContestantPortal    │  React + TypeScript (Frontend)
          │   (SPA on Browser)    │  Port: 3000 (dev)
          └───────────┬───────────┘
                      │ REST API calls
          ┌───────────▼───────────┐
          │     ContestantBE      │  ASP.NET Core C# API
          │   (Port: 5010)        │  JWT Auth + Rate Limiting
          └────┬──────────────────┘
               │                  │
     ┌─────────▼────────┐    ┌────▼────────────────────┐
     │   DeploymentCenter│   │ FCTF-ManagementPlatform │
     │   (Port: 5020)   │    │  (CTFd Fork, Port:8000) │
     └────┬─────────────┘    └─────────────────────────┘
          │
     ┌────▼──────────────────────────────────────┐
     │              RabbitMQ                     │
     │   Exchange: deployment_exchange           │
     │   Queue: deploy                           │
     └────┬──────────────────────────────────────┘
          │
     ┌────▼──────────────┐
     │ DeploymentConsumer│  Background worker
     │ (polls batch)     │  gọi Argo Workflows API
     └────┬──────────────┘
          │ submit workflow
     ┌────▼─────────────┐
     │  Argo Workflows  │  Tạo K8s Namespace mới
     │  (Kubernetes)    │  Deploy Challenge Pod
     └────┬─────────────┘
          │ Pod events (watch)
     ┌────▼─────────────┐
     │DeploymentListener│  K8s Informer/Watcher
     │ (Port: 5030)     │  Cập nhật Redis cache
     └────┬─────────────┘
          │
     ┌────▼─────────────────────────────────────┐
     │           ChallengeGateway               │
     │   HTTP Proxy (Port: 8080)                │
     │   TCP Proxy (Port: 1337)                 │
     │   JWT Token auth + Rate Limiting         │
     └──────────────────────────────────────────┘
          │
     ┌────▼────────────────────────────┐
     │   Challenge Pods (K8s)          │
     │   Isolated namespace per team   │
     └─────────────────────────────────┘
```

---

## 3. Mô Tả Các Service Chính

### 3.1. `ContestantPortal` — Frontend SPA
- **Tech:** React + TypeScript + Vite + Tailwind CSS
- **Chức năng:** Giao diện cho thí sinh thi đấu
- **Các trang chính:**
  - `/login` — Đăng nhập
  - `/challenges` — Danh sách challenge theo topic
  - `/challenge/:id` — Chi tiết challenge, start/stop/submit flag
  - `/scoreboard` — Bảng xếp hạng (cần đăng nhập)
  - `/public/scoreboard` — Bảng điểm công khai
  - `/tickets` — Hỗ trợ kỹ thuật
  - `/tickets/:id` — Chi tiết ticket
  - `/profile` — Thông tin cá nhân, đổi mật khẩu
  - `/instances` — Theo dõi tất cả challenge instance đang chạy
  - `/action-logs` — Lịch sử hành động

### 3.2. `ContestantBE` — Backend chính cho thí sinh
- **Tech:** ASP.NET Core 8 (C#), Port 5010
- **Xác thực:** JWT Bearer token, middleware `TokenAuthenticationMiddleware`
- **Rate Limiting:** Redis-backed IP rate limiting (`AspNetCoreRateLimit`)
- **Cache:** Output cache + Redis cache
- **CAPTCHA:** Cloudflare Turnstile (tuỳ chọn bật/tắt qua env)
- **Password Policy:** Bắt buộc 8-20 ký tự, hoa/thường/số/ký tự đặc biệt
- **Các Controller chính:**

| Controller | Chức năng |
|---|---|
| `AuthController` | Login, Đăng ký thí sinh, Đăng xuất, đổi mật khẩu |
| `ChallengeController` | Xem challenge, start/stop, submit flag |
| `HintController` | Mua và xem hint |
| `ScoreboardController` | Xem bảng xếp hạng |
| `TeamController` | Xem thông tin đội |
| `TicketController` | Tạo và quản lý ticket hỗ trợ |
| `FileController` | Tải file đính kèm challenge |
| `ConfigController` | Lấy cấu hình cuộc thi |
| `ActionLogsController` | Lịch sử hành động |
| `UsersController` | Thông tin user |

### 3.3. `DeploymentCenter` — Trung tâm điều phối deployment
- **Tech:** ASP.NET Core 8 (C#), Port 5020
- **Chức năng:** Nhận yêu cầu start/stop challenge, đẩy vào RabbitMQ, xử lý callback từ Argo
- **Kết nối:** RabbitMQ (Producer), Redis (cache deployment state), K8s API

### 3.4. `DeploymentConsumer` — Background Worker tiêu thụ queue
- **Tech:** ASP.NET Core 8 Worker Service (BackgroundService)
- **Chức năng:** Poll RabbitMQ, gọi Argo Workflows API để submit workflow
- **Kiểm soát tải:** Giới hạn số workflow chạy song song tối đa (`MAX_RUNNING_WORKFLOW`)
- **Batch processing:** Xử lý nhiều message một lúc theo `BATCH_SIZE`

### 3.5. `DeploymentListener` — K8s Watcher
- **Tech:** ASP.NET Core 8 (C#), sử dụng Kubernetes C# SDK
- **Chức năng:** Watch toàn bộ Pod trên K8s có label `ctf/kind=challenge`, cập nhật trạng thái deployment vào Redis
- **Sharding:** Phân tán xử lý event qua nhiều worker theo Pod UID hash
- **Reconcile:** Khi restart, tự động sửa các orphaned deployment (pod đã xoá nhưng chưa cập nhật DB)

### 3.6. `ChallengeGateway` — Cổng truy cập challenge
- **Tech:** Go (Golang)
- **HTTP Proxy:** Port 8080, reverse proxy với JWT cookie auth
- **TCP Proxy:** Port 1337, proxy raw TCP (netcat, pwn tools) với token auth qua stdin
- **Bảo mật:** FCTF signed JWT token (`fctftoken`), rate limiting per IP & per token, session expiry tự động

### 3.7. `FCTF-ManagementPlatform` — Quản lý admin
- **Tech:** Python Flask (fork của CTFd open-source)
- **Chức năng:** Portal admin để quản lý challenge, user, team, start/stop cuộc thi
- **Port:** 8000
- **Tích hợp:** Deploy challenge vào K8s qua Argo, gọi DeploymentCenter API khi cần

---

## 4. Luồng Hoạt Động Chi Tiết

---

### 🔐 Luồng 1: Đăng Nhập

```
ContestantPortal (React)
    │  POST /api/auth/login {username, password, captchaToken?}
    ▼
ContestantBE (AuthController)
    │  1. Validate Cloudflare Turnstile captcha (nếu bật)
    │  2. Tìm user theo username trong DB (MariaDB)
    │  3. Kiểm tra verified, banned, type == "user"
    │  4. Xác thực password bằng SHA256 (Python CTFd style)
    │     (Luôn chạy 1 lần hash dù user không tồn tại — chống timing attack)
    │  5. Kiểm tra team tồn tại
    │  6. Ghi Tracking (IP login)
    │  7. Invalidate Redis cache key auth:user:{id}
    │  8. Generate JWT token (expire 1 ngày)
    ▼
Trả về: {id, username, email, team, token}
    │
ContestantPortal lưu token vào localStorage/context
```

**Lưu ý:** Token là JWT chuẩn, được xác thực ở tầng middleware `TokenAuthenticationMiddleware` — middleware này đọc và decode JWT, sau đó inject `UserId`, `TeamId` vào `IUserContext`.

---

### 📝 Luồng 1b: Đăng Ký Thí Sinh (Mới trong FCTF-Multiple_Contest)

```
ContestantPortal
    │  GET /api/auth/registration-metadata  (lấy danh sách field đăng ký)
    ▼
ContestantBE (AuthController → AuthService.GetRegistrationMetadata)
    │  Kiểm tra contestant_registration_enabled == true
    │  Trả về: {userFields: [...], constraints: {numUsersLimit}}

ContestantPortal
    │  POST /api/auth/register {username, email, password, confirmPassword, captchaToken, userFields}
    ▼
ContestantBE (AuthController → AuthService.RegisterContestant)
    │  1. Kiểm tra contestant_registration_enabled
    │  2. Validate Cloudflare Turnstile captcha
    │  3. Validate password policy (8-20 ký tự, hoa/thường/số/ký tự đặc biệt)
    │  4. Kiểm tra num_users limit (Redis lock để atomic check)
    │  5. Kiểm tra username/email đã tồn tại
    │  6. Validate custom registration fields (required, boolean/text)
    │  7. Tạo User (Verified=false) + FieldEntries trong 1 transaction
    ▼
Trả về: "Registration submitted. Your account is pending verification."
    │
Admin vào FCTF-ManagementPlatform → duyệt tài khoản → set Verified=true
```

---

### 🚪 Luồng 1c: Đăng Xuất

```
ContestantPortal
    │  POST /api/auth/logout
    ▼
ContestantBE (AuthController → AuthService.Logout)
    │  1. Xóa tất cả Token records của user trong DB
    │  2. Invalidate Redis cache key auth:user:{userId}
    ▼
Trả về: "Logged out successfully"
```

---

### 🏁 Luồng 2: Xem Danh Sách Challenge

```
ContestantPortal
    │  GET /api/challenge/by-topic  (lấy danh sách topic)
    ▼
ContestantBE (ChallengeController → ChallengeService)
    │  1. Query DB: phân nhóm challenge theo Category, không tính HIDDEN
    │  2. Tính số đã solve của team
    ▼
Trả về: [{topic_name, challenge_count, cleared}, ...]

ContestantPortal chọn topic
    │  GET /api/challenge/list_challenge/{category_name}
    ▼
ContestantBE (ChallengeService.GetChallengeByCategories)
    │  1. Query challenges theo category, state != HIDDEN
    │  2. Kiểm tra prerequisites (challenge cần hoàn thành trước)
    │     - Nếu chưa đủ prereq + anonymize==false → bỏ qua (không show)
    │  3. Kiểm tra trạng thái deploy từ Redis (pod running/pending?)
    │  4. Kiểm tra team đã solve chưa
    ▼
Trả về: [{id, name, value, solve_by_myteam, pod_status, ...}, ...]
```

---

### 📋 Luồng 3: Xem Chi Tiết Challenge

```
ContestantPortal
    │  GET /api/challenge/{id}
    ▼
ContestantBE (ChallengeService.GetById)
    │  1. Load challenge + files từ DB
    │  2. Kiểm tra state != "hidden"
    │  3. Kiểm tra prerequisites
    │  4. Lấy thông tin solve của team
    │  5. Generate signed URL cho file đính kèm (ItsDangerous)
    │  6. Nếu challenge có RequireDeploy:
    │     a. Đọc Redis cache key: deploy_challenge_{id}_{teamId}
    │     b. Nếu có cache → trả về {is_started: true, challenge_url, time_remaining, pod_status}
    │     c. Nếu không → {is_started: false}
    ▼
Trả về: {challenge_data, is_started, challenge_url, time_remaining, pod_status}
```

---

### 🚀 Luồng 4: Start Challenge (Deploy)

Đây là luồng **phức tạp nhất** trong hệ thống — bao gồm nhiều service.

```
ContestantPortal
(Captain click "Start Challenge")
    │  POST /api/challenge/start {challengeId}
    ▼
ContestantBE (ChallengeController.StartChallenge)
    │  Kiểm tra:
    │  ├─ User có team không?
    │  ├─ Challenge có RequireDeploy không?
    │  ├─ Challenge state != HIDDEN, SharedInstance != true
    │  ├─ Prereqs đã hoàn thành chưa?
    │  ├─ MaxAttempts: đã hết số lần thử chưa?
    │  ├─ MaxDeployCount: đã đạt giới hạn deploy chưa?
    │  ├─ Team đã solve rồi chưa?
    │  ├─ captain_only_start_challenge → chỉ captain mới được start?
    │  ├─ limit_challenges: đang có bao nhiêu instance chạy?
    │  └─ Redis lock: đang có start request khác không?
    │
    │  Gọi ChallengeService.ChallengeStart(challenge, user)
    ▼
ContestantBE (ChallengeService.ChallengeStart)
    │  1. Tạo SecretKey có timestamp
    │  2. Gọi HTTP POST → DeploymentCenter /api/challenge/start
    ▼
DeploymentCenter (ChallengeController → DeployService.Start)
    │  1. Kiểm tra Redis cache:
    │     - PENDING → "đang deploy, đợi"
    │     - RUNNING + ready → "đang chạy, trả url"
    │     - DELETING → "đang xoá, đợi"
    │     - STOPPED → xoá cache cũ
    │  2. Đẩy message vào RabbitMQ (deployment_exchange, routing_key: deploy)
    │  3. Lưu Redis cache: {status: PENDING_DEPLOY, challenge_id, team_id}
    │     TTL = DEPLOYMENT_QUEUE_TIMEOUT_MINUTES
    ▼
RabbitMQ (Queue: deploy)
    │
    ▼
DeploymentConsumer (Worker.ProcessAsync — Background Service)
    │  (Poll mỗi N giây, batch N message)
    │  1. Kiểm tra số workflow đang chạy < MAX_RUNNING_WORKFLOW
    │  2. Dequeue batch messages
    │  3. Mỗi message:
    │     a. Lấy Redis cache (phải còn tồn tại, chưa bị expire)
    │     b. Load challenge từ DB
    │     c. Parse ChallengeImageDTO từ challenge.ImageLink (JSON)
    │     d. Xác định CPU/Memory limit, gVisor, hardening
    │     e. Build Argo Workflow payload (ChallengeHelper.BuildArgoPayload)
    │     f. POST → Argo Workflows API /submit
    │     g. Lấy workflow_name từ response
    │     h. ACK message từ RabbitMQ
    │     i. Cập nhật Redis cache: {status: PENDING, workflow_name, namespace: appName}
    ▼
Argo Workflows (K8s)
    │  Tạo K8s namespace mới: deploy-challenge-{id}-team-{teamId}
    │  Deploy Pod với image từ ChallengeImageDTO
    │  Áp dụng:
    │    - CPU/Memory limit & request
    │    - gVisor runtime (nếu bật)
    │    - Container hardening
    │    - Network policies
    ▼
DeploymentListener (ChallengesInformerService — K8s Watch)
    │  Nhận Pod events (ADDED, MODIFIED, DELETED)
    │  Shard event vào N worker channel (theo hash UID)
    │
    │  Xử lý ADDED/MODIFIED:
    │  ├─ Parse namespace → teamId, challengeId
    │  ├─ Lấy Redis cache
    │  ├─ Pod bị Stuck (CrashLoopBackOff, ImagePullBackOff)?
    │  │   └─ Xoá namespace + cập nhật Redis: FAILED
    │  ├─ Pod có DeletionTimestamp → đang terminating, bỏ qua
    │  ├─ Pod UID thay đổi → HandlePodRestart: reset ready=false
    │  └─ Pod running + all containers ready?
    │       └─ HandleRunningState:
    │            a. K8sService.HandleChallengeRunning (lấy domain/port từ K8s service)
    │            b. onStatusChange → Cập nhật Redis: {status: RUNNING, challenge_url, ready: true, time_finished}
    │
    │  Xử lý DELETED:
    │  ├─ AtomicRemoveDeploymentZSet (xoá khỏi active list của team)
    │  └─ Cập nhật DB: ChallengeStartTracking.StoppedAt = UtcNow
    ▼
Redis Cache cập nhật: deploy_challenge_{id}_{teamId}
    │  {status: RUNNING, challenge_url, ready: true, time_finished}
    ▼
ContestantPortal polling: GET /api/challenge/{id}
    │  Phát hiện is_started=true, challenge_url, time_remaining
    ▼
Thí sinh nhận challenge_url (có signed JWT token)
```

---

### 🌐 Luồng 5: Truy Cập Challenge Qua Gateway (HTTP)

```
Thí sinh click challenge_url
    │  Ví dụ: https://gateway.fctf.io/?fctftoken=eyJhb...
    ▼
ChallengeGateway (HTTP, Port 8080)
    │  Middleware chain: Logging → RateLimit (per IP) → BodySizeLimit → Handler
    │
    │  Nếu có ?fctftoken= trong URL:
    │  1. Verify JWT (HMAC)
    │  2. Rate limit theo (token, IP)
    │  3. Reset tất cả cookie cũ
    │  4. Set cookie FCTF_Auth_Token (HttpOnly, SameSite=Lax)
    │  5. Redirect về URL sạch (bỏ ?fctftoken)
    │
    │  Nếu đã có cookie FCTF_Auth_Token:
    │  1. Lấy token từ cookie
    │  2. Verify JWT
    │  3. Rate limit theo (token, IP)
    │  4. ExpandRoute(payload.Route) → target host (pod IP/DNS)
    │  5. Reverse proxy request → Challenge Pod
    ▼
Challenge Pod (K8s)
    │  Xử lý HTTP request
    ▼
Response trả về thí sinh
```

**Log format:** `HTTP GET /path 200 team="5" challenge="42" ns="deploy-challenge-42-team-5" method="GET" status="200" -> 10.0.5.100:5000`

---

### 🔌 Luồng 6: Truy Cập Challenge Qua Gateway (TCP/Netcat)

```
Thí sinh dùng netcat/pwn tools:
    $ nc gateway.fctf.io 1337

ChallengeGateway (TCP, Port 1337)
    │  Kiểm tra IP rate limit
    │  Kiểm tra connection count per IP
    │  Kiểm tra global connection limit
    │
    │  Gửi prompt:
    │  "--- CTF AUTHENTICATION ---
    │   Please enter your token (Timeout 10s): "
    │
    │  Nhận token từ stdin (tối đa 1024 bytes)
    │  Verify JWT token
    │  Rate limit theo (token, IP)
    │  Kiểm tra max concurrent connections per token
    │
    │  Kết nối TCP tới Challenge Pod: net.Dial("tcp", host)
    │  Gửi: "Access Granted! Connecting to challenge...\n"
    │
    │  Bidirectional copy:
    │  ├─ Client → Challenge (ghi log sample base64)
    │  └─ Challenge → Client
    │
    │  Auto-close khi token hết hạn (expiry timer)
    ▼
Challenge Pod nhận TCP connection

Log: "[+] Auth OK from 1.2.3.4 team="5" challenge="42" proto="tcp" event="auth_ok" -> 10.0.5.100:9999"
```

---

### 🛑 Luồng 7: Stop Challenge

```
ContestantPortal (Captain click "Stop Challenge")
    │  POST /api/challenge/stop {challengeId}
    ▼
ContestantBE (ChallengeController.StopChallenge)
    │  1. Acquire Redis distributed lock (30s)
    │     └─ Nếu không acquire được → 409 Conflict
    │  2. Kiểm tra Redis cache tồn tại
    │  3. Gọi ChallengeService.ForceStopChallenge
    ▼
ContestantBE (ChallengeService.ForceStopChallenge)
    │  1. Tạo SecretKey
    │  2. POST → DeploymentCenter /api/challenge/stop
    ▼
DeploymentCenter (DeployService.Stop)
    │  Lấy deployInfo từ Redis
    │
    │  Nếu user là Admin:
    │  └─ Xóa namespace ngay lập tức (K8s API)
    │     Xóa Redis cache ngay
    │
    │  Nếu user thường:
    │  1. Đặt status = DELETING, ready = false
    │  2. Cập nhật Redis TTL = 40s
    │  3. Gọi K8s API xóa namespace
    │     (DeploymentListener sẽ nhận DELETED event → cleanup)
    ▼
DeploymentListener nhận DELETED event
    │  AtomicRemoveDeploymentZSet
    │  DB: ChallengeStartTracking.StoppedAt = UtcNow
    │  Redis cache bị xoá tự động (TTL hết)
```

---

### 🏳️ Luồng 8: Submit Flag

```
ContestantPortal
    │  POST /api/challenge/attempt {challengeId, submission}
    ▼
ContestantBE (ChallengeController.Attempt)
    │
    │  Tiền kiểm tra (không cần lock):
    │  ├─ CTF đang paused? → 403
    │  ├─ Submission null/empty/> 1000 chars? → 400
    │  ├─ captain_only_submit_challenge? Không phải captain → 403
    │  ├─ Cooldown (per challenge, per team) → 429 (Redis atomic)
    │  ├─ Challenge state: hidden → 404, locked → 403
    │  ├─ Prerequisites chưa đủ → 403
    │  ├─ Team đã solve → "already_solved"
    │  └─ MaxAttempts đã hết (optimistic check) → "0 tries remaining"
    │
    │  Xử lý flag:
    │  ChallengeHelper.Attempt(challenge, request)
    │    ├─ Flag tĩnh (static): so sánh trực tiếp
    │    ├─ Flag regex: regex match
    │    └─ Flag dynamic: verify per-instance
    │
    │  Nếu đúng (CORRECT):
    │  ├─ Re-check solve (race condition protection)
    │  ├─ Tạo Submission + Solf record trong DB
    │  ├─ Dynamic challenge: RecalculateDynamicChallengeValue (Redis lock)
    │  ├─ Auto-stop pod nếu RequireDeploy & pod running
    │  ├─ Log ActionLogs: CORRECT_FLAG
    │  └─ Trả về: {status: "correct", value: X}
    │
    │  Nếu sai (INCORRECT):
    │  ├─ KPM check (Redis INCR atomic, per user per minute)
    │  │   └─ Vượt quá → 429 ratelimited
    │  ├─ MaxAttempts check (Redis Lua script atomic)
    │  │   ├─ Smart sync: so sánh với DB count thực tế
    │  │   └─ Vượt quá → "0 tries remaining"
    │  ├─ Lưu Submission (type: incorrect) vào DB
    │  ├─ Log ActionLogs: INCORRECT_FLAG
    │  └─ Trả về: {status: "incorrect", message, tries_remaining, cooldown}
```

---

### 💡 Luồng 9: Mua Hint

```
ContestantPortal
    │  POST /api/hint/{id}  (unlock hint)
    ▼
ContestantBE (HintController → HintService)
    │  1. Kiểm tra hint tồn tại
    │  2. Kiểm tra đã unlock chưa (HintUnlock table)
    │  3. Kiểm tra team đủ điểm không
    │  4. Trừ điểm + tạo HintUnlock record
    ▼
Trả về: {content, cost}
```

---

### 📊 Luồng 10: Xem Scoreboard

```
ContestantPortal
    │  GET /api/scoreboard?page=1
    ▼
ContestantBE (ScoreboardController → ScoreboardService)
    │  1. Query top N teams (theo điểm tổng)
    │  2. Lấy danh sách solves của mỗi team (với timestamp)
    │  3. Phân trang kết quả
    ▼
Trả về: [{rank, team_name, score, solves_history}, ...]

Lưu ý: Public scoreboard (/public/scoreboard) không cần đăng nhập
```

---

### 🎫 Luồng 11: Tạo & Xử Lý Ticket Hỗ Trợ

```
ContestantPortal
    │  POST /api/ticket {title, body, challengeId}
    ▼
ContestantBE (TicketController → TicketService)
    │  1. Validate input
    │  2. Tạo Ticket record trong DB
    │  3. (Optional) Gửi notification
    ▼
Admin (qua FCTF-ManagementPlatform)
    │  Xem ticket, reply
    ▼
ContestantPortal
    │  GET /api/ticket/{id}  → xem chi tiết + replies
```

---

### 🔄 Luồng 12: Xử Lý Argo Workflow Callback (Challenge Image Upload)

Luồng này dùng cho **việc build/upload Docker image của challenge mới** (quản trị viên upload):

```
FCTF-ManagementPlatform (Admin upload challenge)
    │  (Gọi DeploymentCenter)
    ▼
Argo Workflows (build & push Docker image)
    │  Gửi callback sau khi workflow hoàn tất
    ▼
DeploymentCenter (ChallengeController → DeployService.HandleMessageFromArgo)
    │  Phân loại message theo Type:
    │
    │  Type == UP (image upload workflow):
    │  ├─ SUCCEEDED → Challenge.State = VISIBLE, DeployStatus = DEPLOY_SUCCEEDED
    │  ├─ FAILED → Challenge.State = HIDDEN, DeployStatus = DEPLOY_FAILED
    │  └─ Ghi DeployHistory record
    │
    │  Type == START (start challenge workflow):
    │  └─ Nếu FAILED → xóa Redis deployment cache
```

---

### 🔁 Luồng 13: Pod Watch & Reconcile (DeploymentListener)

```
DeploymentListener khởi động:
    │  1. List tất cả Pod với label ctf/kind=challenge
    │  2. ReconcileOrphanedCachesAsync:
    │     - Tìm ChallengeStartTracking có StoppedAt==null
    │     - Nhưng namespace không còn tồn tại trong K8s
    │     - Fix: đặt StoppedAt = UtcNow
    │  3. Dispatch tất cả pod hiện tại vào worker shards
    │
    │  Bắt đầu Watch stream (timeout 300s, tự reconnect):
    │  ├─ eventType = ADDED/MODIFIED:
    │  │   └─ ProcessPodChangeAsync
    │  │       ├─ Pod ghost (không có Redis cache) → xóa namespace
    │  │       ├─ Pod stuck → xóa namespace, FAILED
    │  │       ├─ Pod restarting → cập nhật pod_id, ready=false
    │  │       └─ Pod ready → HandleRunningState → cập nhật Redis, notify
    │  │
    │  └─ eventType = DELETED:
    │      ├─ AtomicRemoveDeploymentZSet
    │      ├─ onStatusChange → STOPPED
    │      └─ DB: ChallengeStartTracking.StoppedAt = UtcNow
    │
    │  Lỗi HTTP 410 Gone → resync (resourceVersion = null)
    │  Lỗi transient → reconnect ngay
    │  Lỗi khác → exponential backoff (5s → 30s)
```

---

## 5. Cơ Chế Bảo Mật & Rate Limiting

### 5.1. Xác thực (Authentication)

| Layer | Cơ chế |
|---|---|
| ContestantBE | JWT Bearer token, middleware custom |
| DeploymentCenter | SecretKey HMAC (timestamp + data hash) giữa service-to-service |
| ChallengeGateway | FCTF signed JWT (`fctftoken`) |
| K8s Service-to-Service | In-cluster network policy |

### 5.2. Rate Limiting

| Điểm | Cơ chế | Phạm vi |
|---|---|---|
| ContestantBE | AspNetCoreRateLimit (Redis) | Per IP |
| Flag submission | Redis INCR atomic | Per user per minute (KPM) |
| Flag cooldown | Redis GETSET | Per challenge per team |
| ChallengeGateway HTTP | Redis rate limiter | Per (token, IP) |
| ChallengeGateway TCP | Redis rate limiter + conn count | Per IP + per token |

### 5.3. Concurrency Control

| Tình huống | Cơ chế |
|---|---|
| Race condition submit flag | DB unique constraint + re-check sau khi save |
| Dynamic challenge value | Redis distributed lock (`RedisLockHelper`) |
| Stop challenge | Redis distributed lock (30s TTL) |
| Start challenge | Redis lock + check existing cache |
| Deploy batch | RabbitMQ ack/nack |

---

## 6. Cơ Sở Dữ Liệu (MariaDB)

Các bảng quan trọng (từ `AppDbContext`):

| Bảng | Mô tả |
|---|---|
| `Users` | Thông tin người dùng |
| `Teams` | Thông tin đội |
| `Challenges` | Challenge (type, state, value, imageLink, ...) |
| `Submissions` | Mọi lần submit flag (correct/incorrect) |
| `Solves` | Solve thành công (foreign key Submissions) |
| `Hints` | Hint của challenge |
| `HintUnlocks` | Lịch sử mở hint |
| `Trackings` | Tracking IP đăng nhập |
| `ChallengeStartTrackings` | Lịch sử start/stop pod (StartedAt, StoppedAt, Label=namespace) |
| `DeployHistories` | Lịch sử deploy image |
| `ActionLogs` | Lịch sử hành động (loại 1-4) |
| `Tickets` | Ticket hỗ trợ |
| `TicketReplies` | Reply ticket |

---

## 7. Cấu Trúc Redis Cache

| Key Pattern | Nội dung | TTL |
|---|---|---|
| `deploy_challenge_{id}_{teamId}` | `ChallengeDeploymentCacheDTO` (status, url, namespace, ...) | Dynamic (theo time limit) |
| `active_deploys_team_{teamId}` | Sorted Set: danh sách challenge đang deploy của team | Dynamic |
| `auth:user:{id}` | Auth token UUID | Invalidate on login |
| `kpm_check_{userId}_{minute}` | Counter số lần submit sai trong 1 phút | 90s |
| `submission_cooldown_{challengeId}_{teamId}` | Timestamp lần submit gần nhất | 600s |
| `attempt_count_{challengeId}_{teamId}` | Counter số lần submit sai (atomic) | Dynamic |

---

## 8. Message Queue (RabbitMQ)

| Exchange | Routing Key | Queue | Payload |
|---|---|---|---|
| `deployment_exchange` | `deploy` | `deploy` | `DeploymentQueuePayload { Data, CreatedAt, Expiry }` |

- Message là **persistent** (durable=true)
- TTL = `expirySeconds * 1000` ms (tự expire nếu consumer chậm)
- Consumer poll batch theo interval, tự Nack nếu lỗi, Ack khi submit Argo thành công

---

## 9. Infrastructure & Deployment

### 9.1. Docker Compose (Development/Staging)

```
ctfd          → lấy port 8000  (FCTF-ManagementPlatform)
db            → lấy port 3306  (MariaDB)
cache         → lấy port 6379  (Redis)
contestant-be → lấy port 5010  (ContestantBE)
deployment-center → port 5020  (DeploymentCenter)
deployment-worker → port 5030  (DeploymentListener)
```

> **Lưu ý:** `DeploymentConsumer` KHÔNG có trong docker-compose — đây là background worker, thường chạy trong cùng container hoặc K8s Job.

### 9.2. Kubernetes (Production via K3s)

- Manifests trong `FCTF-k3s-manifest/`
- Challenge Pod chạy trong namespace riêng: `deploy-challenge-{id}-team-{teamId}`
- Label: `ctf/kind=challenge` (dùng để watch & cleanup)
- Hỗ trợ **gVisor** (sandbox runtime) và **container hardening**

---

## 10. Điểm Đáng Chú Ý & Hạn Chế

### ✅ Điểm Mạnh
- **Event-driven architecture** rõ ràng: Watcher → Redis → Poll FE
- **Race condition protection** đầy đủ ở submission (KPM + atomic Lua script)
- **Sharded K8s event processing** tránh bottleneck
- **Reconcile on startup** xử lý missed event khi service restart
- **Dual gateway** (HTTP + TCP) hỗ trợ cả web challenge và pwn challenge
- **Audit trail** đầy đủ: ActionLogs, ChallengeStartTracking, DeployHistory

### ⚠️ Điểm Cần Lưu Ý
- `DeploymentConsumer` biến mất trong docker-compose (có thể chạy riêng hoặc chưa được merged vào compose)
- Argo Workflows callback (Type==START) có comment: "hiện tại Argo chưa bắn trạng thái..." → luồng này chưa hoạt động đầy đủ
- Gateway HTTP hiện dùng cookie nhưng không có CSRF protection rõ ràng
- `deployment-worker` trong docker-compose trỏ tới `DeploymentListener/Dockerfile` (watcher), không phải consumer — cần kiểm tra lại tên dịch vụ

---

## 11. Tóm Tắt Luồng Flow Theo Thứ Tự

```
1. [Auth]        Login → JWT token → lưu localStorage
2. [Browse]      Xem topic → xem challenge list → click challenge
3. [View]        GetById → check prereq → check deployment cache → hiển thị
4. [Deploy]      Start → validate → DeploymentCenter → RabbitMQ → Consumer
                      → Argo → K8s Pod → Watcher → Redis ready → URL token
5. [Access HTTP] Token in URL → ChallengeGateway → cookie → proxy → Pod
6. [Access TCP]  netcat → token prompt → verify → proxy tunnel → Pod
7. [Submit]      Attempt → validate → flag check → record → score/stop pod
8. [Hint]        Unlock → deduct points → reveal content
9. [Stop]        Stop → lock → DeploymentCenter → K8s delete → Watcher → cleanup
10. [Scoreboard]  Rank teams → show history
11. [Ticket]     Create ticket → admin reply → track status
12. [Admin]      FCTF-ManagementPlatform → manage challenges/users/teams
```

---

*Tài liệu được cập nhật lần cuối 19/04/2026 — Phân tích source code FCTF-Multiple_Contest (nhánh multi-contest từ FCTF-temp-v5). Bởi Antigravity AI.*
