---
title: FCTF Real Feature Systematization
description: Inventory of actually implemented features across FCTF modules based on source-code review.
---

# FCTF Real Feature Systematization

## 1. Muc tieu

Tai lieu nay gom he thong hoa cac tinh nang **da co dau vet trien khai trong source code** cua du an FCTF.

Tai lieu uu tien:

- Tinh nang dang chay thuc te (co route, service, flow ro rang).
- Moi lien ket giua cac module (Contestant Portal, Contestant Service, Deployment Center, Deployment Consumer, Deployment Listener, Challenge Gateway, CTFd core).
- Quy tac nghiep vu va config key anh huong hanh vi he thong.

Tai lieu khong nham thay the tai lieu marketing/roadmap.

## 2. Pham vi review

Khao sat duoc thuc hien tren cac khoi sau:

- Contestant Portal frontend: `ContestantPortal/src/*`
- Contestant Service API va nghiep vu: `ControlCenterAndChallengeHostingServer/ContestantBE/*`
- Deployment Center orchestration API: `ControlCenterAndChallengeHostingServer/DeploymentCenter/*`
- Deploy worker va watcher:
  - Deployment Consumer: `ControlCenterAndChallengeHostingServer/DeploymentConsumer/*`
  - Deployment Listener: `ControlCenterAndChallengeHostingServer/DeploymentListener/*`
- Shared domain/service utilities: `ControlCenterAndChallengeHostingServer/ResourceShared/*`
- Challenge Gateway truy cap challenge: `ChallengeGateway/*`
- Quan tri CTFd da tuy bien: `FCTF-ManagementPlatform/CTFd/*`
- Testing va van hanh:
  - `Test/*`
  - `FCTF-k3s-manifest/*`
  - `manage.sh`
  - `database-migration/*`

## 3. Ban do module

| Module                                | Vai tro                                                             | Dau vao / Dau ra chinh                                                   |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| FCTF-ManagementPlatform (CTFd custom) | Backoffice/quan tri su kien, challenge metadata, config competition | Luu DB challenge/config; cung cap nen tang quan tri                      |
| Contestant Portal                     | Giao dien thi cho contestant                                        | Goi Contestant Service API, hien thi challenge/score/ticket/profile/log  |
| Contestant Service                    | API cho contestant va logic nghiep vu chinh                         | Xac thuc, challenge flow, submit, hint, ticket, scoreboard, file         |
| Deployment Center                     | API dieu phoi deploy/start/stop challenge runtime                   | Nhan request tu Contestant Service; day queue RabbitMQ; thao tac Argo/K8s/Loki |
| Deployment Consumer                   | Worker xu ly queue deploy                                           | Dequeue, tao workflow Argo, cap nhat Redis state                         |
| Deployment Listener                   | Watcher pod/workflow state                                          | Theo doi pod K8s, cap nhat stop/start lifecycle, cleanup ghost/orphan    |
| Challenge Gateway                     | Cua vao challenge runtime (HTTP/TCP)                                | Verify token, reverse proxy, rate limit, connection control              |
| ResourceShared                        | Utility dung chung                                                  | Redis scripts, token/signature helper, K8s service, dynamic score logic  |
| Test suite                            | Xac thuc tinh dung va tai/dua tranh chap                            | Race/Gateway/Stress scenarios                                            |
| K3s manifest + scripts                | Trien khai va van hanh                                              | Setup cluster, NFS, Helm, app deployment, uninstall                      |

## 4. Luong nghiep vu quan trong da trien khai

### 4.1 Dang nhap va phien thi

1. Contestant dang nhap qua `POST /auth/login-contestant`.
2. Backend kiem tra user `verified`, `hidden/banned`, `team banned`, team ton tai.
3. Token JWT duoc phat hanh kem `tokenUuid` (UUID moi moi lan login).
4. Middleware xac thuc moi request so voi token UUID trong DB/Redis cache (`auth:user:{id}`).

Y nghia:

- Co co che invalidation token theo session UUID (khong chi kiem tra chu ky JWT).

### 4.2 Truy cap challenge va pre-requisite

1. Portal lay danh sach topic/challenge tu `challenge/by-topic` va `challenge/list_challenge/{category}`.
2. Challenge co requirements (prerequisites + anonymize).
3. Neu chua dat prerequisite:
   - Co the bi an hoan toan.
   - Hoac hien anonymized (ten/chi tiet an) tuy theo `anonymize`.
4. Endpoint chi doc duoc mo rong cho after-CTF khi `view_after_ctf=true` (filter `DuringCtfTimeAndAfterOnly`).

### 4.3 Start challenge runtime (require_deploy)

1. Contestant start qua `POST /challenge/start`.
2. He thong check:
   - captain-only start (config),
   - prerequisites,
   - max attempts,
   - max deploy count,
   - da solve hay chua,
   - limit concurrent challenge per team (`limit_challenges`).
