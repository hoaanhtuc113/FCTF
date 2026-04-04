# SystemTest-Nhat — Playwright Admin Test Suite

Bộ test tự động cho các luồng admin của FCTF. Toàn bộ thiết lập (Playwright, config, runner) nằm trong thư mục `SystemTest-Nhat` và **không phụ thuộc** vào bất kỳ file config hay `node_modules` nào bên ngoài thư mục này.

---

## Yêu cầu

| Công cụ | Phiên bản tối thiểu |
|---------|---------------------|
| Node.js | 18 LTS trở lên |
| npm     | đi kèm Node.js     |

FCTF phải đang chạy và có thể truy cập qua trình duyệt trước khi chạy test.

---

## Cài đặt (chỉ cần làm 1 lần)

```powershell
# Đứng trong thư mục này
cd "FCTF\Test\SystemTest-Nhat"

# Cài dependency (Playwright và trình duyệt Chromium)
npm install
npm exec playwright install chromium
```

---

## Chạy toàn bộ test và xuất HTML report

```powershell
npm test
```

Lệnh này sẽ:
1. Chạy tất cả 42 file test theo thứ tự đã định nghĩa trong `run-ordered-tests.js`
2. `uc03-create-challenge` chạy **cuối cùng**
3. Tự động tạo HTML report tại `playwright-report/index.html`

---

## Xem HTML Report

Sau khi chạy xong, mở report bằng một trong hai cách:

**Cách 1 — dùng npm script (mở trình duyệt tự động):**
```powershell
npm run test:report
```

**Cách 2 — dùng helper dòng lệnh tùy chỉnh** (tránh phải nhớ tham số):
```powershell
# tạo lần đầu (đã có sẵn trong repo)
cd FCTF\Test\SystemTest-Nhat
show-report.cmd
```
Nó gọi `npx playwright show-report` với `--port=0` để lấy một cổng trống tự động. Muốn cố định thì truyền `show-report.cmd 9330`.

*Nếu bạn vẫn gọi `npx playwright show-report` trực tiếp, chỉ cần thêm `--port=0` để ngăn lỗi EADDRINUSE.*
**Cách 2 — mở file trực tiếp:**
```
FCTF\Test\SystemTest-Nhat\playwright-report\index.html
```
(Mở file này bằng bất kỳ trình duyệt nào)

---

## Chạy chế độ có giao diện (headed)

```powershell
npm run test:headed
```

---

(dùng chung 1 config duy nhất)

```powershell
npm run test:uc03
```

Headed mode:

```powershell
npm run test:uc03:headed
```

---

## Chạy một file test riêng lẻ

```powershell
npm exec playwright test tests/uc28-view-users.spec.ts --config playwright.config.ts
```

---

## Thứ tự chạy (run-ordered-tests.js)

| Thứ tự | File |
|--------|------|
| 1 | uc04-edit-challenge-usecases |
| 2 | uc05-delete-challenge-usecases |
| 3 | uc13-challenge-version-usecases |
| 4 | uc16-change-scoreboard-visibility-usecases |
| 5 | uc23-query-reward |
| 6 | uc24-filter-history |
| 7 | uc25-view-instance-history |
| 8 | uc26-view-audit-logs |
| 9 | uc28-view-users |
| 10 | uc30-edit-user |
| 11 | uc31-delete-user |
| 12 | uc37-view-teams |
| 13 | uc39-edit-team |
| 14 | uc40-delete-team |
| 15 | uc42-search-team |
| 16 | uc43-view-submissions |
| 17 | uc44-delete-submission |
| 18 | uc45-search-submission |
| 19 | uc46-change-submission-status |
| 20 | uc63-comment |
| 21 | uc64-assign-captain |
| 22 | uc65-view-user-solves |
| 23 | uc66-view-team-solves |
| 24 | uc67-view-user-fails |
| 25 | uc68-view-team-fails |
| 26 | uc69-view-user-award |
| 27 | uc70-view-team-award |
| 28 | uc71-delete-solved-submission |
| 29 | uc72-delete-failed-submission |
| 30 | uc73-delete-award |
| 31 | uc74-view-team-missings |
| 32 | uc75-view-brackets |
| 33 | uc76-create-bracket |
| 34 | uc77-update-bracket |
| 35 | uc78-delete-bracket |
| 36 | uc79-view-custom-fields |
| 37 | uc80-create-custom-field |
| 38 | uc81-update-custom-field |
| 39 | uc82-delete-custom-field |
| 40 | uc83-config-sanitize |
| 41 | uc84-pause-contest |
| **42 (cuối)** | **uc03-create-challenge** |

