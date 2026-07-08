# 4. Security Design

> **Purpose**: Technical security mechanisms — implementation of security requirements from PRD SecurityRequirements.md. Bao gồm xác thực (authentication), phân quyền (authorization), truy cập data-plane, và hardening hệ thống.
>
> **Threat Modeling & Khắc phục rủi ro (Shift Left Security):**
> Thiết kế bảo mật này đặc biệt tập trung giải quyết các nhóm rủi ro (Limitations Analysis) của kiến trúc cũ:
> - **Spoofing**: Đã giải quyết bằng 3 cơ chế xác thực tách biệt (Mục 4.1).
> - **Tampering (Flag Sharing)**: Giải quyết bằng Dynamic Flag Verification (Mục 4.10).
> - **Information Disclosure (IDOR)**: Giải quyết bằng Multi-Tenancy Isolation (Mục 4.2).
> - **Denial of Service (Ghost Pods)**: Giải quyết bằng Infrastructure Lifecycle Security (Mục 4.11).
> - **Authorization Enforcement**: Bắt buộc thực thi tại tầng Service thay vì chỉ ở Controller.

---

## 4.1 UI Authentication — Ba Cơ Chế Đăng Nhập Độc Lập

> **Phân tích thực tế từ source code**: Hệ thống FCTF **không dùng Keycloak SSO thống nhất** cho phía người dùng cuối. Thay vào đó, hệ thống có **3 cơ chế xác thực hoàn toàn tách biệt** phục vụ 3 nhóm người dùng khác nhau.

---

### 4.1.1 Contestant Login — Custom JWT (ContestantPortal + ContestantBE)

Đây là cơ chế đăng nhập cho **thí sinh tham gia thi**. Toàn bộ luồng xác thực được tự xây dựng bởi FCTF, **không qua Keycloak**.

#### Luồng xác thực

```
Contestant nhập username/password
    → POST /auth/login-contestant (ContestantBE)
    → Validate Cloudflare Turnstile CAPTCHA (nếu bật)
    → Tìm user trong DB (type = "user")
    → Xác thực bcrypt-sha256 (tương thích Python passlib v2)
    → Kiểm tra: verified=true, banned=false, hidden=false, team!=null
    → Sinh JWT (HMAC-SHA256) + UUID tokenUuid
    → Lưu tokenUuid vào bảng Tokens (DB)
    → Trả về { generatedToken, user }
    → Frontend lưu token vào localStorage
```

#### Chi tiết kỹ thuật

| Thuộc tính | Chi tiết |
| :--- | :--- |
| **Token Type** | JWT self-signed, thuật toán `HMAC-SHA256`, ký bằng `PRIVATE_KEY` (env var, lưu K8s Secret) |
| **Token Lifetime** | 7 ngày (`expireMinutes = 60 * 24 * 7`) |
| **Token Storage (FE)** | `localStorage` (`auth_token`, `user_info`) |
| **Token Claims** | `userId`, `teamId`, `tokenUuid` (UUID mỗi phiên login), `ClaimTypes.NameIdentifier` |
| **Password Hashing** | `bcrypt-sha256 v2` — tương thích passlib Python: HMAC-SHA256 prehash → BCrypt(cost=10) |
| **Password Policy** | 8–20 ký tự, phải có: chữ hoa, chữ thường, số, ký tự đặc biệt (`!@#$%^&*...`) |
| **Session Validation** | Mỗi request `[Authorize]`: `TokenAuthenticationMiddleware` đối chiếu `tokenUuid` trong JWT với bản ghi trong DB/Redis cache (TTL 60s) |
| **CAPTCHA** | Cloudflare Turnstile (toggle qua config `IsTurnstileEnabled`) |
| **Brute Force** | Không có cơ chế account lockout phía FCTF; dựa vào IP rate limiting (Redis-based AspNetCoreRateLimit) |
| **Logout** | Backend xóa token khỏi DB (`Tokens` table) + xóa Redis cache `auth:user:{userId}` → Token cũ lập tức vô hiệu |

#### Token Revocation (Stateful JWT)

Mặc dù dùng JWT (vốn stateless), ContestantBE triển khai **token revocation** theo cơ chế hybrid:
- Mỗi lần login, sinh `tokenUuid` mới → lưu vào bảng `Tokens` (DB).
- `TokenAuthenticationMiddleware` kiểm tra `tokenUuid` trong JWT **phải khớp** với giá trị trong DB.
- Redis cache `auth:user:{userId}` (TTL 60s) giảm tải DB lookup.
- Khi logout hoặc đổi mật khẩu → xóa token DB + invalidate cache → **mọi JWT cũ trở nên vô hiệu ngay lập tức**.

#### Security Filter Chain (ContestantBE)

```csharp
app.UseRouting();
app.UseCors("AllowAll");
app.UseIpRateLimiting();          // Redis-based rate limiting theo IP
app.UseOutputCache();
app.UseAuthentication();          // Validate JWT Bearer (HMAC-SHA256, PRIVATE_KEY)
app.UseAuthorization();           // Enforce [Authorize] attributes
app.UseMiddleware<TokenAuthenticationMiddleware>(); // Kiểm tra tokenUuid + trạng thái user
app.MapControllers();
```

---

### 4.1.2 Admin Login — CTFd Session-Based (FCTF-ManagementPlatform)

Đây là cơ chế đăng nhập cho **BTC, Admin, Challenge Writer, Jury**. Sử dụng **CTFd** (Python/Flask) — cơ chế xác thực dựa trên **server-side session**.

#### Luồng xác thực

```
Admin nhập username/password (hoặc email/password)
    → POST /login (CTFd Flask Blueprint)
    → Tìm user trong DB (CTFd Users table)
    → Xác thực mật khẩu (CTFd built-in: bcrypt)
    → Kiểm tra user.type != "user" (chặn contestant đăng nhập portal này)
    → Kiểm tra is_admin() | is_challenge_writer() | is_jury()
    → session.regenerate() → login_user(user)
    → Redirect → /admin/challenges
```

#### Chi tiết kỹ thuật

