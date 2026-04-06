# FCTF – Automated Test Guide

Tài liệu này mô tả toàn bộ bộ test tự động cho hệ thống FCTF, bao gồm cách cài đặt, cấu hình và điều kiện cần thiết trước khi chạy từng file test.

---
Chạy toàn bộ test bằng script: node run-tests.js

## 1. Cài đặt

### Yêu cầu
- **Node.js** ≥ 18
- **npm** ≥ 9
- Playwright đã được cài đặt

### Cài dependencies

```bash
npm install
npx playwright install chromium
```

---

## 2. Thông tin môi trường

| Biến | Giá trị mặc định |
|------|-----------------|
| Admin Portal | `https://admin.fctf.site` |
| Contestant Portal | `https://contestant.fctf.site` |
| Admin account | `admin` / `1` |

> Các thông tin này được khai báo trực tiếp trong từng file test. Nếu cần thay đổi, hãy cập nhật các hằng số `ADMIN_URL`, `CONTESTANT_URL` ở đầu file.

---

## 3. Chạy test

### Chạy toàn bộ (Khuyên dùng)
Để đảm bảo tất cả các test (bao gồm cả `SystemTest-First`) chạy đúng thứ tự và không bị xung đột, hãy sử dụng script điều hướng sau:

**Cách 1: Chạy bằng Node.js (Mọi hệ điều hành)**
```bash
node run-tests.js
```

**Cách 2: Chạy bằng PowerShell (Windows)**
```powershell
.\run-tests.ps1
```

**Ưu điểm của cách chạy này:**
- **Thứ tự thông minh**: Tự động chạy `SystemTest-First` trước (35 file), sau đó đến các test giao diện trong folder `Test/` gốc, và cuối cùng mới chạy các file Reset dữ liệu (CSV, Reset Contest).
- **Worker = 1**: Đảm bảo chạy tuần tự từng test case một, tránh lỗi do quá tải server hoặc xung đột session đăng nhập.
- **Vượt rào cản Config**: Tự động nạp đúng file cấu hình cho folder `SystemTest-First` (thứ mà lệnh `npx playwright test` thông thường sẽ bỏ qua).
### Chạy một file cụ thể
```bash
npx playwright test Test/<tên-file>.spec.ts
```

### Chạy toàn bộ
```bash
npx playwright test
```

### Xem báo cáo sau khi chạy
```bash
npx playwright show-report
```

### Reset contest về trạng thái ban đầu (nếu test bị interrupted)


---

## 4. Tổng quan các file test