3. Redis script atomic dat cho + ZSET reservation de tranh race va qua gioi han.
4. Contestant Service goi Deployment Center voi `SecretKey` ky tu payload + unixTime.
5. Deployment Center enqueue RabbitMQ (`deployment_exchange` -> `deployment_queue`).
6. Deployment Consumer lay queue, submit Argo workflow, cap nhat cache status PENDING.
7. Deployment Listener watch pod; khi ready, tao challenge token URL, cap TTL, ghi tracking start.
8. Frontend poll `challenge/check-status` de nhan URL truy cap runtime.

### 4.4 Stop challenge runtime

- User stop qua `POST /challenge/stop-by-user`.
- Deployment Center dat trang thai DELETING, xoa namespace K8s.
- Listener nhan Deleted/terminating event, remove ZSET/cache, update `StoppedAt` tracking.
- Auto-stop cung duoc kich hoat khi het thoi gian challenge (frontend timer + backend logic khi can).

### 4.5 Submit flag va bao ve race/abuse

Flow `POST /challenge/attempt` da co:

- Validate submission rong/do dai.
- captain-only submit (config).
- Cooldown theo challenge-team bang Redis Lua script.
- Pre-check already solved + max attempts.
- Attempt flag (static/regex compare).
- Protect race condition:
  - Check solve truoc va sau critical section.
  - Bat duplicate-key khi ghi solve.
- KPM rate limit cho submit sai (Redis INCR theo minute).
- Max-attempt atomic counter bang Redis Lua.
- Dynamic challenge recalculation co distributed lock.
- Auto stop runtime neu solve dung hoac het so lan thu (voi challenge deploy).

### 4.6 Hint unlock economy

Flow `POST /hint/unlock` da co:

- Challenge-level prerequisite check.
- Hint-level prerequisite check.
- Distributed lock theo team/user de tranh unlock race.
- Kiem tra diem, tao unlock record + award diem am (chi phi hint).
- Khong cho unlock neu challenge hidden/da solve.

### 4.7 Ticket va action logs

- Ticket:
  - Tao/list/xem/xoa cho user.
  - So sanh similarity de chan spam ticket trung noi dung.
  - Chi owner moi xem/xoa, khong cho xoa ticket da duoc reply/closed.
- Action logs:
  - Luu event start challenge, submit dung/sai, unlock hint.
  - Contestant xem log theo team.

### 4.8 Scoreboard

- Modes theo config `score_visibility`:
  - `public`: ai cung xem duoc.
  - `private`: phai login.
  - `hidden`: tra 403.
- `bracket_view_other` quyet dinh user private co duoc xem bracket khac hay khong.
- `freeze` duoc ap dung khi tinh score/solves.
- Portal co scoreboard private (sau login) va public scoreboard page.

### 4.9 File challenge access control

Flow `GET /files?path=...&token=...` da co:

- Verify signed token (`ItsDangerous`) + user_id + file_id.
- Chan path traversal (yeu cau `file/` + fullPath phai nam trong NFS mount).
- Check challenge state hidden.
- Check prerequisite solve cho challenge file.

### 4.10 Gateway truy cap challenge runtime

HTTP gateway:

- Nhan token qua query `fctftoken`, verify HMAC, set cookie `FCTF_Auth_Token`.
- Redirect URL da remove token.
- Reverse proxy ve host route trong token payload.
- Rate limit theo token+IP va theo IP (Redis).
- Body size limit, no-store headers cho HTML.

TCP gateway:

- Auth token theo session dau vao.
- Gioi han ket noi: global, theo IP, theo token.
- Auto close session khi token het han.
- Logging metadata team/challenge trich tu route.

## 5. Ma tran tinh nang theo mien

### 5.1 Contestant experience

| Nhom             | Tinh nang                                                              | Trang thai  |
| ---------------- | ---------------------------------------------------------------------- | ----------- |
| Auth             | Login/logout/change password, role/user checks, team membership gate   | Implemented |
| Challenge browse | Topic list, category list, detail, prerequisites/anonymize behavior    | Implemented |
| Runtime          | Start/stop/check status, active instance list, shared instance support | Implemented |
| Submission       | Correct/incorrect/already_solved/ratelimited/paused handling           | Implemented |
| Hints            | View hints, unlock paid hints, prerequisite + score checks             | Implemented |
| Files            | Secure challenge file download with signed token and ACL               | Implemented |
| Scoreboard       | Private/public views, bracket filter, freeze banner                    | Implemented |
| Tickets          | Create/list/detail/delete with ownership constraints                   | Implemented |
| Profile          | Team rank, score breakdown, member scores, password policy UX          | Implemented |
| Team activities  | Action log viewer with filter/search/pagination                        | Implemented |

### 5.2 Organizer/admin platform (CTFd custom)