| Thuộc tính | Chi tiết |
| :--- | :--- |
| **Mechanism** | Flask server-side session (Redis-backed `CachingSessionInterface`) |
| **Session Key** | `key_prefix="session"` lưu trên Redis |
| **Password Hashing** | CTFd built-in (bcrypt), quản lý bởi CTFd framework |
| **Role Check** | `user.type` phải là `admin`, `challenge_writer`, hoặc `jury` — `type = "user"` bị chặn |
| **Rate Limiting** | `@ratelimit(method="POST", limit=10, interval=5)` trên route `/login` |
| **Separation** | Route `/register` bị **abort(404)** — không cho phép tự đăng ký; chỉ Admin tạo tài khoản thủ công |
| **OAuth Support** | CTFd có route `/oauth` (MajorLeagueCyber OAuth2), tuy nhiên chưa được cấu hình trong FCTF |
| **Logout** | `logout_user()` → xóa Flask session |

> **Ghi chú Isolation**: CTFd và ContestantBE **dùng chung một Database (`ctfd`) và chung bảng `users`**. Định danh của Admin và Contestant chia sẻ cùng một không gian ID. Việc cách ly (Isolation) được thực hiện ở mức ứng dụng (Application-level) thông qua cột `type`: CTFd chặn những account có `type = "user"`, còn ContestantBE chỉ cho phép `type = "user"` đăng nhập.

---

### 4.1.3 KYPO Login — Keycloak OIDC (CRCZP Realm, Sandbox Challenges)

Đây là cơ chế đăng nhập để **thí sinh truy cập vào môi trường sandbox KYPO** khi bắt đầu challenge loại `sandbox`. Keycloak ở đây thuộc hệ thống KYPO (realm `CRCZP`), **không phải Keycloak của FCTF**.

#### Luồng xác thực (Server-side brokered login)

```
Contestant click "Start Challenge" (loại sandbox)
    → POST /challenge/start (ContestantBE, [Authorize])
    → ContestantBE tra bảng KypoTeamAccounts lấy {KypoUsername, KypoPassword} của team
    → ContestantBE gọi KYPO Keycloak (realm CRCZP):
        POST https://<kypo-host>/keycloak/realms/CRCZP/protocol/openid-connect/token
        body: grant_type=password, client_id=CRCZP-Client, username, password, scope=openid...
    → Nhận { access_token, refresh_token, id_token, session_state, expires_in }
    → ContestantBE gọi KYPO API tạo/nối lại training run (idempotent):
        POST /training/api/v1/training-runs?accessToken={kypo_instance_token}
    → Xây dựng Bridge URL:
        https://<kypo-host>/bridge.html#access_token=...&refresh_token=...&...&redirect_to=/run/{type}/{token}/access
    → Trả về { success, challenge_type: "kypo", challenge_url: bridgeUrl }
    → Frontend mở bridgeUrl trong tab mới → KYPO tự đăng nhập qua fragment token
```

#### Chi tiết kỹ thuật