| File | Chức năng | Portal |
|------|-----------|--------|
| `login-test.spec.ts` | Kiểm tra đăng nhập Contestant | Contestant |
| `ticket-test.spec.ts` | Tạo, xem, xoá Support Ticket | Contestant |
| `challenges-test.spec.ts` | Xem danh sách và chi tiết challenge | Contestant + Admin |
| `submit-flag-test.spec.ts` | Submit flag (đúng, sai, giới hạn, freeze…) | Contestant + Admin |
| `start-challenge-test.spec.ts` | Start/Stop challenge instance | Contestant + Admin |
| `stop-challenge-test.spec.ts` | Dừng challenge instance | Contestant + Admin |
| `monitor-instance-test.spec.ts` | Admin theo dõi và quản lý instance | Admin + Contestant |
| `export-user-test.spec.ts` | Admin export danh sách user (CSV) | Admin |
| `admin-action-logs-test.spec.ts` | Admin lọc Action Logs | Admin |
| `instance-request-logs-test.spec.ts` | Kiểm tra Request Logs (HTTP & TCP) | Admin + Contestant |
| `audit-log-test.spec.ts` | Kiểm tra Audit Logs | Admin |
| `hint-test.spec.ts` | Xem và mua hint trong challenge | Contestant |
| `user-profile-test.spec.ts` | Xem và chỉnh sửa profile | Contestant |
| `admin-create-chal.spec.ts` | Admin tạo challenge mới | Admin |
| `admin-user-filter-test.spec.ts` | Admin tìm kiếm và lọc user | Admin |
| `preview-challenge-test.spec.ts` | Admin xem trước (Preview) challenge đang deploy | Admin |
| `deployment-history-test.spec.ts` | Xem lịch sử deploy của challenge | Admin |
| `admin-create-user-team-test.spec.ts` | Admin tạo user mới và team mới | Admin |
| `admin-ticket-test.spec.ts` | Admin quản lý ticket (xem, lọc, tìm kiếm, xoá) | Admin |
| `load-test.spec.ts` | Kiểm tra tải hệ thống | Contestant |
| `admin-config-time-test.spec.ts` | Admin config Start/End/Freeze Time | Admin + Contestant |
| `admin-config-general-test.spec.ts` | CONF-GEN-001 -> 013 | General settings (Event name, Captain only, etc.) |
| `admin-config-logo-test.spec.ts` | CONF-LOGO-001 -> 011 | Logo and Icon upload, removal, and security |
| `admin-config-visibility-test.spec.ts` | CONF-VIS-001 -> 007 | Score and difficulty visibility control |
| `admin-ticket-respond-test.spec.ts` | TC-RES-000 -> 005 | Admin responding and closing tickets |
| `scoreboard-search-test.spec.ts` | TC-SB-SEA-001 -> 009 | Tìm kiếm và lọc trên scoreboard | Contestant |
| `reset-contest.spec.ts` | Contest time reset script | Admin |
| `Test/SystemTest-First/` | 35 admin system-test specs, 113 test cases (UC23 -> UC82) | Admin |

---

## 5. Chi tiết từng file test

---

### `login-test.spec.ts`
**Test cases:** TC-L001 → TC-L010

**Tài khoản cần có:**

| Tài khoản | Trạng thái yêu cầu |
|-----------|-------------------|
| `user2` | Active, có team |
| `user_no_team` | Active, chưa có team |
| `banned_user` | Bị banned |
| `hidden_user` | Bị hidden |
| `~~a` | Active, ký tự đặc biệt |

**Điều kiện:**
- Contest đang **active** (start < now < end).
- Tất cả các account trên phải tồn tại sẵn trong DB.

---

### `ticket-test.spec.ts`
**Test cases:** TC-T001 → TC-T304

**Tài khoản:** `user20` / `1` (có team)

**Điều kiện:**
- Contest đang active.
- Test tự tạo dữ liệu — không cần chuẩn bị ticket trước.
- Chạy **serial** (không song song).

---

### `challenges-test.spec.ts`
**Test cases:** TC-C001 → TC-C006

**Tài khoản:** `user20` / `1`, `admin` / `1`

**Điều kiện:**
- Có ít nhất 1 challenge **visible**.
- TC-C003: `user20` có challenge bị **lock** (có prerequisite).
- TC-C005: `user20` đã giải ít nhất 1 challenge (optional, test bỏ qua nếu chưa có).

---

### `submit-flag-test.spec.ts`
**Test cases:** TC-SF001 → TC-SF014

**Tài khoản:** `user900`, `user401`–`user414`, `user914`, `user1001`

> **Quan trọng:** Các user `user400+` phải ở trạng thái **chưa giải bài nào** trước khi chạy.

**Điều kiện:**
- Flag đúng = `1` (được hardcode trong test).
- `user1001` là **member** (không phải captain) trong cùng team với `user9`.
- Contest đang active.
- Chạy **serial**.

---

### `start-challenge-test.spec.ts`
**Test cases:** STC-001 → STC-019

**Tài khoản:** `user501`–`user518`, `user9` (captain), `user1001` (member), `user801`, `user701`, `user1111`

**Challenge cần có:** `pwn` (deployable via Kubernetes)

**Điều kiện:**
- Kubernetes cluster đang hoạt động.
- `user9` là captain, `user1001` là member cùng team.
- `user801` và `user701` thuộc **2 team khác nhau**.

---

### `monitor-instance-test.spec.ts`
**Test cases:** MCI-001 → MCI-007

**Tài khoản:** `admin` / `1`, `user22` / `1`

