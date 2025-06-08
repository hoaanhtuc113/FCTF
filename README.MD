# FCTF Platform - Tổng Quan & Hướng Dẫn Sử Dụng

## 1. Giới thiệu các thành phần chính

### 1. ContestantPlatform
- **Vị trí:** `ContestantPlatform/`
- **Chức năng:** Giao diện web dành cho thí sinh tham gia CTF, nơi hiển thị các thử thách, nộp flag, xem bảng điểm, v.v.
- **Công nghệ:** Frontend sử dụng Vite, TailwindCSS, Node.js.

### 2. ControlCenterAndChallengeHostingServer
- **Vị trí:** `ControlCenterAndChallengeHostingServer/`
- **Chức năng:** 
  - `ControlCenterServer`: Quản lý trung tâm, điều phối các server challenge, xác thực, quản lý user, v.v.
  - `ChallengeManagementServer`: Quản lý, deploy, kiểm tra trạng thái các challenge.
  - `ResourceShared`: Chứa các thư viện, resource dùng chung cho 2 server trên.
- **Công nghệ:** .NET 8, C#, self-contained Linux build.

### 3. ctf-directory
- **Vị trí:** `ctf-directory/`
- **Chức năng:** 
  - Chứa các challenge, cấu hình kCTF, các script và tài nguyên phục vụ cho việc deploy challenge.
  - Thư mục `kctf/` chứa môi trường và công cụ kCTF (Kubernetes CTF framework).
  - File `components.yaml` định nghĩa các thành phần của hệ thống.

### 4. FCTF-ManagementPlatform
- **Vị trí:** `FCTF-ManagementPlatform/`
- **Chức năng:** 
  - Quản lý các dịch vụ Docker (Redis, backend, frontend, ...).
  - Chứa file cấu hình `.env`, `docker-compose.yml` để orchestrate toàn bộ hệ thống.

---

## 2. Hướng dẫn sử dụng `manage.sh`

### 2.1. Chuẩn bị môi trường

- Đảm bảo đã cài đặt các công cụ: Docker, Docker Compose, Node.js, .NET 8, Python3, pip3, kubectl.
- Nếu chưa, có thể chạy:
  ```sh
  ./manage.sh dev check-env
  ```

### 2.2. Các lệnh chính

```sh
./manage.sh <môi trường> <lệnh>
```
- `<môi trường>`: `dev`, `uat`, hoặc `production`
- `<lệnh>` gồm:
  - `up` : Khởi động toàn bộ hệ thống (Docker, ChallengeHosting, ControlCenter)
  - `down` : Dừng và xóa toàn bộ dịch vụ Docker
  - `build` : Build và publish ứng dụng .NET (ChallengeHosting và ControlCenter)
  - `check-env` : Kiểm tra môi trường và cài đặt các công cụ cần thiết nếu chưa có
  - `restart` : Khởi động lại toàn bộ hệ thống
  - `logs` : Hiển thị log của các container Docker trong FCTF-ManagementPlatform
  - `rebuild [no-cache]` : Rebuild Docker image (thêm 'no-cache' để không dùng cache)
  - `status` : Kiểm tra trạng thái các container, tiến trình .NET và k8s proxy
  - `clean` : Xóa các file build và container/image Docker
  - `check-config` : Kiểm tra nội dung file appsettings.json và .env

### 2.3. Quy trình khởi động hệ thống mẫu

1. **Kiểm tra/cài đặt môi trường:**
   ```sh
   ./manage.sh dev check-env
   ```

2. **Build ứng dụng:**
   ```sh
   ./manage.sh dev build
   ```

3. **Khởi động hệ thống:**
   ```sh
   ./manage.sh dev up
   ```

4. **Xem trạng thái hệ thống:**
   ```sh
   ./manage.sh dev status
   ```

5. **Xem log các container:**
   ```sh
   ./manage.sh dev logs
   ```

6. **Dừng hệ thống:**
   ```sh
   ./manage.sh dev down
   ```

7. **Làm sạch hệ thống (xóa build, container, image):**
   ```sh
   ./manage.sh dev clean
   ```

---

## 3. Lưu ý

- Khi chạy ở môi trường `production`, script sẽ yêu cầu nhập domain cho ChallengeHosting và ControlCenter.
- Các file cấu hình chính sẽ được tự động cập nhật khi chạy các lệnh build/up.
- Đảm bảo quyền truy cập Docker và các port không bị chiếm dụng bởi tiến trình khác.

---

## 4. Tham khảo thêm

- [ContestantPlatform](ContestantPlatform/)
- [ControlCenterAndChallengeHostingServer](ControlCenterAndChallengeHostingServer/)
- [ctf-directory](ctf-directory/)
- [FCTF-ManagementPlatform](FCTF-ManagementPlatform/)
- [manage.sh](manage.sh)