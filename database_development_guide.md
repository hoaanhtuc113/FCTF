# Hướng dẫn Cập nhật Database Schema & Phát triển Tính năng mới
Dự án **FCTF-Multiple_Contest** sử dụng kiến trúc chia sẻ Database (Shared Database) giữa hai hệ thống chính:
1. **FCTF-ManagementPlatform**: Viết bằng Python/Flask, đóng vai trò quản lý chính và **nắm quyền thay đổi cấu trúc database** (thông qua Alembic/Flask-Migrate).
2. **ControlCenterAndChallengeHostingServer**: Cụm microservices viết bằng C# (.NET Core), ánh xạ chung vào một Database với hệ thống Python thông qua Entity Framework Core.

Để đảm bảo hệ thống không bị lỗi khi phát triển tính năng mới, bạn **bắt buộc** phải tuân thủ quy trình dưới đây khi muốn thêm/sửa bảng hoặc cột.

---

## Bước 1: Khởi động Hạ tầng Local (Database & Cache)
Trước khi làm việc với Database, bạn cần đảm bảo MariaDB và Redis ở local đang chạy bình thường.

1. Mở ứng dụng **Docker Desktop** trên máy.
2. Mở Terminal ở thư mục gốc của dự án (`FCTF-Multiple_Contest`) và chạy lệnh:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
   *(Lệnh này sẽ khởi chạy MariaDB, Redis và RabbitMQ).*

---

## Bước 2: Thay đổi Schema từ phía Python (Nơi gốc)
Mọi thay đổi cấu trúc Database (Schema) **phải được thực hiện từ FCTF-ManagementPlatform**. Không dùng EF Migrations bên phía C#.

1. Di chuyển vào thư mục FCTF-ManagementPlatform:
   ```bash
   cd FCTF-ManagementPlatform
   # Kích hoạt môi trường ảo
   .\venv\Scripts\activate
   ```
2. Mở file định nghĩa Model: `CTFd/models/__init__.py` (hoặc các file model tương ứng).
3. **Thêm/Sửa đổi code Python:**
   - Ví dụ: Thêm cột `phone_number` vào bảng `Users`:
     ```python
     class Users(db.Model):
         # ... code hiện tại ...
         phone_number = db.Column(db.String(20), nullable=True)
     ```

---

## Bước 3: Tạo và Kiểm tra file Migration (QUAN TRỌNG)
Sau khi sửa code Python xong, bạn cần yêu cầu Alembic sinh ra file script nâng cấp Database.

1. Chạy lệnh sinh file migrate:
   ```bash
   flask db migrate -m "Them cot phone_number vao bang Users"
   ```
2. **⚠️ BƯỚC KIỂM TRA BẮT BUỘC:** 
   Công cụ autogenerate đôi khi nhận diện sai và cố xóa các index của Khóa ngoại (Foreign Key). Bạn cần mở file python mới vừa được sinh ra trong thư mục `migrations/versions/`.
   - Xem nội dung hàm `upgrade()`.
   - **Xóa hoặc comment** toàn bộ những dòng lệnh dạng `op.drop_index(...)` nếu bạn không cố ý xóa chúng.
   - Chỉ giữ lại những lệnh đúng mục đích, ví dụ: `op.add_column('users', sa.Column('phone_number', ...))`

---

## Bước 4: Áp dụng thay đổi vào Database
Khi đã dọn dẹp file Migration xong, bạn chạy lệnh sau để áp dụng vào MariaDB:
```bash
python manage.py db upgrade
```
*Nếu thành công, bảng trong MariaDB của bạn đã có thêm các thay đổi mới.*

---

## Bước 5: Đồng bộ Model sang hệ thống C#
Bây giờ cấu trúc Database đã thay đổi, hệ thống C# cũng cần được khai báo để có thể đọc/ghi được dữ liệu mới đó.

1. Mở thư mục chứa các Models của C#: `ControlCenterAndChallengeHostingServer/ResourceShared/Models/`.
2. Tìm file class tương ứng (Ví dụ: `User.cs`).
3. Thêm Property mới vào class. Chú ý sử dụng Attribute để map đúng tên cột (vì Python dùng `snake_case` còn C# dùng `PascalCase`):
   ```csharp
   using System.ComponentModel.DataAnnotations.Schema;

   public class User 
   {
       // ... các property cũ ...

       [Column("phone_number")]
       public string? PhoneNumber { get; set; }
   }
   ```
4. Nếu thay đổi có liên quan đến khóa ngoại hoặc quan hệ phức tạp, cập nhật thêm file `AppDbContext.cs` trong cùng thư mục.

---

## Bước 6: Phát triển Logic và API
Sau khi hoàn thiện Model ở cả 2 bên:
- **Tính năng Admin:** Viết Logic, Route và API tại `FCTF-ManagementPlatform` (Python).
- **Tính năng dành cho Contestant / Deployment:** Viết tại các Controller, Service trong `ControlCenterAndChallengeHostingServer\ContestantBE` (C#).

---

## Bước 7: Cập nhật Document Hệ thống
Nếu tính năng mới của bạn làm thay đổi luồng nghiệp vụ hoặc quan hệ các bảng quan trọng, hãy cập nhật lại file `database-schema-multiple-contest.md` ở thư mục gốc để team dễ dàng theo dõi sau này.