**Điều kiện:**
- Kubernetes cluster đang hoạt động.
- Test tự seed 1 instance trước khi chạy (`beforeAll`).

> ⚠️ **MCI-005** sẽ **dừng** 1 instance. **MCI-006** sẽ **dừng tất cả** instance đang chạy. Không chạy khi có cuộc thi thật.

---

### `export-user-test.spec.ts`
**Test cases:** EXP-001 → EXP-010

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Có ít nhất 1 user trong hệ thống.
- Máy chạy test có quyền ghi file (để download CSV).

---

### `admin-action-logs-test.spec.ts`
**Test cases:** FILT-ADM-AL-001 → FILT-ADM-AL-008

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Hệ thống đã có ít nhất vài bản ghi Action Logs (đăng nhập vài lần bằng contestant account trước).

---

### `instance-request-logs-test.spec.ts`
**Test cases:** INST-LOG-001 (HTTP), INST-LOG-002 (TCP)

**Tài khoản:** `user1` / `1`, `admin` / `1`

**Challenge cần có:**

| Challenge | ID | Loại |
|-----------|-----|------|
| EZ Web | 186 | WEB (SQL Injection) |
| pwn | 185 | PWN (TCP/deployable) |

**Điều kiện:**
- Kubernetes cluster đang hoạt động.
- `user1` có team, contest đang active.
- Timeout test: **5 phút** (deployment có thể chậm).
- Sau khi test chạy, kiểm tra **Admin → Monitoring → Request Logs** để xác nhận log đã được ghi.

---

### `audit-log-test.spec.ts`
**Test cases:** AUDIT-001 → AUDIT-005

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Hệ thống đã có ít nhất vài bản ghi Audit Logs (ví dụ: tạo user, team, challenge).
- Test tự tạo dữ liệu nếu không có sẵn.

---

### `hint-test.spec.ts`
**Test cases:** TC-H001 → TC-H005

**Tài khoản:** `user20` / `1`

**Điều kiện:**
- Có ít nhất 1 challenge có hint.
- `user20` có đủ điểm để mua hint.

---

### `user-profile-test.spec.ts`
**Test cases:** TC-UP001 → TC-UP005

**Tài khoản:** `user20` / `1`

**Điều kiện:**
- `user20` có team.
- Test tự tạo dữ liệu nếu cần.

---

### `admin-create-chal.spec.ts`
**Test cases:** CRCH-001 → CRCH-005

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Kubernetes cluster đang hoạt động.
- Test tự tạo challenge với tên duy nhất.

---

### `admin-user-filter-test.spec.ts`
**Test cases:** FILT-ADM-USER-001 → FILT-ADM-USER-008

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Có đủ user với các trạng thái khác nhau (active, banned, hidden, no team, etc.) để test lọc.

---

### `preview-challenge-test.spec.ts`
**Test cases:** PREV-001 → PREV-004

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Kubernetes cluster đang hoạt động ổn định.
- **Dữ liệu Challenge**:
    - Cần ít nhất 1 challenge ở trạng thái `DEPLOY_SUCCESS` (để test PREV-001 & PREV-004).
    - Cần ít nhất 1 challenge ở trạng thái `DEPLOY_FAILED` (mặc định test tìm ID 194, nếu không thấy sẽ tự lọc bài khác).
- **Cơ chế đặc biệt**:
    - **Re-click strategy**: Test sẽ tự động bấm lại nút "Preview" mỗi 40s nếu URL chưa xuất hiện. Đây là hành vi bình thường để refresh modal.
    - **Timeout**: Timeout của file này rất lớn (lên tới 15 phút) do quá trình chờ khởi tạo pod có thể lâu.
    - **Serial mode**: Các test chạy tuần tự để tránh xung đột tài nguyên khi start nhiều preview cùng lúc.

---

### `deployment-history-test.spec.ts`
**Test cases:** DEPH-001 → DEPH-003

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Có ít nhất 1 challenge đã được deploy nhiều lần để có lịch sử.

---