Các file spec mới thêm vào thư mục `tests/` mà chưa có trong danh sách trên sẽ tự động được chạy sau file cuối cùng trong danh sách.

---

## Cấu trúc thư mục

```
SystemTest-Nhat/
├── playwright.config.ts      # Config Playwright (self-contained)
├── run-ordered-tests.js      # Runner điều phối thứ tự chạy
├── package.json              # Dependencies và npm scripts
├── assets/                   # Test assets local (PDF/ZIP...) dùng cho upload
├── tests/
│   ├── support.ts            # Hàm tiện ích dùng chung
│   └── uc*.spec.ts           # Các file test
├── playwright-report/        # HTML report (được tạo sau khi chạy)
└── test-results/             # Trace, screenshot, video khi test lỗi

---

## Tính di động của thư mục

Để copy nguyên thư mục `SystemTest-Nhat` sang project khác và chạy được ngay:

1. Chỉ dùng **một** config: `playwright.config.ts`
2. Đặt toàn bộ file upload test vào `SystemTest-Nhat/assets` (hoặc root `SystemTest-Nhat`)
3. Không đặt dependency test assets ở thư mục cha
```

---

## Performance Test (k6) - 500 tài khoản trong 1 giờ

Thư mục này đã có sẵn bộ k6 riêng để mô phỏng 500 contestant account thật truy cập Contestant Portal trong khoảng 1 giờ.

### File chính

- `k6/contestant-500-1h.js`: Kịch bản load test (5m ramp-up, 50m giữ 500 VU, 5m ramp-down)
- `k6/run-500-1h.ps1`: Runner chính, kiểm tra đủ 500 account và xuất report
- `k6/accounts-template-500.csv`: Mẫu 500 dòng account
- `k6/generate-accounts-template.ps1`: Script sinh nhanh file CSV theo số lượng

### 1) Cài k6

```powershell
winget install k6
```

### 2) Chuẩn bị file account thật

```powershell
cd "FCTF\Test\SystemTest-Nhat"
Copy-Item .\k6\accounts-template-500.csv .\k6\accounts.csv
```

Sau đó thay thông tin trong `k6/accounts.csv` bằng tài khoản thật.

Format bắt buộc:

```csv
username,password
contestant001,realPassword1
contestant002,realPassword2
```

### 3) Chạy test 1 giờ với 500 account

```powershell
powershell -ExecutionPolicy Bypass -File .\k6\run-500-1h.ps1 `
	-BaseUrl "https://api0.fctf.site" `
	-AccountsCsv ".\k6\accounts.csv" `
	-TargetVus 500
```

### 4) Kết quả report

Sau khi chạy xong, kết quả nằm trong `k6-results/`:

- `k6-summary-<timestamp>.json`: dữ liệu đầy đủ từ k6
- `k6-console-<timestamp>.log`: log console
- `k6-report-<timestamp>.md`: báo cáo tóm tắt (p95, p99, avg, error rate, req/s)

### Lưu ý vận hành

- Chỉ chạy trên môi trường staging/perf, tránh chạy trực tiếp production khi chưa có phê duyệt.
- Cần tối thiểu 500 account hợp lệ; script sẽ tự fail nếu file thiếu account.
- Bộ test ưu tiên luồng đọc dữ liệu contestant portal, phù hợp đo độ trễ phản hồi hệ thống và DB dưới tải cao.
