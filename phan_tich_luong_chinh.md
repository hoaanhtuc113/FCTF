
# KIẾN TRÚC HỆ THỐNG

## 1. Contestant

Contestant sẽ truy cập vào **Constestant-Portal UI**.  
Tại đây, contestant đăng nhập thông qua **Challenge-Gateway** sử dụng JWT, kết hợp rate limit ở Redis để điều hướng tới backend.

Backend của contestant sẽ gọi các **Challenge API** (như start, nộp flag).

Khi thực hiện start hoặc submit challenge:
- Gọi đến **Deploy-Center** để gửi yêu cầu
- Đẩy request vào **RabbitMQ**
- Gọi **Argo Workflow** để xử lý
- Có thể xem logs của pods và workflow

Sau đó:
- **Deployment-Consumer** đọc batch từ queue
- Gọi **Argo Workflows** để submit workflow
- Argo sẽ:
  - Start challenge
  - Build/push image lên K8S
  - Tạo pod để deploy challenge

Cuối cùng, contestant truy cập vào từng pod thông qua gateway để làm bài.

---

## 2. Admin

Kiến trúc tương tự contestant, nhưng sử dụng **Admin-MVC** thay vì contestant-portal.

---

# HẠ TẦNG

Sử dụng hạ tầng **K3S**.

## Các namespace:

### 1. App
Chịu trách nhiệm:
- Admin-MVC  
- ContestBE  
- ContestPortal  
- Challenge-Gateway  
- Deploy-Center  
- Deploy-Consumer  
- Listener  

### 2. DB
Quản lý:
- MariaDB  
- Redis  
- RabbitMQ  
- (chủ yếu chạy Helm, Redis bổ sung ACL)

### 3. Challenge
Quản lý các pod challenge

### 4. Argo
Chịu trách nhiệm Argo Workflow

### 5. Storage
- Filebrowser

### 6. Monitoring
- Prometheus  
- Grafana  
- Loki (theo dõi log)

---

# PHÂN TÍCH LUỒNG START CHALLENGE

## Thành phần

- contestantportal: FE cho thí sinh  
- challenge gateway: proxy/gateway vào các challenge pod  
- contestantBE: backend API chính  
- deploymentcenter: nhận yêu cầu deploy và đẩy vào queue  
- deploymentconsumer: xử lý queue và gọi Argo Workflow  
- argo workflow: điều hướng tạo pod challenge  
- deploymentlistener: theo dõi event pod K8S  
- fctf-managementplatform: quản lý thông tin challenge  
- redis: lưu trạng thái deployment và rate limit  
- Kubernetes: thực thi  

---

## Quy trình chi tiết

### 1. Validate request

Request đến `/api/challenge/start`:

- Lấy userId từ JWT
- Kiểm tra team
- Kiểm tra challenge tồn tại, trạng thái, visibility

### 2. Kiểm tra điều kiện

- Điều kiện tiên quyết
- maxAttempt
- maxDeployCount
- Quyền captain (chỉ đội trưởng được start)

### 3. Check limit bằng Redis

- Giới hạn số challenge chạy đồng thời
- Redis single-threaded → tránh race condition

### 4. Chuẩn bị payload

- Thông tin challenge, user, team
- Tạo HMAC xác thực giữa các service
- Gọi deploymentcenter qua `executeRequest`

---

## 5. Xử lý tại Deployment Center

- Xác thực HMAC
- Validate challengeId
- Giao logic cho deployservice

### Deploy Service xử lý trạng thái:

- **pending**: đang build → nếu fail thì xóa cache và deploy lại  
- **running**: đã chạy → không deploy thêm  
- **stopped**: pod đã xóa nhưng cache còn  

Nếu không thuộc các trường hợp trên:
- Gọi `EnqueueDeploymentAsync`
- Update Redis → status = `pending-deploy`

---

## 6. Deployment Consumer

- Chạy loop liên tục (`isCancellationRequest`)
- Kiểm tra tải Argo:
  - >30 → bỏ qua
  - <30 → xử lý

### Xử lý:

- Lấy dữ liệu challenge từ DB
- Xác định resource limit
- Build payload (namespace + JSON)
- Submit Argo Workflow
- Argo tạo:
  - Pod
  - Namespace
  - Service

- Ack message (`ackasync`)
- Update Redis

---

## 7. Watcher K8S

Theo dõi event pod:

- **pod running** → pod sẵn sàng (~30–60s)  
- **pod delete** → giải phóng Redis, xóa cache, ghi DB  
- **pod ghost** → pod chạy nhưng Redis mất cache → xóa  
- **pod stuck** → lỗi image → xóa  
- **reconciliation**:
  - Listener mất kết nối
  - Reconnect → sync lại DB với K8S  

---

## 8. Trả kết quả

Controller kiểm tra khi pod sẵn sàng → trả URL cho contestant.

---

# PHÂN TÍCH LUỒNG UPLOAD CHALLENGE

## 1. Upload file

Xử lý tại:
`CTFd/api/v1/file.py` (hàm POST)

Kiểm tra:
- required_deploy  
- expose_port  
- challenge_id  

Nếu cần deploy:
- Lưu file tạm vào `/tmp`

---

## 2. Bảo mật Path Traversal

Ví dụ tấn công:
```

../../../etc/passwd

```

Giải pháp:
- Dùng `secure_filename` (werkzeug.utils)
- Loại bỏ ký tự nguy hiểm

Ví dụ:
```

../../../etc/passwd → etc_passwd

```

→ Lưu thành:
```

/tmp/etc_passwd

```

---

## 3. Lý do dùng `/tmp`

- File zip lớn
- Cần đường dẫn thực để:
  - Giải nén
  - Validate
- Sau khi xử lý → xóa ở `finally`

---

## 4. Gọi upload_helper

```

upload_helper.upload_file()

```

---

## 5. Xử lý upload_file

File:
`CTFd/plugins/upload_zip_files/routes.py`

- Xóa cache Redis liên quan
- Tránh dữ liệu cũ gây sai trạng thái

---

## 6. Xử lý ZIP

File:
`CTFd/utils/connector/multiservice_connector.py`

### Các bước:

- Tạo thư mục tạm (`tempfile.mkdtemp`)
- Giải nén zip
- Kiểm tra bằng `.testzip()`

Ngăn:
- Zip bomb (file nhỏ → giải nén cực lớn)

---

## 7. Lưu vào NFS

- Copy từ `/tmp` → `NFS_MOUNT_PATH`
- Dùng `shutil.copytree`
- Lưu path vào DB (`challenge.deploy_file`)

---

## 8. Tìm Dockerfile

- Duyệt bằng `os.walk()`
- Lấy path Dockerfile

---

## 9. Gửi build request

- Tạo image tag
- Dùng HMAC xác thực
- Gửi request POST tới Argo/K8S

---

## 10. Argo Workflow

- Nhận request build
- Build container (~5 phút)
- Lưu `workflow_name` vào Redis
- Web platform polling trạng thái

---

## 11. Cập nhật trạng thái

- Set `deploy_pending`
- Ẩn challenge khỏi contestant

---

## 12. Version control

- Deactivate version cũ trong DB
- Cho phép rollback

---

## 13. Hoàn tất

- Commit DB
- Xóa thư mục tạm
