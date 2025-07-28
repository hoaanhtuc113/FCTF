Dưới đây là tài liệu hướng dẫn cập nhật các cấu hình liên quan đến **unicorn**, **MySQL**, và **nginx** trong hệ thống dựa trên `docker-compose.yml` mà bạn đã cung cấp.

----------

## 🛠️ Cập nhật cấu hình hệ thống

### 1. **Tăng biến môi trường `WORKERS` cho Unicorn**

Trong service `ctfd`, ứng dụng đang sử dụng Unicorn để chạy web. Biến môi trường `WORKERS` quy định số lượng **process worker** để xử lý yêu cầu HTTP song song.

#### ✅ Việc đã thực hiện:

```yaml
environment:
  - WORKERS=150
````

#### 📌 WORKERS được tính bằng:

Số lượng `WORKERS` nên được xác định dựa trên công thức phổ biến:

```
WORKERS = 2 * số CPU core + 1
```

> Ví dụ: Nếu máy chủ có 4 core CPU → `WORKERS = 2*4 + 1 = 9`

Tuy nhiên, trong trường hợp tải lớn hoặc nhu cầu đặc biệt, bạn có thể điều chỉnh giá trị cao hơn như `150` (như đã cấu hình ở trên), nhưng cần giám sát tài nguyên để tránh quá tải hệ thống.

---

### 2. **Tăng `--max-connection=1000` cho MySQL (MariaDB)**

Dòng cấu hình dưới đây được thêm vào phần khởi động container `db` để tăng số lượng kết nối tối đa mà MySQL cho phép:

```yaml
command: [
  mysqld,
  --character-set-server=utf8mb4,
  --collation-server=utf8mb4_unicode_ci,
  --max-connection=1000,
  --wait_timeout=28800,
  --log-warnings=0
]
```

#### 🎯 Ý nghĩa:

* `--max-connection=1000`: Cho phép tối đa 1000 kết nối đồng thời đến MySQL.
* Nâng cao khả năng chịu tải cho các ứng dụng có nhiều người dùng đồng thời.

---

### 3. **Chặn `/socket.io` trong cấu hình Nginx**

Để ngăn truy cập đến endpoint `/socket.io`, bạn cần chỉnh sửa file `nginx.conf` (được mount vào container Nginx) như sau:

#### 🛑 Cách chặn đường dẫn `/socket.io`:

Thêm vào `server` block trong `nginx.conf`:

```nginx
location ~ ^/socket\.io {
	return 403;
}
```

> ✅ Đảm bảo phần này nằm **trước** các `location /` chung để ưu tiên chặn trước khi route tiếp.

---

## ⚙️ Khuyến nghị thêm về tài nguyên container

Để tránh nghẽn CPU trên một core khi tải tăng cao:

> **Các Docker container nên được cấu hình chạy với 2–3 core CPU thay vì chỉ 1 core.**
> Việc này giúp phân phối xử lý tốt hơn, giảm nguy cơ nghẽn cổ chai và tăng hiệu năng tổng thể của hệ thống.

---

## ✅ Tổng kết

| Thành phần           | Thay đổi chính                                                      |
| -------------------- | ------------------------------------------------------------------- |
| **ctfd**             | Tăng `WORKERS` lên 150 để xử lý nhiều request song song             |
| **db (MySQL)**       | Thêm `--max-connection=1000` để tăng giới hạn kết nối               |
| **nginx**            | Chặn truy cập `/socket.io` bằng cách deny trong config              |
| **docker container** | Cấu hình giới hạn tài nguyên để container dùng ít nhất 2–3 core CPU |

```