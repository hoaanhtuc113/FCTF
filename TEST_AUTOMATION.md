# FCTF – Automated Test Guide

Tài liệu này mô tả toàn bộ bộ test tự động cho hệ thống FCTF, bao gồm cách cài đặt, cấu hình và điều kiện cần thiết trước khi chạy từng file test.

---

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
| `reset-contest.spec.ts` | Contest time reset script | Admin |

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
- Chạy **serial** (các test thay đổi config toàn cục).
- Sau khi chạy xong nên chạy `reset-contest.spec.ts` để restore lại thời gian contest.

**Bảng Test Cases:**

| Test Case ID | Test Case Description | Test Case Procedure | Expected Results | Pre-conditions |
|---|---|---|---|---|
| CONF-TIME-001 | Set Valid Start and End Time (Active State) | 1. Admin đăng nhập. 2. Vào Admin → Config → Start and End Time. 3. Đặt Start Time = hôm qua, End Time = 2 ngày tới. 4. Nhấn Update. 5. Reload trang, kiểm tra giá trị đã lưu. 6. Đăng nhập contestant → vào /challenges. | - Giá trị Start/End Time lưu đúng trong Admin. - Contestant thấy trang challenges bình thường, **không** có thông báo "CONTEST NOT ACTIVE". | Admin account tồn tại; contestant `user2` tồn tại và có team. |
| CONF-TIME-002 | Verify Inactive State (Start Time in Future) | 1. Admin đăng nhập. 2. Vào Admin → Config → Start and End Time. 3. Đặt Start Time = 2 ngày tới, End Time = 5 ngày tới. 4. Nhấn Update. 5. Kiểm tra Admin đã lưu đúng. 6. Đăng nhập contestant `user2` → vào /challenges. | - Giá trị lưu đúng trong Admin. - Contestant thấy thông báo **"[!] CONTEST NOT ACTIVE"** trên trang /challenges. | Contest chưa bắt đầu (start time ở tương lai). |
| CONF-TIME-003 | Verify Inactive State (End Time in Past) | 1. Admin đăng nhập. 2. Vào Admin → Config → Start and End Time. 3. Đặt Start Time = 5 ngày trước, End Time = 2 ngày trước. 4. Nhấn Update. 5. Kiểm tra Admin đã lưu đúng. 6. Đăng nhập contestant `user2` → vào /challenges. | - Giá trị lưu đúng trong Admin. - Contestant thấy thông báo **"[!] CONTEST NOT ACTIVE"** trên trang /challenges. | Contest đã kết thúc (end time ở quá khứ). |
| CONF-TIME-004 | Freeze Time Configuration | 1. Admin đăng nhập. 2. Vào Admin → Config → Start and End Time → tab Freeze Time. 3. Đặt Freeze Time = ngày mai. 4. Nhấn Update. 5. Reload trang, kiểm tra Freeze Time đã lưu đúng. | - Freeze Year và Freeze Day khớp với giá trị đã đặt. | Admin account tồn tại. |

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

**Test Case Table:**

| Test Case ID | Test Case Description | Test Case Procedure | Expected Results | Pre-conditions |
|---|---|---|---|---|
| CONF-GEN-001 | UI – General tab renders all required fields | 1. Login as Admin. 2. Go to Admin -> Config -> General. 3. Check fields and options. | Fields `ctf_name`, `ctf_description`, `captain_only_start_challenge`, `captain_only_submit_challenge`, `limit_challenges` are displayed correctly. | Admin account exists. |
| CONF-GEN-002 | Happy path – Update Event Name | 1. Login as Admin. 2. Go to General tab. 3. Enter new CTF Name. 4. Click Update. 5. Reload and verify. | New Event Name is saved and displayed correctly after reload. | Admin portal accessible. |
| CONF-GEN-003 | Happy path – Update Event Description | 1. Login as Admin. 2. Go to General tab. 3. Enter new description. 4. Click Update. 5. Reload and verify. | Event Description is saved successfully. | Admin portal accessible. |
| CONF-GEN-004 | Captain Only Start – Enable & Check member restriction | 1. Admin enables `captain_only_start_challenge`. 2. Login as member (non-captain). 3. Open challenge panel. | Admin saves successfully; Member sees "[!] Only captain can start" and cannot start challenge. | `user2` is a member (not captain). |
| CONF-GEN-005 | Captain Only Start – Disable & Check normal access | 1. Admin disables `captain_only_start_challenge`. 2. Login as member. 3. Open challenge panel. | Restriction message disappears; Start challenge button is visible. | Contest is active. |
| CONF-GEN-006 | Captain Only Submit – Enable & Check member restriction | 1. Admin enables `captain_only_submit_challenge`. 2. Login as member. 3. Open challenge panel. | Member sees "[!] Only captain can submit" or "[CAPTAIN ONLY]" button. | `user2` is a member. |
| CONF-GEN-007 | Captain Only Submit – Captain Permissions | 1. Captain-only submit is enabled. 2. Login as team captain. 3. Open challenge panel. | Captain sees normal [SUBMIT] button, no restrictions. | `user9` is the team captain. |
| CONF-GEN-008 | Captain Only Submit – Disable & Check access | 1. Admin disables `captain_only_submit_challenge`. 2. Login as member. 3. Open challenge panel. | Submit restriction is removed for all team members. | Contest is active. |
| CONF-GEN-009 | Limit Challenges – Check persistence | 1. Admin sets `limit_challenges` to 3. 2. Click Update. 3. Reload and verify. | Value 3 is saved successfully. | Admin portal accessible. |
| CONF-GEN-010 | Limit Challenges – Minimum value | 1. Admin sets `limit_challenges` to 1. 2. Click Update. 3. Verify. | Value 1 is accepted and saved correctly. | Admin portal accessible. |
| CONF-GEN-011 | Batch Update | 1. Edit all fields in General tab simultaneously. 2. Click Update. 3. Verify all fields. | All values are saved correctly in a single submission. | Admin portal accessible. |
| CONF-GEN-012 | Security – Unauthorized access | 1. Access `/admin/config` without logging in. | System automatically redirects to login page. | Admin session not established. |
| CONF-GEN-013 | Restore Defaults | 1. Reset all fields to default values. 2. Click Update. | Default values are restored: Name=FCTF, Flags=Disabled, Limit=3. | Admin portal accessible. |