### `admin-create-user-team-test.spec.ts`
**Test cases:** CRU-001 → CRU-018 (Create User), CRT-001 → CRT-018 (Create Team)

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Contest đang active, portal accessible.
- Test tự tạo user/team với timestamp suffix — không cần chuẩn bị trước.
- Chạy **serial** (các test trùng-tên test cần thứ tự nhất định).

**Test cases bao gồm:**

| Nhóm | Test cases | Mô tả |
|------|------------|-------|
| Create User (CRU) | CRU-001 | UI: Form hiển thị đủ trường |
| | CRU-002 | UI: Dropdown Type có đủ 4 options (user/admin/challenge_writer/jury) |
| | CRU-003 | Happy path: Tạo user hợp lệ → redirect đến trang chi tiết |
| | CRU-004 | Happy path: Tạo user type Admin |
| | CRU-005 | Happy path: Tạo user type Challenge Writer |
| | CRU-006 | Happy path: Tạo user type Jury |
| | CRU-007 | Happy path: Tạo user Verified |
| | CRU-008 | Happy path: Tạo user Hidden |
| | CRU-009 | Happy path: Tạo user Banned |
| | CRU-010 | Validation: Thiếu password → lỗi (password bắt buộc theo API) |
| | CRU-011 | Validation: Thiếu Name → lỗi |
| | CRU-012 | Validation: Thiếu Email → lỗi |
| CRU-013 | Validation: Email sai định dạng → lỗi |
| CRU-014 | Validation: Username trùng → lỗi |
| CRU-015 | Validation: Email trùng → lỗi |
| CRU-016 | Security: Truy cập khi chưa login → redirect login |
| CRU-017 | Happy path: Tên có ký tự đặc biệt |
| CRU-018 | Happy path: Tên Unicode (tiếng Việt) |
| Create Team (CRT) | CRT-001 | UI: Form hiển thị đủ trường |
| | CRT-002 | UI: Dropdown Country có tùy chọn |
| | CRT-003 | Tạo team với name và password | Thành công | Admin Create Team |
| | CRT-004 | Happy path: Tạo team đầy đủ thông tin |
| | CRT-005 | Happy path: Tạo team Hidden |
| | CRT-006 | Happy path: Tạo team Banned |
| | CRT-007 | Happy path: Tạo team có chọn quốc gia |
| | CRT-008 | Happy path: Tạo team với website URL hợp lệ |
| | CRT-009 | Validation: Thiếu Team Name → lỗi |
| | CRT-010 | Validation: Team name trùng → lỗi |
| | CRT-011 | Validation: Email sai định dạng → lỗi |
| | CRT-012 | Validation: Email team trùng → lỗi |
| | CRT-013 | Security: Truy cập khi chưa login → redirect login |
| | CRT-014 | Happy path: Tên Unicode (tiếng Việt) |
| | CRT-015 | Happy path: Cả Hidden và Banned đều bật |
| | CRT-016 | Thiếu password | Hiện lỗi (bắt buộc) | Admin Create Team |
| CRT-017 | Tạo team với affiliation dài | Thành công | Admin Create Team |
| CRT-018 | Hiển thị team vừa tạo trong list | Thành công | Admin Create Team |
| CRT-019 | Gán user vào team qua Admin UI | Thành công | Admin Create Team |

---

### `admin-ticket-test.spec.ts`
**Test cases:** ADM-TIC-001 → ADM-TIC-013

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- Hệ thống có ít nhất 2 tickets để thực hiện test bulk delete.
- Một số ticket nên có Title rõ ràng để test tính năng Search.

**Các trường hợp kiểm thử bao gồm:**
- View, Filter (Status, Type), Search (Title), View Details.
- Xóa đơn lẻ, Xóa hàng loạt (Bulk Delete).
- **Edge cases**: Tìm kiếm chuỗi cực dài (255+ ký tự), ký tự đặc biệt and Unicode.
- **Security**: SQL Injection payload handling, Unauthorized Access (redirect to login).

