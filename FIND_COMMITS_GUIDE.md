# Hướng dẫn sử dụng công cụ tìm kiếm commit

## Giới thiệu

Script `find-commits.sh` là một công cụ để tìm kiếm các commit trong repository Git theo các chủ đề:
- **Security**: Các commit sửa lỗi bảo mật
- **Query**: Các commit tối ưu hóa truy vấn database
- **Performance**: Các commit cải thiện hiệu suất
- **Refactor**: Các commit tái cấu trúc code

## Cài đặt

Script không cần cài đặt thêm. Chỉ cần có Git đã được cài đặt trên hệ thống.

```bash
# Cấp quyền thực thi cho script
chmod +x find-commits.sh
```

## Cách sử dụng

### 1. Tìm tất cả các commit liên quan

```bash
./find-commits.sh all
```

Lệnh này sẽ tìm kiếm tất cả các commit liên quan đến security, query, performance, và refactor.

### 2. Tìm theo từng chủ đề cụ thể

#### Tìm các commit về Security

```bash
./find-commits.sh security
```

#### Tìm các commit về Query Optimization

```bash
./find-commits.sh query
```

#### Tìm các commit về Performance

```bash
./find-commits.sh performance
```

#### Tìm các commit về Refactoring

```bash
./find-commits.sh refactor
```

### 3. Hiển thị hướng dẫn

```bash
./find-commits.sh --help
```

## Từ khóa tìm kiếm

Script sử dụng các từ khóa sau để tìm kiếm commit:

### Security Keywords
- security, vulnerability, CVE
- XSS, CSRF, SQL injection
- authentication, authorization
- bảo mật, lỗ hổng, an ninh
- exploit, patch, hotfix
- sanitize, escape

### Query Keywords
- query, queries, SQL
- database, DB
- optimize query, query optimization
- truy vấn, cơ sở dữ liệu
- N+1, index

### Performance Keywords
- performance, optimize, optimization
- speed up, faster
- cache, caching
- memory leak
- hiệu suất, tối ưu, cải thiện
- latency, throughput

### Refactor Keywords
- refactor, refactoring
- restructure, cleanup
- improve code, code quality
- cấu trúc lại, tái cấu trúc
- simplify, rewrite

## Ví dụ kết quả

Khi tìm thấy commit, script sẽ hiển thị thông tin:

```
═══════════════════════════════════════════════════════════════
📋 Tìm kiếm commit về: SECURITY FIXES
═══════════════════════════════════════════════════════════════

Commit #1:
  Hash:    a1b2c3d
  Author:  John Doe
  Date:    2024-01-15
  Subject: Fix XSS vulnerability in user input

Commit #2:
  Hash:    e4f5g6h
  Author:  Jane Smith
  Date:    2024-01-20
  Subject: Patch SQL injection in login form

Tổng số commit tìm thấy: 2
```

## Tùy chỉnh

Bạn có thể tùy chỉnh script bằng cách:

1. **Thêm từ khóa mới**: Chỉnh sửa các mảng `SECURITY_KEYWORDS`, `QUERY_KEYWORDS`, `PERFORMANCE_KEYWORDS`, `REFACTOR_KEYWORDS` trong script.

2. **Thay đổi format hiển thị**: Chỉnh sửa hàm `search_commits()` để thay đổi cách hiển thị kết quả.

3. **Xuất kết quả ra file**: Thêm redirect output:
   ```bash
   ./find-commits.sh all > results.txt
   ```

## Lưu ý

- Script tìm kiếm trong commit message, không tìm trong nội dung code
- Tìm kiếm không phân biệt chữ hoa/chữ thường
- Hỗ trợ cả từ khóa tiếng Anh và tiếng Việt
- Tìm kiếm trên tất cả các branch trong repository

## Tích hợp vào CI/CD

Bạn có thể tích hợp script này vào pipeline CI/CD để tự động phân loại và báo cáo các commit:

```yaml
# Ví dụ GitHub Actions
- name: Find security commits
  run: |
    chmod +x find-commits.sh
    ./find-commits.sh security > security-commits.txt
```

## Troubleshooting

### Script báo lỗi "Không phải là git repository"

**Giải pháp**: Đảm bảo bạn đang chạy script trong thư mục chứa git repository (có thư mục `.git`).

### Không tìm thấy commit nào

**Giải pháp**: 
- Kiểm tra xem repository có commit nào không
- Thử tìm kiếm với từ khóa khác
- Kiểm tra commit message có chứa từ khóa tương ứng không

## Đóng góp

Để đóng góp cho script này:
1. Thêm từ khóa mới vào các mảng keyword
2. Cải thiện logic tìm kiếm
3. Thêm tính năng export ra các format khác (JSON, CSV, HTML)

## License

Script này là phần của FCTF Platform và được sử dụng theo license của project.