**Technical Notes:**
- General form does **not** use standard `<form>` POST. It uses **AJAX**: `configs.js` handles the submit event, serializes the form using `serializeJSON()`, and calls `PATCH /api/v1/configs`. Upon success, `window.location.reload()` is called. Test uses `Promise.all([waitForNavigation, click])` to capture this reload.
- **Captain-only check on contestant portal**: Check happens on client-side (React) based on `is_captain` field from API. Test opens challenge cards using `.challenge-card` or `[data-require-deploy="true"]`. If no challenges are present, contestant-side check is gracefully skipped, but admin-side assertion still runs.
- `limit_challenges` is a `type="number"` field with `min="1"`. Browser-side validation is not tested as form submits via AJAX.
- Run tests in **serial** mode – do not use `--workers` > 1 to avoid race conditions with global config changes.
- After running this suite, consider running `reset-contest.spec.ts` if contest time was affected by other tests.

---

### Admin Config Logo Tests (`admin-config-logo-test.spec.ts`)

| Test Case ID | Test Case Description | Test Case Procedure | Expected Results | Pre-conditions |
| --- | --- | --- | --- | --- |
| CONF-LOGO-001 | UI Rendering | Navigate to Logo tab. | Logo and Tab Icon sections are visible. | Admin login. |
| CONF-LOGO-002 | Logo Upload (JPG) | Upload `logo.jpg` and submit. | Preview appears, src contains `/files/`. | `logo.jpg` exists. |
| CONF-LOGO-003 | Logo Upload (PNG) | Upload `logo.png` and submit. | Preview updates to PNG, src contains `/files/`. | `logo.png` exists. |
| CONF-LOGO-004 | Logo Removal | Click "Remove Logo" and confirm. | Preview and remove button disappear. | Logo exists. |
| CONF-LOGO-005 | Tab Icon Upload (PNG)| Upload `logo.png` to Tab Icon and submit. | Preview appears in icon section. | `logo.png` exists. |
| CONF-LOGO-006 | Tab Icon Removal | Click "Remove Icon" and confirm. | Icon preview disappears. | Icon exists. |
| CONF-LOGO-007 | Contestant UI Sync | Upload logo, check contestant portal (login & dashboard). | Logo appears in header and login page. | `user2` login. |
| CONF-LOGO-008 | Security: Unauthorized Access | Navigate to logo config without login. | Redirected to login page. | - |
| CONF-LOGO-009 | Cleanup | Remove all uploaded assets. | Return to default state (no custom logo). | - |
| CONF-LOGO-011 | Security: Malicious File Upload | Attempt to upload `security_test.php`. | File is uploaded but **not executed**. | `security_test.php` exists. |

#### Technical Notes (Logo)
- **Bootstrap Modals**: The "Remove" actions trigger a custom Bootstrap modal (`ezQuery`). Playwright must click the "Yes" button in the modal footer rather than handling a native browser dialog.
- **Cache Clearing**: The Contestant Portal caches public configuration in `localStorage` for 5 minutes. Tests must clear `localStorage` and reload to verify logo changes immediately.
- **Security Finding (File Upload)**: The system allows uploading non-image extensions (like `.php`) for the logo. However, since the server is Python/Flask-based and serves files statically via `send_file`, the PHP code is treated as a binary stream and **never executed**, preventing RCE (Remote Code Execution).
- **Recommendation**: Implement backend validation to strictly allowed image mime-types (`image/png`, `image/jpeg`, etc.) to prevent potential XSS or storage cluttering.

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
18. admin-config-time-test.spec.ts
19. admin-config-general-test.spec.ts
20. admin-config-logo-test.spec.ts
21. reset-contest.spec.ts  ← run after 18-20 to restore contest time
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