**Lưu ý kỹ thuật:**
- Trang này sử dụng custom **Searchable Select** UI. Test đã được cấu hình để tương tác với `.ss-wrapper` và `.ss-input` thay vì element `select` truyền thống (do bị JS remove khỏi DOM).
- Các action xoá (Delete) yêu cầu xác nhận qua trình duyệt (`dialog.accept()`).
- Optimized to wait for `load` state instead of `networkidle` to avoid timeouts.
- Delete actions require browser confirmation (`dialog.accept()`).

---

### `admin-config-time-test.spec.ts`
**Test cases:** CONF-TIME-001 → CONF-TIME-004

**Tài khoản:** `admin` / `1`, `user2` / `1`

**Điều kiện:**
- Admin portal accessible tại `https://admin.fctf.site`.
- Contestant portal accessible tại `https://contestant.fctf.site`.
- `user2` là tài khoản contestant hợp lệ, có team.
- **Chạy serial** (các test thay đổi config toàn cục).
- Sau khi chạy xong nên chạy `reset-contest.spec.ts` để restore lại thời gian contest.

**Technical Notes:**
- Config tabs may be mismatched (e.g., "End Time" matches sidebar "Start and End Time"). Tests use **container scoping** (`#config-sidebar`, `#ctftime`) to avoid strict mode violations.
- After clicking **Update**, the page reloads automatically. The test uses `Promise.all([waitForNavigation, click])` to capture this event.
- `loginContestant` waits for a redirect away from `/login` (regex excludes `/login`) to ensure the session is established before checks.

---

### `admin-config-general-test.spec.ts`
**Test cases:** CONF-GEN-001 → CONF-GEN-013

**Accounts:** `admin` / `1`, `user2` / `1` (member), `user9` / `1` (captain)

**Conditions:**
- Admin portal accessible at `https://admin.fctf.site`.
- Contestant portal accessible at `https://contestant.fctf.site`.
- `user2` is a **member** (not captain) in a team.
- `user9` is the **captain** of the team.
- Contest is **active** (to ensure the challenges page is accessible).
- Run in **serial** mode (tests modify global configurations).
- Last test (CONF-GEN-013) automatically restores defaults: `captain_only_start=Disabled`, `captain_only_submit=Disabled`, `limit_challenges=3`, `ctf_name=FCTF`.

**Technical Notes:**
- General form does **not** use standard `<form>` POST. It uses **AJAX**: `configs.js` handles the submit event, serializes the form using `serializeJSON()`, and calls `PATCH /api/v1/configs`. Upon success, `window.location.reload()` is called. Test uses `Promise.all([waitForNavigation, click])` to capture this reload.
- **Captain-only check on contestant portal**: Check happens on client-side (React) based on `is_captain` field from API. Test opens challenge cards using `.challenge-card` or `[data-require-deploy="true"]`. If no challenges are present, contestant-side check is gracefully skipped, but admin-side assertion still runs.
- `limit_challenges` is a `type="number"` field with `min="1"`. Browser-side validation is not tested as form submits via AJAX.
- Run tests in **serial** mode – do not use `--workers` > 1 to avoid race conditions with global config changes.
- Sau khi chạy suite này, hãy chạy `reset-contest.spec.ts` nếu các test khác ảnh hưởng đến thời gian contest.

---

### Admin Config Logo Tests (`admin-config-logo-test.spec.ts`)
**Test cases:** CONF-LOGO-001 → CONF-LOGO-011

**Tài khoản:** `admin` / `1`, `user2` / `1`

**Điều kiện:**
- File `logo.jpg`, `logo.png`, `security_test.php` tồn tại trong thư mục gốc.
- **Chạy serial**.
- Test tự động dọn dẹp các asset đã upload.

