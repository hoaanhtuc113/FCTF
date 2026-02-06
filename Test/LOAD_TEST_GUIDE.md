# HƯỚNG DẪN CHẠY LOAD TEST VỚI PLAYWRIGHT

## 📋 MỤC LỤC
1. [Chuẩn bị](#chuẩn-bị)
2. [Cách chạy với 20 người dùng](#cách-chạy-với-20-người-dùng)
3. [Các tùy chọn nâng cao](#các-tùy-chọn-nâng-cao)
4. [Xem kết quả](#xem-kết-quả)
5. [So sánh K6 vs Playwright](#so-sánh-k6-vs-playwright)

---

## 🔧 CHUẨN BỊ

### 1. Cài đặt Playwright (nếu chưa có)
```bash
npm install -D @playwright/test
npx playwright install chromium
```

### 2. Đảm bảo có các user accounts
Bạn cần có 20 user accounts với username: `user1`, `user2`, ..., `user20` và password là `1`

---

## 🚀 CÁCH CHẠY VỚI 20 NGƯỜI DÙNG

### Lệnh cơ bản - Chạy với 20 workers song song
```bash
npx playwright test load-test.spec.ts --workers=20
```

### Chạy với headless mode (nhanh hơn, không mở trình duyệt)
```bash
npx playwright test load-test.spec.ts --workers=20 --headed=false
```

### Chạy với headed mode (xem trình duyệt)
```bash
npx playwright test load-test.spec.ts --workers=20 --headed
```

### Chạy với timeout tùy chỉnh (15 phút như K6)
```bash
npx playwright test load-test.spec.ts --workers=20 --timeout=900000
```

### Chạy và lưu video khi có lỗi
```bash
npx playwright test load-test.spec.ts --workers=20 --video=retain-on-failure
```

---

## ⚙️ CÁC TÙY CHỌN NÂNG CAO

### 1. Cấu hình trong playwright.config.ts

Bạn có thể tạo file `playwright.config.ts` với cấu hình load test:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './Test',
  testMatch: 'load-test.spec.ts',
  
  // Chạy song song tối đa
  workers: 20,
  
  // Timeout cho mỗi test (15 phút)
  timeout: 15 * 60 * 1000,
  
  // Không retry khi fail
  retries: 0,
  
  use: {
    // Headless mode
    headless: true,
    
    // Screenshot khi fail
    screenshot: 'only-on-failure',
    
    // Video khi fail
    video: 'retain-on-failure',
    
    // Viewport
    viewport: { width: 1280, height: 800 },
  },
  
  // Reporter để xuất kết quả
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/load-test-results.json' }],
    ['junit', { outputFile: 'test-results/load-test-results.xml' }],
  ],
});
```

Sau đó chạy:
```bash
npx playwright test
```

### 2. Chạy với số lượng workers khác

**5 người dùng:**
```bash
npx playwright test load-test.spec.ts --workers=5
```

**10 người dùng:**
```bash
npx playwright test load-test.spec.ts --workers=10
```

**50 người dùng:**
```bash
npx playwright test load-test.spec.ts --workers=50
```

### 3. Chạy liên tục trong thời gian nhất định

Để mô phỏng K6 với `duration: '15m'`, bạn có thể:

**Option 1: Sử dụng vòng lặp trong code**
- Script hiện tại đã có vòng lặp với `maxIterations = 100`
- Bạn có thể điều chỉnh số này hoặc loại bỏ giới hạn

**Option 2: Chạy script nhiều lần**
```bash
# Chạy trong 15 phút
$endTime = (Get-Date).AddMinutes(15)
while ((Get-Date) -lt $endTime) {
    npx playwright test load-test.spec.ts --workers=20
}
```

---

## 📊 XEM KẾT QUẢ

### 1. Metrics được lưu tự động

Sau khi chạy, 2 file sẽ được tạo trong thư mục `Test`:
- `load-test-metrics.json` - Dữ liệu chi tiết dạng JSON
- `load-test-metrics.csv` - Dữ liệu dạng CSV để import vào Excel

### 2. Xem HTML Report của Playwright
```bash
npx playwright show-report
```

### 3. Phân tích metrics

**Xem file CSV trong Excel:**
```bash
start load-test-metrics.csv
```

**Xem file JSON:**
```bash
cat load-test-metrics.json
```

### 4. Console logs

Trong quá trình chạy, bạn sẽ thấy logs như:
```
[user1] login: 1234ms
[user2] login: 1456ms
[user1] load_scoreboard: 567ms
[user3] login: 1345ms
...
```

---

## 🔄 SO SÁNH K6 VS PLAYWRIGHT

### Sự khác biệt chính:

| Feature | K6 | Playwright |
|---------|----|-----------| 
| **Số người dùng** | `vus: 20` | `--workers=20` |
| **Thời gian chạy** | `duration: '15m'` | Sử dụng vòng lặp hoặc script wrapper |
| **Metrics** | Built-in Trends | Tự implement và xuất JSON/CSV |
| **Headless** | `headless: false` | `--headed=false` |
| **Browser type** | `chromium` | Playwright hỗ trợ chromium, firefox, webkit |
| **Report** | Built-in HTML | Playwright HTML reporter + custom JSON/CSV |

### Ưu điểm của Playwright:
✅ Tích hợp tốt với TypeScript  
✅ Debugging dễ dàng hơn  
✅ Trace viewer mạnh mẽ  
✅ Screenshot & video recording tốt hơn  
✅ Selector engine mạnh mẽ hơn  

### Ưu điểm của K6:
✅ Được thiết kế đặc biệt cho load testing  
✅ Metrics và reporting built-in tốt hơn  
✅ Hỗ trợ distributed testing  
✅ Ít tốn tài nguyên hơn  

---

## 🎯 ví dụ các lệnh thường dùng

### Development - Xem trình duyệt, ít người dùng
```bash
npx playwright test load-test.spec.ts --workers=3 --headed --timeout=300000
```

### Testing - Headless, vừa phải
```bash
npx playwright test load-test.spec.ts --workers=10 --timeout=600000
```

### Production Load Test - 20 người, headless, 15 phút
```bash
npx playwright test load-test.spec.ts --workers=20 --timeout=900000
```

### Debug một worker cụ thể
```bash
npx playwright test load-test.spec.ts --workers=1 --debug
```

### Chạy với trace (để debug sau)
```bash
npx playwright test load-test.spec.ts --workers=20 --trace=on
# Xem trace:
npx playwright show-trace test-results/<test-id>/trace.zip
```

---

## 💡 GỢI Ý TỐI ƯU

### 1. Tối ưu performance
- Sử dụng `headless: true` cho load test thực tế
- Giảm `waitForTimeout` nếu có thể
- Sử dụng `Promise.all()` cho các tác vụ song song

### 2. Monitoring
```typescript
// Thêm vào test để monitor resource usage
console.log(`Memory: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
```

### 3. Gradual ramp-up
Nếu muốn tăng dần số người dùng:
```bash
# 5 người
npx playwright test load-test.spec.ts --workers=5
# Chờ 2 phút
# 10 người  
npx playwright test load-test.spec.ts --workers=10
# Chờ 2 phút
# 20 người
npx playwright test load-test.spec.ts --workers=20
```

---

## ❓ TROUBLESHOOTING

### Lỗi: "Browser closed unexpectedly"
- Giảm số workers: `--workers=10`
- Tăng timeout: `--timeout=1200000`

### Lỗi: "Too many open files"
- Chạy ít workers hơn
- Trên Linux: `ulimit -n 4096`

### Lỗi: "Out of memory"
- Giảm số workers
- Sử dụng headless mode
- Tắt video recording

### Tests chạy quá chậm
- Sử dụng `headless: true`
- Giảm `waitForTimeout`
- Kiểm tra network speed

---

## 📧 HỖ TRỢ

Nếu có vấn đề, kiểm tra:
1. Playwright version: `npx playwright --version`
2. Node version: `node --version`
3. Xem logs chi tiết: `DEBUG=pw:api npx playwright test load-test.spec.ts --workers=20`