| Nhom                 | Tinh nang                                                                                                               | Trang thai  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| Challenge model      | require_deploy, cpu/memory, gVisor, harden_container, max_deploy_count, shared_instant, connection_protocol, difficulty | Implemented |
| Config general       | captain_only_start_challenge, captain_only_submit_challenge, limit_challenges, incorrect_submissions_per_min            | Implemented |
| Config visibility    | score_visibility, bracket_view_other, challenge_difficulty_visibility                                                   | Implemented |
| Requirements UI      | Prerequisites + anonymize behavior                                                                                      | Implemented |
| Challenge versioning | challenge_versions table + version metadata                                                                             | Implemented |

### 5.3 Deployment and runtime orchestration

| Nhom                   | Tinh nang                                                          | Trang thai  |
| ---------------------- | ------------------------------------------------------------------ | ----------- |
| Queue-based deploy     | RabbitMQ producer/consumer with TTL and ack/nack                   | Implemented |
| Workflow orchestration | Argo submit, workflow status, deployment logs                      | Implemented |
| Pod lifecycle watcher  | Sharded watcher, reconnect/resync, orphan reconcile, ghost cleanup | Implemented |
| Namespace ops          | Stop single/all challenge namespace                                | Implemented |
| Request observability  | Pod logs + Loki request logs API                                   | Implemented |

### 5.4 Reliability/security controls

| Nhom               | Control                                                                     | Trang thai  |
| ------------------ | --------------------------------------------------------------------------- | ----------- |
| Auth integrity     | tokenUuid check + Redis cached auth state                                   | Implemented |
| Time gate          | DuringCtfTimeOnly / DuringCtfTimeAndAfterOnly filters                       | Implemented |
| Rate limit         | IP rate limit (ASP.NET), submission cooldown, KPM, max attempts (Redis Lua) | Implemented |
| Concurrency safety | Distributed locks (stop challenge, dynamic recalc, hint unlock)             | Implemented |
| Runtime quota      | Concurrent deployment limit per team via Redis ZSET                         | Implemented |
| File security      | Signed token + path guard + prerequisite check                              | Implemented |

## 6. Config keys quan trong can quan tri

Danh sach key tac dong truc tiep hanh vi nghiep vu (khong day du tuyet doi):

- `start`, `end`, `freeze`, `view_after_ctf`, `paused`
- `user_mode`
- `score_visibility`, `bracket_view_other`
- `captain_only_start_challenge`, `captain_only_submit_challenge`
- `limit_challenges`
- `incorrect_submissions_per_min`
- `challenge_difficulty_visibility`
- `ctf_logo`, `ctf_small_icon`, `ctf_name`

## 7. Testing and operations capabilities

### 7.1 Test suites

- `Test/RaceCondition`: race-condition va concurrency tests (submit, hint, start/stop, ticket, cooldown, max attempts).
- `Test/Gateway`: auth/proxy/rate-limit/resilience/race/load/spike/soak scripts cho gateway.
- `Test/Stress`: stress suite cho nhieu endpoint, co script CI/report.

### 7.2 Operations

- `manage.sh`: menu setup master/worker, install FCTF, setup harbor, CI/CD, uninstall.
- `FCTF-k3s-manifest`: setup K3s, NFS ACL, Helm, network policy, service mode, RabbitMQ topology, Redis ACL guidance.
- Health endpoints: `/healthz`, `/healthcheck` tren nhieu service.

### 7.3 Data migration

- `database-migration`: cong cu migrate 2 chieu giua FCTF va CTFd, mapping JSON, upsert, pre/post SQL, retry connection logic.

## 8. Cac diem can theo doi (technical debt / governance)

1. Endpoint callback cua Deployment Center (`DeploymentCenter/api/StatusCheck/message`) duoc ghi chu la chua authen; can xac nhan chinh sach bao ve.
2. Frontend co `ACTION_LOGS.POST` trong service, nhung Contestant Service controller hien tai chi thay endpoint get logs team; can dong bo API contract.
3. `authService.clearSession()` dang `localStorage.clear()` toan bo; co the xoa ca du lieu khong lien quan auth.
4. CORS `AllowAll` dang bat tren Contestant Service va Deployment Center; can ra soat policy theo moi truong production.

## 9. Ket luan

FCTF hien tai khong chi la ban CTFd thuong, ma la he thong da bo sung day du cac khoi:

- Contestant flow rieng (Contestant Portal + Contestant Service).
- Runtime challenge deployment theo queue/workflow/watcher.
- Gateway tokenized cho HTTP/TCP.
- Co che chong race/chong abuse/chong vuot quota bang Redis scripts va locks.
- Van hanh K8s va test suite co to chuc.

Tai lieu nay nen duoc cap nhat theo tung release de giu vai tro "source of truth" cho tinh nang da trien khai.