#### Technical Notes (Logo)
- **Bootstrap Modals**: The "Remove" actions trigger a custom Bootstrap modal (`ezQuery`). Playwright must click the "Yes" button in the modal footer rather than handling a native browser dialog.
- **Cache Clearing**: The Contestant Portal caches public configuration in `localStorage` for 5 minutes. Tests must clear `localStorage` and reload to verify logo changes immediately.
- **Security Finding (File Upload)**: The system allows uploading non-image extensions (like `.php`) for the logo. However, since the server is Python/Flask-based and serves files statically via `send_file`, the PHP code is treated as a binary stream and **never executed**, preventing RCE (Remote Code Execution).
- **Recommendation**: Implement backend validation to strictly allowed image mime-types (`image/png`, `image/jpeg`, etc.) to prevent potential XSS or storage cluttering.

---

### Admin Config Visibility Tests (`admin-config-visibility-test.spec.ts`)
**Test cases:** CONF-VIS-001 → CONF-VIS-007

**Tài khoản:** `admin` / `1`, `user2` / `1`

**Điều kiện:**
- **Chạy serial với `--workers=1`**.
- Test sử dụng cơ chế xóa cache surgical (`contest_date_config`, `contest_public_config`).
- Contestant `user2` phải có team để xem scoreboard.
- Đảm bảo contest đang active.

---

### Admin Challenge Hint Tests (`admin-challenge-hint-test.spec.ts`)
**Test cases:** CHAL-HINT-001 → CHAL-HINT-007

**Tài khoản:** `admin` / `1`, `user2` / `1`

**Điều kiện:**
- **Chạy serial với `--workers=1`**.
- File test sử dụng Challenge ID 186 (`EZ Web`) trong category `WEB`.
- Cần có CodeMirror helper cho textarea nội dung hint.
- Đoạn test xóa bao gồm luồng Contestant unlock hint và Custom HTML modal confirm tại Admin portal.

---

### `admin-ticket-respond-test.spec.ts`
**Test cases:** TC-RES-000 → TC-RES-005

**Tài khoản:** `user19` / `1` (Contestant), `admin` / `1`

**Điều kiện:**
- **Chạy serial với `--workers=1`**.
- Test sử dụng `user19` để tạo data đầu vào. Nếu `user19` lỗi, sẽ fallback sang `user20`.
- **Cơ chế đặc biệt**:
    - **Randomization**: Nội dung ticket được randomize cực mạnh để bypass bộ lọc spam (similarity check).
    - **Exact Matching**: Do IDs có thể chứa các chữ số trùng lặp trong timestamp (ví dụ: '10' trong `10:33`), test sử dụng Regex `^ID$` và lọc theo cột ID để đảm bảo tương tác đúng ticket.

**Các trường hợp kiểm thử:**
- TC-RES-000: Setup (Tạo 3 tickets khác nhau).
- TC-RES-001: Validation bắt buộc nhập nội dung phản hồi (HTML5 tooltips).
- TC-RES-002: Happy path (Phản hồi vé và kiểm tra trạng thái Closed).
- TC-RES-003: XSS & Special Characters (Dữ liệu trả về được escape an toàn trong textarea).
- TC-RES-004: Long Text (Text dài 5000+ ký tự).
- TC-RES-005: View Responded Ticket (Kiểm tra giao diện Readonly sau khi đóng vé).

---

### Admin Scoreboard Tests (`admin-scoreboard-test.spec.ts`)
**Test cases:** SCORE-001 → SCORE-002

**Tài khoản:** `admin` / `1`

**Điều kiện:**
- **Chạy serial với `--workers=1`**.
- Hệ thống đã có data (user, score, vv) để hiển thị Scoreboard.
- Test này focus vào khả năng hiển thị UI và Trigger API Tải Export file thành công (.zip / .csv). Chức năng visibility không đưa vào do yêu cầu.

---

### `reset-contest.spec.ts`
> This is a **utility script**, not a test case.

Used to reset contest time after configuration changes:
- Start date → 2020
- End date → 2099

```bash
npx playwright test Test/reset-contest.spec.ts
```

---

### `Test/SystemTest-First/`
This folder contains the ordered admin system-test suite contributed by Nhat. It focuses on admin-side CRUD, filtering, search, submission-management, brackets, and custom-field flows.

**Scope:** 35 spec files, 113 test cases, all under ordered execution.

**Run commands:**