| Thuộc tính | Chi tiết |
| :--- | :--- |
| **Mechanism** | Keycloak OIDC Resource Owner Password Credentials (ROPC) — brokered bởi ContestantBE |
| **Keycloak Realm** | `CRCZP` (KYPO's Keycloak instance, tách biệt hoàn toàn với FCTF) |
| **Client ID** | `CRCZP-Client` |
| **Credential Storage** | `KypoTeamAccounts` table trong DB: `{TeamId, KypoUserId, KypoUsername, KypoPassword}` |
| **Scope** | `openid email profile offline_access` |
| **TLS** | Self-signed cert của KYPO → ContestantBE dùng `DangerousAcceptAnyServerCertificateValidator` |
| **Token Delivery** | Fragment-based URL (`bridge.html#access_token=...`) — token không đi qua server log |
| **Admin Monitoring** | `KypoApiClient` dùng riêng một Keycloak admin token (realm `CRCZP`) để gọi Progress API, hoàn toàn tách biệt với token của team |
| **Access Count Limit** | FE giới hạn `KYPO_MAX_ACCESSES = 10` lần mở sandbox (lưu `localStorage`) |

#### Mô hình phân quyền KYPO Admin (Server-to-Server)

`KypoApiClient` cũng tự lấy admin token cho KYPO (realm `CRCZP` và realm `master`) để gọi các Progress/User API:

```csharp
// Admin token — KYPO realm CRCZP (để đọc progress)
POST /keycloak/realms/CRCZP/protocol/openid-connect/token
    grant_type=password, client_id={kypo_client_id}
    username={KYPO_ADMIN_USERNAME}, password={KYPO_ADMIN_PASSWORD}

// Admin token — KYPO realm master (để query Keycloak Users API)
POST /keycloak/realms/master/protocol/openid-connect/token
    grant_type=password, client_id=admin-cli
    username={KC_ADMIN_USER}, password={KC_ADMIN_PASS}
```
Token được cache 4 phút (Keycloak token sống ~5 phút), protected bởi `SemaphoreSlim`.

---

### 4.1.4 So sánh tổng thể 3 cơ chế

| Tiêu chí | Contestant Login | Admin Login | KYPO Login |
| :--- | :--- | :--- | :--- |
| **Nền tảng** | ContestantBE (ASP.NET Core) | CTFd (Flask/Python) | KYPO Keycloak (CRCZP) |
| **Cơ chế** | Custom JWT (HMAC-SHA256) | Flask Session (Redis) | OIDC ROPC (brokered) |
| **Identity Store** | MariaDB (FCTF) | MariaDB (CTFd) | Keycloak CRCZP |
| **Token/Session Storage** | `localStorage` (FE) | Server-side Redis session | Fragment URL → KYPO cookie |
| **Password Hash** | bcrypt-sha256 v2 (passlib compat) | CTFd bcrypt | Keycloak (PBKDF2/Argon2) |
| **CAPTCHA** | Cloudflare Turnstile | Không | Không |
| **MFA** | Không | Không | Qua Keycloak config |
| **Session Revocation** | Ngay lập tức (DB token delete) | Session xóa trên Redis | Keycloak session management |
| **Rate Limiting** | Redis IP rate limit | `@ratelimit` Flask decorator | Không (phía FCTF) |
| **Brute Force Protection** | IP rate limit | Flask rate limit | Keycloak Brute Force |

---

## 4.2 Authorization Layer & Multi-Tenancy Isolation

Hệ thống hỗ trợ nhiều cuộc thi đồng thời (Multi-Tenancy) nên yêu cầu cách ly logic nghiêm ngặt.

- **Primary Enforcement**: Service layer — Các logic nghiệp vụ phải luôn trích xuất `teamId` và xác nhận quyền hạn đối với `contest_id` chủ quản (ngăn IDOR chéo giữa các cuộc thi).
- **Controller Role Guard**: Dùng attribute `[Authorize]` trên ASP.NET Core để bắt buộc phải có JWT hợp lệ (do ContestantBE phát hành, xác thực bằng `PRIVATE_KEY`).
- **Rule**: Service must re-validate even if Controller already checked — future API additions may skip Controller guards.
- **Data-Plane Isolation**: Mọi truy vấn DB phải kèm `WHERE contest_id = X`. Redis cache phải dùng prefix theo `contest_id` (VD: `fctf:contest_{contest_id}:...`). K8s namespaces phải có label `fctf/contest-id: {contest_id}`.

---

## 4.3 Password Policy

FCTF **tự quản lý mật khẩu** cho Contestant (không offload cho Keycloak). Policy được enforce tại service layer của ContestantBE.

#### Contestant (ContestantBE — tự quản lý)

| Setting | Value |
| :--- | :--- |
| **Hashing Algorithm** | `bcrypt-sha256 v2` (tương thích passlib Python): HMAC-SHA256 prehash → BCrypt cost=10 |
| **Minimum Length** | 8 ký tự |
| **Maximum Length** | 20 ký tự |
| **Complexity** | Bắt buộc: chữ hoa, chữ thường, số, ký tự đặc biệt (`!@#$%^&*(),.?":{}|<>`) |
| **Change Password** | Endpoint `/auth/change-password` (yêu cầu xác thực old password trước) |
| **2FA / MFA** | Chưa hỗ trợ |

#### Admin (CTFd)

| Setting | Value |
| :--- | :--- |
| **Hashing Algorithm** | CTFd built-in bcrypt |
| **Policy** | Theo cấu hình CTFd (không bắt buộc complexity mặc định) |
| **2FA / MFA** | Chưa cấu hình trong FCTF |

#### KYPO Accounts

| Setting | Value |
| :--- | :--- |
| **Hashing Algorithm** | Do Keycloak CRCZP quản lý (PBKDF2 hoặc Argon2) |
| **Credential Storage** | Mã hóa đối xứng (Symmetric Encryption, VD: AES-256) trong bảng `KypoTeamAccounts` sử dụng khóa bí mật lưu tại Kubernetes Secrets. Backend tự động giải mã khi broker login. |
| **2FA / MFA** | Hỗ trợ qua Keycloak CRCZP config |

---

## 4.4 Account Lockout Policy

FCTF không có cơ chế lockout tập trung. Mỗi thành phần có chính sách riêng:

#### Contestant (ContestantBE)

| Setting | Value |
| :--- | :--- |
| **Account Lockout** | **Không có** — không có cơ chế lockout sau N lần sai mật khẩu |
| **Brute Force Mitigation** | Redis-based IP rate limiting (`AspNetCoreRateLimit`) — giới hạn request theo IP |
| **Failure Message** | Generic: `"Invalid username or password"` (không tiết lộ username/password đúng/sai) |
| **Timing Attack Prevention** | Luôn thực hiện 1 lần `bcrypt.Verify()` dù user không tồn tại (`RunFakeHash`) |
| **Unlock** | Admin ban/unban thủ công qua CTFd Management Platform |

#### Admin (CTFd)

| Setting | Value |
| :--- | :--- |
| **Rate Limit** | `@ratelimit(limit=10, interval=5)` — 10 lần/5 giây per IP |
| **Account Lockout** | Không có lockout tự động (chỉ rate limit) |
| **Unlock** | Admin tự quản lý qua CTFd Admin Console |

#### KYPO (Keycloak CRCZP)

| Setting | Value |
| :--- | :--- |
| **Brute Force Detection** | Keycloak Brute Force Protection (tùy chỉnh realm CRCZP) |
| **Max Attempts** | Tùy chỉnh trên Keycloak (VD: 5 lần) |
| **Lockout Duration** | Tùy chỉnh trên Keycloak (VD: 15 phút) |
| **Unlock** | Qua Keycloak Admin Console của KYPO |

---

## 4.5 Secrets Management

- **Zero Hardcoding**: Tuyệt đối không hardcode credentials trong source code.
- **Môi trường Development**: Dùng file `.env` (được đưa vào `.gitignore`).
- **Môi trường Production (Kubernetes)**: Toàn bộ bí mật được quản lý tập trung và tiêm (inject) qua **Kubernetes Secrets**. Cơ chế xoay vòng mật khẩu (Credential Rotation) cho các thành phần hạ tầng được mô tả chi tiết tại **Mục 4.15.3 và Mục 4.19.5**.

---

## 4.6 OWASP Top 10 Mitigation Checklist

| Risk | Mitigation |
| :--- | :--- |
| **A01 — Broken Access Control** | Auth tại Service layer; Token revocation. **Kiểm soát truy cập mạng qua Zero-Trust NetworkPolicy (Xem 4.13)**. |
| **A02 — Cryptographic Failures** | Contestant: bcrypt-sha256 v2 + HMAC-SHA256 JWT; Admin: CTFd bcrypt. HTTPS enforced (Xem 4.20). |
| **A03 — Injection** | Parameterized queries; **Chống Path Traversal bằng canonicalization và NFS Read-Only (Xem 4.17)**; Dynamic Flag Verification (Xem 4.10). |
| **A05 — Security Misconfiguration** | **Triển khai NSA/CISA K8s Hardening (Xem 4.15)** và **Pod Security Standards (Xem 4.12)**; gVisor sandbox. |
| **A07 — Auth Failures** | Contestant IP rate limit + CAPTCHA; Stateful JWT revocation (tokenUuid). **Bảo vệ CSRF (Xem 4.18)**. |
| **A09 — Logging Failures** | Phân quyền tối thiểu và **ghi log truy cập trái phép Database (Xem 4.19)**; **Centralized Logging với Loki (Xem 4.21)**. |

---

## 4.7 Security Filter Chain Configuration

*(Luồng middleware thực tế của ContestantBE trên ASP.NET Core — trích từ `Program.cs`)*

```csharp
app.UseRouting();
app.UseCors("AllowAll");
app.UseIpRateLimiting();                          // Redis-based rate limiting theo IP
app.UseOutputCache();
app.UseAuthentication();                          // Validate JWT Bearer (HMAC-SHA256, PRIVATE_KEY)
app.UseAuthorization();                           // Enforce [Authorize] attributes
app.UseMiddleware<TokenAuthenticationMiddleware>(); // Kiểm tra tokenUuid DB/cache + user status
app.MapControllers();
```

**Ghi chú**: CTFd (Admin portal) dùng Flask middleware stack riêng (WSGI), không liên quan đến pipeline này.

---

## 4.8 External API Authentication (Challenge Gateway Token)

Cơ chế này quản lý quyền truy cập Data-Plane trực tiếp vào các Sandbox/Challenge đang chạy.

| Setting | Value |
| :--- | :--- |
| **Mechanism** | HMAC-SHA256 Signed Token (phát hành bởi Backend, xác thực bởi Gateway bằng Go) |
| **Key Storage** | `PRIVATE_KEY` lưu trong K8s Secret |
| **Delivery** | Request đầu tiên qua `?fctftoken=X`. Gateway xác thực xong đổi thành `HttpOnly` cookie để giấu token. TCP thì nhập token qua text prompt. |
| **Rate Limiting** | Áp dụng multi-layer rate limiting để bảo vệ Gateway. *(Xem chi tiết cơ chế tại Mục 4.16)* |

---

## 4.10 Dynamic Flag Verification Security

Nhằm khắc phục rủi ro chia sẻ cờ (Static Flags):
1. **Flag Generation:** Deployment Center sinh cờ ngẫu nhiên `FCTF{teamId_randomSecret}` khi tạo instance.
2. **Flag Injection:** Chèn vào Kubernetes Secret thay vì lưu cứng trong image. Pod sẽ đọc cờ từ Secret này.
3. **Verification:** Logic xác thực cờ thực hiện đối chiếu 3 chiều (3-dimensional match): `flag_string == expected` AND `team_id == submitter_team_id` AND `contest_id == active_contest_id`. Điều này đảm bảo cờ động luôn gắn chặt với phiên bản instance hiện tại của đúng team, trong đúng cuộc thi đang diễn ra. Không team nào có cờ giống team nào.

---

## 4.11 Infrastructure Security & Lifecycle Management

Để đối phó với rủi ro cạn kiệt tài nguyên K8s do rác hạ tầng (Ghost Pods):
- **Image Update Safety**: Khi cập nhật challenge, không xóa Redis Cache ngay. Controller gửi lệnh `ForceStop` &rarr; Listener chờ K8s `Deleted` Event &rarr; Atomic delete Redis ZSET. Điều này đảm bảo tính nhất quán (Strict Reconciliation).
- **Contest End Teardown**: Sự kiện kết thúc cuộc thi tự động kích hoạt tiến trình `StopAll` với cơ chế retry bằng Polly (3 lần). Nếu K8s API lỗi, phát alert lên Grafana/Loki. Background worker định kỳ quét mồ côi (Orphan resources) để tự dọn dẹp.

---

## 4.12 Pod Security Standards — Challenge Pod Hardening (NFR-03)

Toàn bộ challenge pod được triển khai theo mức bảo mật **Restricted** của Kubernetes Pod Security Standards (PSS), áp dụng tại cả cấp namespace và cấp container.

### 4.12.1 Namespace-level Enforcement

Mỗi challenge namespace được gán nhãn enforce PSS Restricted ngay khi tạo bởi Argo Workflows:

```yaml
# Trích từ challenge-hardened.yaml
labels:
  pod-security.kubernetes.io/enforce: "restricted"
  pod-security.kubernetes.io/enforce-version: "latest"
  pod-security.kubernetes.io/audit: "restricted"
  pod-security.kubernetes.io/warn: "restricted"
```

Cơ chế này đảm bảo mọi pod deploy vào namespace challenge đều bị từ chối nếu không đáp ứng mức Restricted, ngay cả khi Argo Workflows bị thay thế bởi công cụ khác.

### 4.12.2 Container-level Security Context

| Thuộc tính | Giá trị | Mục đích |
| :--- | :--- | :--- |
| `runAsNonRoot` | `true` | Cấm container chạy với UID 0 |
| `runAsUser` | `1000` | Chạy với unprivileged UID cố định |
| `readOnlyRootFilesystem` | `true` | Chặn ghi vào root filesystem |
| `allowPrivilegeEscalation` | `false` | Chặn leo thang đặc quyền (setuid/setgid) |
| `privileged` | `false` | Không dùng privileged mode |
| `capabilities.drop` | `["ALL"]` | Loại bỏ toàn bộ Linux capabilities |
| `seccompProfile.type` | `RuntimeDefault` | Áp dụng seccomp profile mặc định của container runtime |
| `automountServiceAccountToken` | `false` | Không mount K8s Service Account token vào pod |

### 4.12.3 Hai Template Deployment

Hệ thống duy trì hai template cho challenge pod:

| Template | PSS Level | gVisor | Khi dùng |
| :--- | :--- | :--- | :--- |
| `challenge-hardened.yaml` | **Restricted** (đầy đủ) | Tùy chọn (`${RUNTIME_CLASS_NAME_LINE}`) | Challenge tiêu chuẩn — áp dụng mặc định |
| `challenge-plain.yaml` | NetworkPolicy đầy đủ, PSS label không có | Tùy chọn | Challenge có yêu cầu đặc biệt (ví dụ: cần write filesystem) |

> **Lưu ý bảo mật**: Template `challenge-plain.yaml` vẫn giữ nguyên NetworkPolicy (deny-all ingress, allow-gateway-ingress, strict-egress) nhưng không áp dụng container-level Restricted PSS. Mỗi challenge cần đánh giá rủi ro trước khi dùng plain template.

### 4.12.4 gVisor Runtime Isolation (Kernel-level)

Hệ thống triển khai **gVisor** (`handler: runsc`) như một lớp bảo vệ bổ sung ở cấp kernel:

```yaml
# runtime-class.yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

gVisor intercept các syscall từ container và thực thi chúng trong userspace sandbox, ngăn chặn container escape thông qua kernel vulnerabilities của host.

### 4.12.5 Không gian lưu trữ tạm

Do `readOnlyRootFilesystem: true`, các process cần ghi tạm phải dùng `emptyDir` với `medium: Memory` (RAM disk), không được ghi vào persistent storage:

```yaml
volumes:
  - name: tmp
    emptyDir:
      medium: Memory
```

---

## 4.13 Network Isolation — Zero-Trust NetworkPolicy (NFR-04)

Hệ thống áp dụng mô hình Zero-Trust cho toàn bộ lưu lượng mạng: **Default Deny-All**, chỉ mở các luồng được định nghĩa tường minh.

### 4.13.1 Challenge Namespace — Mô hình NetworkPolicy

Mỗi challenge namespace nhận 4 NetworkPolicy khi được tạo:

#### `deny-all-ingress` — Mặc định chặn toàn bộ Ingress

```yaml
spec:
  podSelector: {}        # Áp dụng cho TẤT CẢ pod trong namespace
  policyTypes:
    - Ingress            # Chặn toàn bộ ingress (không có rule = deny-all)
```

#### `allow-gateway-ingress` — Chỉ cho phép từ Challenge Gateway

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: app   # Namespace chứa Gateway
        podSelector:
          matchLabels:
            app: challenge-gateway             # Chỉ pod Gateway
    ports:
      - protocol: TCP
        port: ${CONTAINER_PORT}
```

#### `strict-egress` — Kiểm soát chặt Egress

```yaml
egress:
  # DNS (toàn bộ)
  - to: [{ ipBlock: { cidr: 0.0.0.0/0 } }]
    ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]

  # Chỉ Gateway (giao tiếp ngược lại)
  - to:
      - namespaceSelector: { app: namespace: app }
        podSelector: { app: challenge-gateway }

  # Internet public (KHÔNG bao gồm private ranges)
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except:
            - 10.0.0.0/8        # Cluster internal
            - 172.16.0.0/12     # Docker/K8s internal
            - 192.168.0.0/16    # LAN/Node network
            - 169.254.0.0/16    # Link-local
```

> **Kết quả**: Challenge pod **không thể** truy cập Database, NFS, Redis, RabbitMQ hoặc bất kỳ service cluster nào. Lateral movement giữa các challenge namespace bị chặn hoàn toàn.

### 4.13.2 App Namespace — NetworkPolicy cho Service Pods

Mỗi service trong namespace `app` có NetworkPolicy riêng theo whitelist tối thiểu:

| Service | Ingress cho phép | Egress cho phép |
| :--- | :--- | :--- |
| **ContestantBE** | Port 5010 (từ Ingress NGINX) | Redis:6379, MariaDB:3306, DeploymentCenter:5020, HTTPS:443, DNS:53 |
| **AdminMVC (CTFd)** | Port 8000 (từ Ingress NGINX) | Redis:6379, MariaDB:3306, DeploymentCenter:5020, HTTPS:443, DNS:53 |
| **ChallengeGateway** | Port 8080, 1337 | Challenge namespaces (label `ctf/kind: challenge`), Redis:6379, DNS:53 |

---

## 4.14 Port Exposure Control — Kiểm soát cổng dịch vụ (NFR-05)

### 4.14.1 Challenge Pod — ClusterIP Only

Tất cả challenge Service đều dùng type `ClusterIP`, **không được expose** ra ngoài cluster:

```yaml
# challenge-hardened.yaml / challenge-plain.yaml
spec:
  type: ClusterIP   # Không có NodePort, không có LoadBalancer
  ports:
    - name: tcp-challenge
      protocol: TCP
      port: 3333
      targetPort: ${CONTAINER_PORT}
```

### 4.14.2 Challenge Gateway — Điểm Kiểm Soát Tập Trung

Challenge Gateway là **điểm duy nhất** tiếp nhận traffic từ bên ngoài, được expose qua NodePort:

| Protocol | NodePort | Mục đích |
| :--- | :--- | :--- |
| HTTP/TLS | 30038 (→ container 8080) | HTTP challenge |
| TCP | 30037 (→ container 1337) | TCP/netcat challenge |

Mọi kết nối qua Gateway đều phải vượt qua:
1. **Token Verification**: HMAC-SHA256 signed token (phát hành bởi ContestantBE)
2. **Rate Limiting**: Per-token và per-IP (xem Mục 4.16)
3. **Body Size Limit**: Mặc định 10MB (`HTTP_MAX_BODY_BYTES`)
4. **Logging**: Ghi nhận đầy đủ `team_id`, `challenge_id`, namespace, method, status

### 4.14.3 Luồng truy cập từ người chơi

```
Người chơi
  → Nginx Ingress (HTTPS termination)
  → Challenge Gateway NodePort :30038 / :30037
      ├── Xác thực HMAC-SHA256 token
      ├── Rate limit check (token + IP)
      ├── Set HttpOnly cookie (ẩn token khỏi URL)
      └── Proxy → Challenge ClusterIP (internal only)
```

---

## 4.15 Kubernetes Infrastructure Hardening — NSA/CISA Framework (NFR-06)

Hệ thống FCTF triển khai các biện pháp hardening theo khung Kubernetes Hardening do NSA/CISA ban hành. Dưới đây là các nhóm kiểm soát đã được áp dụng:

### 4.15.1 Pod Security

| Kiểm soát NSA/CISA | Triển khai FCTF |
| :--- | :--- |
| Non-root containers | `runAsNonRoot: true`, `runAsUser: 1000/1101/1102` |
| Read-only root filesystem | `readOnlyRootFilesystem: true` trên tất cả pods |
| Drop all capabilities | `capabilities.drop: [ALL]` (challenge pods) hoặc `[NET_RAW]` (app pods) |
| Disable privilege escalation | `allowPrivilegeEscalation: false` |
| Seccomp profile | `seccompProfile.type: RuntimeDefault` |
| Disallow privileged pods | `privileged: false` |
| Service account token | `automountServiceAccountToken: false` trên challenge pods |

### 4.15.2 Network Security

| Kiểm soát NSA/CISA | Triển khai FCTF |
| :--- | :--- |
| Use NetworkPolicy | Tất cả namespaces có NetworkPolicy (Mục 4.13) |
| Namespace isolation | Challenge mỗi team/instance trong namespace riêng |
| Minimize ingress/egress | Default Deny-All + whitelist tối thiểu |

### 4.15.3 Authentication & Secrets

| Kiểm soát NSA/CISA | Triển khai FCTF |
| :--- | :--- |
| Secrets không hardcode | Lưu trong K8s Secrets, inject qua `secretRef` |
| Credential rotation | `rotate-service-passwords.sh` — rotate Redis, MariaDB, RabbitMQ, Harbor, PRIVATE_KEY |
| Least-privilege RBAC | Service accounts riêng biệt theo service |

### 4.15.4 Runtime Security — gVisor Sandbox

gVisor cung cấp kernel isolation layer bổ sung, phòng chống:
- **Container escape** qua kernel exploits
- **Syscall abuse** — gVisor intercept và kiểm soát syscall trong userspace
- **Host kernel attacks** — process trong container không tương tác trực tiếp với host kernel

### 4.15.5 Workload Prioritization & Resource Isolation

```yaml
# priority-classes.yaml
# App services: preemptible but prioritized
priorityClassName: app-normal-preemption

# Challenge pods: low priority, non-preempting
priorityClassName: batch-low
preemptionPolicy: Never
```

Resource limits bắt buộc trên mọi challenge pod (`MEMORY_REQUEST`, `MEMORY_LIMIT`, `CPU_REQUEST`, `CPU_LIMIT` qua Argo Workflows parameters).

---

## 4.16 Multi-Layer Rate Limiting (NFR-07)

Hệ thống triển khai rate limiting tại **3 tầng độc lập** để bảo vệ chống DoS và lạm dụng tài nguyên:

### 4.16.1 Tầng 1 — Nginx Ingress (Edge)

Nginx Ingress Controller là điểm đầu tiên xử lý traffic từ Internet. Rate limiting theo IP được cấu hình tại tầng này như một lớp bảo vệ sớm nhất.

### 4.16.2 Tầng 2 — Challenge Gateway (Go)

Gateway áp dụng rate limiting Redis-based cho cả HTTP và TCP, với ngưỡng cấu hình qua biến môi trường:

#### HTTP Rate Limiting

| Tham số | Env Var | Giá trị mặc định | Đơn vị |
| :--- | :--- | :--- | :--- |
| Rate per token | `HTTP_RATE` | 300 | req/s |
| Burst per token | `HTTP_BURST` | 600 | requests |
| Rate per IP | `HTTP_IP_RATE` | 500 | req/s |
| Burst per IP | `HTTP_IP_BURST` | 1000 | requests |
| Max body size | `HTTP_MAX_BODY_BYTES` | 10MB | bytes |

#### TCP Connection Limiting

| Tham số | Env Var | Giá trị mặc định |
| :--- | :--- | :--- |
| Max connections global | `TCP_MAX_CONNS` | 4000 |
| Max connections per IP | `TCP_MAX_CONNS_PER_IP` | 1000 |
| Max connections per token | `TCP_MAX_CONNS_PER_TOKEN` | 15 |
| Auth timeout | `TCP_AUTH_TIMEOUT_SECONDS` | 5s |

Rate limiting Gateway sử dụng **Redis** làm backend phân tán để đảm bảo nhất quán khi Gateway scale ra nhiều replicas (hiện tại 2 replicas).

#### Middleware pipeline (HTTP Gateway)

```go
mux.Handle("/",
    loggingMiddleware(
        rateLimitMiddleware(limiters,          // Per-IP rate limit (tầng đầu)
            bodySizeLimitMiddleware(cfg.HTTPMaxBodyBytes,
                httpGatewayHandler(...)))))    // Per-token rate limit (trong handler)
```

### 4.16.3 Tầng 3 — ContestantBE (ASP.NET Core)

ContestantBE dùng thư viện `AspNetCoreRateLimit` với Redis backend:

```csharp
app.UseIpRateLimiting();   // Redis-based, cấu hình qua appsettings / env vars
```

Rate limiting áp dụng theo IP cho tất cả endpoint, bảo vệ API backend khỏi request flood kể cả từ traffic đã vượt qua Nginx.

### 4.16.4 Tầng 4 — CTFd Admin (Flask)

```python
@ratelimit(method="POST", limit=10, interval=5)
# Route /login: tối đa 10 lần POST trong 5 giây per IP
```

### 4.16.5 Điều chỉnh ngưỡng theo quy mô cuộc thi

Tất cả ngưỡng rate limit đều được cấu hình qua biến môi trường, cho phép điều chỉnh linh hoạt theo:
- Số lượng thí sinh đăng ký
- Năng lực hạ tầng hiện tại
- Loại challenge (CPU/network intensive)

---

## 4.17 Secure File Access & Path Traversal Prevention (NFR-08)

### 4.17.1 Application-level Validation

`FileService.cs` tại ContestantBE thực hiện canonicalization và boundary check trước khi đọc file:

```csharp
// Bước 1: Canonicalize — resolve ../  và absolute path
var fullPath = Path.GetFullPath(Path.Combine(_nfsMountPath, path));

// Bước 2: Boundary check — fullPath phải nằm trong _nfsMountPath
if (!fullPath.StartsWith(_nfsMountPath, StringComparison.OrdinalIgnoreCase))
    return new FileResult { Success = false, Message = "Invalid file path" };
```

`Path.GetFullPath()` chuẩn hóa mọi dạng path traversal: `../`, `%2e%2e%2f`, absolute path, path có ký tự null, v.v. Boundary check sau đó đảm bảo resolved path không thoát khỏi thư mục được cấp quyền.

### 4.17.2 Token Validation Trước Khi Truy Cập File

Người dùng chỉ được tải file khi:
1. Có token hợp lệ trong request
2. Đường dẫn yêu cầu khớp với bản ghi trong database (`ctfd.files` table)
3. Nếu challenge có prerequisite: team đã giải đủ các challenge điều kiện

### 4.17.3 Infrastructure-level Isolation — Read-Only Mount

ContestantBE chỉ mount đúng subdirectory `/file` (không mount NFS root) với chế độ **read-only**:

```yaml
# contestant-be/deployment.yaml
volumeMounts:
  - name: nfs-shared-data
    mountPath: /mnt/nfs/data/file
    readOnly: true            # OS-level read-only — không thể ghi ngay cả khi app bị compromise
```

### 4.17.4 NFS ACL per Service UID

`nfs-setup.sh` cấu hình ACL chi tiết theo UID trên NFS server:

| Service | UID | Quyền trên `/file` | Quyền trên `/challenges` |
| :--- | :--- | :--- | :--- |
| admin-mvc (CTFd) | 1101 | `rwx` | `rwx` |
| contestant-be | 1102 | `rx` (read-only) | — |
| up-challenge-workflow | 1103 | — | `rx` |
| start-chal-workflow | 1104 | — (chỉ `/start-challenge`) | — |
| filebrowser | 1105 | `rwx` | `rwx` |

Cơ chế này đảm bảo contestant-be không thể ghi dữ liệu lên NFS ngay cả khi:
- Logic ứng dụng xảy ra lỗi
- Container bị compromise
- Mount option `readOnly` bị bypass theo cách nào đó

---

## 4.18 CSRF Protection (NFR-09)

Hệ thống FCTF gồm nhiều thành phần với cơ chế CSRF protection khác nhau tùy theo cơ chế xác thực:

### 4.18.1 Admin Portal — CTFd (Flask)

CTFd triển khai CSRF protection dựa trên **nonce per session**:

```python
# CTFd/forms/__init__.py
class CTFdCSRF(CSRF):
    def generate_csrf_token(self, csrf_token_field):
        ...

class BaseForm(Form):
    class Meta:
        csrf = True
        csrf_class = CTFdCSRF
        csrf_field_name = "nonce"
```

Mỗi request POST phải kèm nonce hợp lệ khớp với session:

```python
# CTFd/utils/initialization/__init__.py
if session["nonce"] != request.headers.get("CSRF-Token"):
    abort(403)
```

> **Ghi chú**: Một số route admin dùng `@bypass_csrf_protection` decorator — áp dụng cho các endpoint nội bộ được gọi bởi system (ví dụ: `/api/rewards/`, `/challenge/start`). Các endpoint này vẫn yêu cầu session hợp lệ.

### 4.18.2 ContestantBE — JWT Bearer (CSRF ít áp dụng)

ContestantBE dùng JWT Bearer Token lưu trong `localStorage`, không dùng cookie. Cơ chế này **không bị tấn công CSRF truyền thống** vì:
- JWT trong `localStorage` không tự động đính kèm vào cross-origin request như cookie
- Mọi request API phải có `Authorization: Bearer <token>` header — browser không tự động thêm header này

### 4.18.3 Challenge Gateway — HttpOnly Cookie + SameSite

Sau khi xác thực token lần đầu (qua URL query param), Gateway chuyển token sang HttpOnly cookie:

```go
http.SetCookie(w, &http.Cookie{
    Name:     "FCTF_Auth_Token",
    Value:    tok,
    HttpOnly: true,      // Không thể đọc qua JavaScript
    SameSite: http.SameSiteLaxMode,  // Chặn cross-site POST từ third-party
    Secure:   r.TLS != nil,          // Chỉ gửi qua HTTPS khi TLS active
    MaxAge:   maxAge,
})
```

`SameSite=Lax` ngăn cookie được gửi khi request xuất phát từ cross-site context (bao gồm form POST từ trang khác), giảm thiểu rủi ro CSRF cho challenge session.

---

## 4.19 Least Privilege — Database, Cache & Storage (NFR-19)

Hệ thống áp dụng nguyên tắc phân quyền tối thiểu (Least Privilege) toàn diện ở cả tầng ứng dụng, database, cache và lưu trữ.

### 4.19.1 Tầng Mạng — Default Deny-All

*(Xem chi tiết tại Mục 4.13)*

Tất cả namespace đều có NetworkPolicy Default Deny-All. Chỉ các luồng kết nối cần thiết cho nghiệp vụ mới được mở tường minh.

### 4.19.2 MariaDB — Per-Service Accounts với GRANT tối thiểu

File `least-privilege-service-accounts.sql` tạo 4 tài khoản DB riêng biệt, mỗi tài khoản chỉ được GRANT đúng operation cần thiết trên đúng bảng liên quan:

```sql
-- Xóa anonymous user và test database (hardening baseline)
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP DATABASE IF EXISTS test;

-- Tài khoản riêng per service
CREATE USER 'contestant_be'@'%'       IDENTIFIED BY '...';
CREATE USER 'deployment_center'@'%'   IDENTIFIED BY '...';
CREATE USER 'deployment_listener'@'%' IDENTIFIED BY '...';
CREATE USER 'deployment_consumer'@'%' IDENTIFIED BY '...';
```

Ví dụ phân quyền `contestant_be` — chỉ SELECT/INSERT/UPDATE trên các bảng liên quan, **không có ALL PRIVILEGES**:

```sql
GRANT SELECT, INSERT, UPDATE ON ctfd.users    TO 'contestant_be'@'%';
GRANT SELECT                  ON ctfd.teams   TO 'contestant_be'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ctfd.tokens TO 'contestant_be'@'%';
-- ... (per-table, per-operation)
```

| Service | Bảng được cấp quyền | Quyền tối đa |
| :--- | :--- | :--- |
| `contestant_be` | users, teams, challenges, submissions, tokens, ... | SELECT/INSERT/UPDATE/DELETE per-table |
| `deployment_center` | challenges, deploy_histories, challenge_start_tracking | SELECT/INSERT/UPDATE |
| `deployment_listener` | challenge_start_tracking, challenges | SELECT/INSERT/UPDATE |
| `deployment_consumer` | challenges | SELECT only |

> **Audit Logging cho các thao tác bị từ chối**: Để đáp ứng yêu cầu giám sát, mọi thao tác truy cập cơ sở dữ liệu vi phạm phân quyền (bị MariaDB từ chối) sẽ trigger exception tại tầng ứng dụng (Service layer). Các exception truy cập trái phép này bắt buộc phải được catch và ghi log tập trung để phục vụ công tác auditing. Trên môi trường production, có thể kích hoạt thêm MariaDB Audit Plugin ở tầng DB để đối chiếu.

### 4.19.3 Redis — Per-Service Credentials

Mỗi service sử dụng `REDIS_USERNAME` và `REDIS_PASSWORD` riêng, inject qua K8s Secret. Key prefix được cấu hình tách biệt theo service:

| Service | Redis Key Prefix |
| :--- | :--- |
| Challenge Gateway | `fctf:gateway:...` |
| ContestantBE | `fctf:contestant:...` (rate limit, auth cache) |
| CTFd Admin | `session:...` (Flask session) |

### 4.19.4 NFS — ACL per Service UID & Read-Only Mount

*(Xem chi tiết tại Mục 4.17.4)*

NFS cấu hình ACL theo UID trên NFS server, đảm bảo mỗi service chỉ có quyền đúng với vai trò. contestant-be chỉ có `rx` trên subdirectory `/file`, mount với `readOnly: true` ở phía K8s.

### 4.19.5 Credential Rotation

Script `rotate-service-passwords.sh` tự động hóa việc xoay vòng credentials cho tất cả thành phần:

1. **Redis**: Rotate ACL users + default password
2. **MariaDB**: `ALTER USER` + cập nhật K8s Secret + rollout restart
3. **RabbitMQ**: Rotate producer/consumer password
4. **Harbor**: Rotate registry credentials
5. **PRIVATE_KEY / SECRET_KEY**: Rotate signing keys trong namespace `app`

---

## 4.20 Transport Security & Data in Transit

Hệ thống phân tách rõ ràng cơ chế bảo mật đường truyền (Transport Security) giữa lưu lượng bên ngoài (External Traffic) và giao tiếp nội bộ (Internal Traffic).

### 4.20.1 External Traffic (Mạng ngoài vào Cluster)
Tất cả lưu lượng từ người dùng (Internet) vào hệ thống bắt buộc phải được mã hóa bằng **HTTPS/TLS**.
- **TLS Termination**: Quá trình giải mã SSL/TLS được thực hiện tại **NGINX Ingress Controller**. 
- Ingress cấu hình dùng chứng chỉ SSL hợp lệ (quản lý qua cert-manager) cho các tên miền của ContestantBE, CTFd Admin, và Challenge Gateway.
- Mọi kết nối HTTP (port 80) đều bị force redirect sang HTTPS (port 443).

### 4.20.2 Internal Traffic (Giao tiếp giữa các Pod trong Cluster)
Sau khi vượt qua Ingress, giao tiếp nội bộ giữa các microservices chủ yếu sử dụng **Plaintext HTTP/TCP** để giảm tải CPU overhead (do không cần mã hóa/giải mã liên tục) và thuận tiện cho việc gỡ lỗi. Cụ thể:
- **Plaintext (HTTP)**: ContestantBE gọi DeploymentCenter (port 5020), DeploymentCenter gọi Argo Workflows (port 2746), Challenge Gateway proxy tới Challenge Pods (port 8080/1337), và các services đẩy log về Loki (port 3100).
- **Encrypted (TLS)**: Một số luồng nhạy cảm có hỗ trợ/bắt buộc mã hóa nội bộ, ví dụ kết nối tới **RabbitMQ** (`RABBIT_TLS="true"`, port 5671).

> **Giải trình rủi ro (Risk Acceptance & Mitigation)**: 
> Việc dùng plaintext HTTP nội bộ trong cụm K8s mang rủi ro bị nghe lén (sniffing) nếu kẻ tấn công thâm nhập được vào một pod. Tuy nhiên, rủi ro này đã được triệt tiêu (mitigated) hoàn toàn nhờ **Zero-Trust NetworkPolicy** (Mục 4.13). Kẻ tấn công trong một Challenge Pod không thể gửi gói tin hoặc nghe lén (arp spoofing/promiscuous mode) traffic của các service thuộc namespace `app` do K8s CNI sẽ drop gói tin từ gốc. Do đó, thiết kế plaintext internal kết hợp NetworkPolicy là an toàn và tối ưu hiệu suất.

---

## 4.21 Security Auditing & Centralized Logging

Hệ thống triển khai cơ chế ghi vết tập trung, đảm bảo tính **chống chối bỏ (Non-repudiation)** và phục vụ công tác điều tra sự cố (Forensic).

### 4.21.1 Centralized Logging Stack
Sử dụng **Loki - Promtail - Prometheus - Grafana** (cài đặt qua Helm chart trong namespace `monitoring`).
- **Promtail**: Chạy dưới dạng DaemonSet, thu thập toàn bộ `stdout/stderr` từ tất cả các pod trên mọi node.
- **Loki**: Hệ thống lưu trữ log tối ưu, lập chỉ mục theo labels (tương tự Prometheus) thay vì full-text, giúp tìm kiếm cực nhanh (ví dụ: `namespace="app", container="challenge-gateway"`).

### 4.21.2 Các thành phần Audit Log chính

| Loại Log | Vị trí thu thập | Nội dung Audit |
| :--- | :--- | :--- |
| **Gateway Access Log** | Challenge Gateway (`stdout`) | Mọi lượt truy cập vào Challenge. Ghi nhận `team_id`, `challenge_id`, `namespace`, IP, timestamp, và HTTP method/TCP status. |
| **App Audit Log** | ContestantBE / CTFd | Các sự kiện quan trọng (login success/fail, submit flag, đổi mật khẩu). Có gắn `user_id` và IP. |
| **DB Access Denied** | Tầng Service (Catch Exception) | Các truy cập bị từ chối do vi phạm Least Privilege. Ghi nhận query, thời gian, và service account thực hiện (Mục 4.19.2). |
| **Infra Lifecycle** | DeploymentCenter / Argo | Ghi nhận chi tiết luồng cấp phát Pod (Start) và quá trình dọn dẹp hạ tầng (StopAll/Graceful Teardown). |

Mọi log nhạy cảm (như mật khẩu, token thật) đều phải được "che đi" (masking) hoặc không log ra stdout trước khi đẩy về Loki.