```bash
cd Test/SystemTest-First
npm test
npm run test:headed
npm run test:report
```

**Execution characteristics:**
- Uses `run-ordered-tests.cjs` to enforce deterministic file order.
- Runs with `workers: 1` and `fullyParallel: false` because many cases mutate shared admin data.
- Generates a dedicated report inside `Test/SystemTest-First/playwright-report/`.
- Full testcase matrix is maintained in `Test/SystemTest-First/all-test-cases.tsv`.

**Files and test items:**

| File | Test Cases | Chức năng |
|------|------------|-----------|
| `uc23-query-reward.spec.ts` | UC23-01 -> UC23-03 | Query reward templates and preview results |
| `uc24-filter-history.spec.ts` | UC24-01 -> UC24-05 | Filter instance history |
| `uc25-view-instance-history.spec.ts` | UC25-01 -> UC25-03 | View instance history page |
| `uc26-view-audit-logs.spec.ts` | UC26-01 -> UC26-03 | View and filter audit logs |
| `uc28-view-users.spec.ts` | UC28-01 -> UC28-15 | View, search, and filter users |
| `uc30-edit-user.spec.ts` | UC30-01 -> UC30-11 | Edit user validation and happy paths |
| `uc31-delete-user.spec.ts` | UC31-01 -> UC31-05 | Delete user flows |
| `uc37-view-teams.spec.ts` | UC37-01 -> UC37-12 | View, search, and filter teams |
| `uc39-edit-team.spec.ts` | UC39-01 -> UC39-14 | Edit team validation and happy paths |
| `uc40-delete-team.spec.ts` | UC40-01 -> UC40-04 | Delete team flows |
| `uc42-search-team.spec.ts` | UC42-01 -> UC42-04 | Search team by name, id, affiliation |
| `uc43-view-submissions.spec.ts` | UC43-01 -> UC43-03 | View submissions page |
| `uc44-delete-submission.spec.ts` | UC44-01 -> UC44-03 | Delete submission flows |
| `uc45-search-submission.spec.ts` | UC45-01 -> UC45-05 | Search and filter submissions |
| `uc46-change-submission-status.spec.ts` | UC46-01 -> UC46-03 | Change submission status |
| `uc63-comment.spec.ts` | UC63-01 | Add team comment |
| `uc64-assign-captain.spec.ts` | UC64-01 | Assign team captain |
| `uc65-view-user-solves.spec.ts` | UC65-01 | View user solves |
| `uc66-view-team-solves.spec.ts` | UC66-01 | View team solves |
| `uc67-view-user-fails.spec.ts` | UC67-01 | View user fails |
| `uc68-view-team-fails.spec.ts` | UC68-01 | View team fails |
| `uc69-view-user-award.spec.ts` | UC69-01 | View user awards |
| `uc70-view-team-award.spec.ts` | UC70-01 | View team awards |
| `uc71-delete-solved-submission.spec.ts` | UC71-01 | Delete solved submission |
| `uc72-delete-failed-submission.spec.ts` | UC72-01 | Delete failed submission |
| `uc73-delete-award.spec.ts` | UC73-01 | Delete award |
| `uc74-view-team-missings.spec.ts` | UC74-01 | View team missing challenges |
| `uc75-view-brackets.spec.ts` | UC75-01 | View brackets config |
| `uc76-create-bracket.spec.ts` | UC76-01 | Create bracket |
| `uc77-update-bracket.spec.ts` | UC77-01 | Update bracket |
| `uc78-delete-bracket.spec.ts` | UC78-01 | Delete bracket |
| `uc79-view-custom-fields.spec.ts` | UC79-01 | View custom fields config |
| `uc80-create-custom-field.spec.ts` | UC80-01 | Create custom field |
| `uc81-update-custom-field.spec.ts` | UC81-01 | Update custom field |
| `uc82-delete-custom-field.spec.ts` | UC82-01 | Delete custom field |

**Synchronization notes:**
- This suite follows the same Playwright project model as the root repository: Chromium project, HTML report, `trace: on-first-retry`, and CI-aware retry behavior.
- It intentionally keeps `workers: 1` and ordered execution because these test items mutate shared admin data and global configuration.

---

## 6. Recommended Execution Order

```
1.  login-test.spec.ts
2.  ticket-test.spec.ts
3.  challenges-test.spec.ts
4.  hint-test.spec.ts
5.  user-profile-test.spec.ts
6.  start-challenge-test.spec.ts
7.  stop-challenge-test.spec.ts
8.  monitor-instance-test.spec.ts
9.  submit-flag-test.spec.ts
10. export-user-test.spec.ts
11. admin-action-logs-test.spec.ts
12. instance-request-logs-test.spec.ts
13. audit-log-test.spec.ts
14. preview-challenge-test.spec.ts
15. deployment-history-test.spec.ts
16. admin-create-user-team-test.spec.ts
17. admin-ticket-test.spec.ts
18. admin-ticket-respond-test.spec.ts
19. admin-config-time-test.spec.ts
20. admin-config-general-test.spec.ts
21. admin-config-logo-test.spec.ts
22. admin-config-visibility-test.spec.ts
23. admin-challenge-hint-test.spec.ts
24. admin-scoreboard-test.spec.ts
25. reset-contest.spec.ts  ← run after 19-22 to restore contest time
```

> After suites that modify contest configuration (start/end time, freeze, etc.), it is recommended to run `reset-contest.spec.ts` to ensure a clean state for the next test suite.

---

## 7. General Notes

- **Do not run in parallel** test files that affect the same user or contest configuration.
- Tests with `test.describe.configure({ mode: 'serial' })` **must** run sequentially.
- If a test FAILS due to timeout, check:
  - Are the portals accessible (Cloudflare, network, etc.)?
  - Is the Kubernetes cluster scaling up/down?
  - Is the contest reset to an active state?
- Error screenshots are automatically saved to `test-results/`.
### `scoreboard-search-test.spec.ts`
**Test cases:** TC-SB-SEA-001 → TC-SB-SEA-009

**Tài khoản cần có:**

| Tài khoản | Trạng thái yêu cầu |
|-----------|-------------------|
| `user22` | Mật khẩu là `1` |

**Lưu ý khi chạy:**
1. **Lỗi Execution Policy**: Do hệ thống Windows bị chặn chạy script PowerShell, khi chạy test bằng `npx` có thể lỗi. Hãy dùng lệnh trực tiếp qua `node`:
   ```bash
   node node_modules\playwright\cli.js test Test/scoreboard-search-test.spec.ts
   ```
2. **Sequential execution**: Để đảm bảo tính ổn định của session và tránh bị logout giữa chừng, nên chạy tuần tự bằng `workers=1`:
   ```bash
   node node_modules\playwright\cli.js test Test/scoreboard-search-test.spec.ts --workers=1
   ```
3. **Màn hình Login**: Test đã được thiết kế debug rất kỹ để xử lý việc redirect chậm. Nếu vẫn bị timeout tại bước Login, hãy tăng `timeout` trong file test hoặc kiểm tra lại trạng thái server.

**Kịch bản kiểm thử:**
- **SB-SEA-001**: Tìm kiếm chính xác (Exact match) với `team2`.
- **SB-SEA-002**: Tìm kiếm substring với `team2`.
- **SB-SEA-003**: Tìm kiếm không phân biệt hoa thường (Case-insensitive) với `TEAM2`.
- **SB-SEA-004**: Tìm kiếm một phần tên với `eam2`.
- **SB-SEA-005**: Tìm kiếm ký tự đặc biệt/Unicode với `~~a`.
- **SB-SEA-006**: Xử lý khi không có kết quả tìm kiếm.
- **SB-SEA-007**: Kích hoạt tìm kiếm bằng phím Enter.
- **SB-SEA-008**: Kiểm tra an toàn bảo mật (XSS) trong ô tìm kiếm.
- **SB-SEA-009**: Kiểm tra đồng nhất dữ liệu (Hidden user không xuất hiện khi search).
