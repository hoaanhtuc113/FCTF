# Phân tích luồng hoạt động: Up Challenges và Bắt đầu Challenges

Tài liệu này đi sâu vào phân tích luồng logic của hai quá trình quan trọng trong FCTF: **Up Challenges** (Tải lên/Triển khai Challenge mới) và **Bắt đầu Challenges** (Thí sinh khởi tạo phiên bản challenge để thi đấu).

---

## 1. Luồng "Up Challenges" (Quản trị viên tải lên Challenge)

Luồng này được sử dụng khi quản trị viên (Admin/Challenge Creator) tải lên một file `.zip` chứa source code của challenge từ giao diện quản lý (CTFd) để hệ thống tự động build thành Docker image và lưu trữ.

### 📍 Các file code xử lý chính:
- **FCTF-ManagementPlatform**: `CTFd/plugins/upload_zip_files/routes.py`, `CTFd/utils/connector/multiservice_connector.py`
- **DeploymentCenter**: `Controllers/ChallengeController.cs`
- **K8s Manifest**: `prod/argo-workflows/up-challenge/up-challenge-template.yaml`

### 🛠️ Chi tiết luồng hoạt động (Logic Flow):

1. **Upload File ZIP từ Portal Quản trị:**
   - Quản trị viên sử dụng giao diện FCTF-ManagementPlatform (CTFd) để tải file `.zip` lên thông qua plugin `upload_zip_files`.
   - Request được tiếp nhận bởi endpoint trong file plugin: `FCTF-ManagementPlatform/CTFd/plugins/upload_zip_files/routes.py` (hàm `upload_file`).

2. **Xử lý giải nén và lưu trữ (NFS):**
   - Hàm `handle_challenge_upload` (trong `CTFd/utils/connector/multiservice_connector.py`) thực hiện giải nén file ZIP vào một thư mục tạm (`tempfile.mkdtemp()`).
   - Copy toàn bộ nội dung đã giải nén vào thư mục dùng chung qua hệ thống NFS: `/var/template_challenge/challenges/{tên_thư_mục}` (được định nghĩa qua biến môi trường `NFS_MOUNT_PATH`).
   - Hệ thống quét tìm vị trí file `Dockerfile` trong thư mục vừa giải nén.

3. **Gọi API DeploymentCenter để Build Image:**
   - CTFd sẽ tạo một POST request nội bộ gửi tới service **DeploymentCenter** thông qua API: `POST /api/challenge/upload` được định nghĩa trong hàm `prepare_up_challenge_payload`.
   - Payload bao gồm: `challengeId`, đường dẫn thư mục `challengePath` (trên NFS) và một `imageTag` duy nhất (dựa trên ID và timestamp).
   - Ở giai đoạn này, trạng thái challenge trong Database được chuyển thành `PENDING_DEPLOY` và `state` được set thành `hidden`.

4. **Kích hoạt Argo Workflows (Bởi DeploymentCenter):**
   - Tại `DeploymentCenter/Controllers/ChallengeController.cs` (hàm `SubmitUploadWorkflow`), request từ CTFd được tiếp nhận.
   - Backend C# sẽ tự động sinh ra một Argo Workflow request dạng `WorkflowTemplate` (từ template tên `up-challenge-template` lấy qua biến môi trường `UP_CHALLENGE_TEMPLATE`) và gọi trực tiếp lên **Argo Workflows API** (`/submit`) của cluster Kubernetes.

5. **Build & Push Image bằng Kaniko (Trên K8s):**
   - Argo Workflow sử dụng định nghĩa từ file `up-challenge-template.yaml` (nằm ở `FCTF-k3s-manifest/prod/argo-workflows/up-challenge/`).
   - Pod của Argo sẽ mount ổ đĩa NFS chứa source code vừa được CTFd copy sang.
   - Sử dụng **Kaniko** (`gcr.io/kaniko-project/executor`) để đọc `Dockerfile` trên NFS, tiến hành build Docker Image an toàn bên trong cluster mà không cần truy cập Docker daemon.
   - Sau khi build xong, Kaniko push image thẳng lên Docker Registry đã cấu hình (ví dụ: `quachuoiscontainer/fctf:challenge-{id}-{timestamp}`).

6. **Callback Cập nhật trạng thái:**
   - Trong `up-challenge-template.yaml`, bước `onExit` (gọi template `send-message`) sẽ chạy một container dùng curl để gửi POST request thông báo hoàn thành (kèm Status Succeeded/Failed và Type "up").
   - Request này gọi về Deployment Center `api/statuscheck/message`, sau đó hệ thống sẽ gọi cập nhật ngược lại CTFd thông qua `POST /challenges/update-info-by-cs` (trong file `routes.py`), chuyển trạng thái challenge sang hoàn tất (`DEPLOY_SUCCEEDED` hoặc báo lỗi `DEPLOY_FAILED`) để Admin có thể cấu hình tiếp.

---

## 2. Luồng "Bắt đầu Challenges" (Start Challenges)

Luồng này được kích hoạt khi thí sinh (người dùng) trên nền tảng thi đấu (Contestant Portal) bấm nút **Start Challenge** để yêu cầu hệ thống tạo một môi trường biệt lập (K8s Pod) dành riêng cho đội của họ.

### 📍 Các file code xử lý chính:
- **ContestantBE**: `ChallengeController.cs`, `ChallengeService.cs`
- **DeploymentCenter**: `ChallengeController.cs`, `DeployService.cs`
- **DeploymentConsumer**: `Worker.cs`
- **DeploymentListener**: (K8s Watcher xử lý cập nhật trạng thái)

### 🛠️ Chi tiết luồng hoạt động (Logic Flow):

1. **Xác thực và Kiểm tra Điều kiện:**
   - Thí sinh click "Start Challenge", giao diện gửi API tới **ContestantBE**: `POST /api/challenge/start`.
   - `ChallengeController.StartChallenge` thực hiện hàng loạt kiểm tra chặt chẽ:
     - User có tham gia team nào không?
     - Challenge này có yêu cầu Deploy không (`RequireDeploy`)?
     - Team đã giải xong challenge này chưa?
     - Số lượng instance hiện tại đang chạy có vượt quá giới hạn hệ thống cho phép đối với team/người dùng không?
     - Giới hạn số lần Start (Max Attempts, Max Deploy).
   - Hệ thống cấp một khóa **Redis lock** để tránh tình trạng race condition/spam click cùng lúc.

2. **Gọi Deployment Center:**
   - ContestantBE gọi API nội bộ sang **DeploymentCenter**: `POST /api/challenge/start` (được bảo vệ bằng chữ ký số `SecretKey` HMAC chứa timestamp và payload).

3. **Đưa vào Hàng đợi (RabbitMQ):**
   - Tại `DeploymentCenter` (`ChallengeController.cs` -> `DeployService.Start`), hệ thống tạo bộ nhớ đệm ban đầu trên Redis: set trạng thái là `PENDING_DEPLOY` (chờ triển khai).
   - Sau đó, một Message chứa yêu cầu deploy (`challengeId`, `teamId`, `userId`) được đẩy vào hệ thống hàng đợi **RabbitMQ** (Exchange: `deployment_exchange`, Queue: `deploy`). Việc dùng hàng đợi giúp hệ thống không bị quá tải nếu có hàng trăm team bấm start cùng lúc.

4. **Background Worker tiêu thụ Message:**
   - Project **DeploymentConsumer** chạy một Background Service ngầm (`Worker.cs`).
   - Vòng lặp `ExecuteAsync` liên tục kéo (pull) messages từ RabbitMQ theo dạng lô (Batch). Nó kiểm soát tài nguyên bằng cách kiểm tra số workflow đang chạy không được vượt quá `MAX_RUNNING_WORKFLOW`.
   - Khi xử lý message, hàm `ProcessAsync`:
     - Lấy thông tin cấu hình của challenge từ Database (Image link, giới hạn CPU, Memory Limit, có dùng gVisor không, Harden container không, ...).
     - Gọi hàm `ChallengeHelper.BuildArgoPayload` để tạo Payload động (JSON) định nghĩa luồng khởi tạo K8s Pod.
     - Gửi Payload này tới **Argo Workflows API** qua HTTP POST để yêu cầu K8s tạo một Namespace riêng biệt (VD: `deploy-challenge-{id}-team-{teamId}`) và tạo Challenge Pod bên trong đó từ Docker Image có sẵn.

5. **Theo dõi trạng thái và Trả URL cho Thí Sinh:**
   - Project **DeploymentListener** đóng vai trò là một Watcher chuyên giám sát sự kiện (event) của Kubernetes. 
   - Khi Pod được K8s tạo ra và chuyển sang trạng thái `Running` và tất cả các container bên trong đều `Ready`, Watcher này bắt được sự kiện.
   - Nó sẽ phân tích thông tin từ K8s Service tương ứng để trích xuất URL nội bộ hoặc cấu hình proxy, và cập nhật key Redis Cache `deploy_challenge_{id}_{teamId}` sang trạng thái `RUNNING` kèm địa chỉ `challenge_url`.
   - Trong suốt thời gian này, phía giao diện web (Contestant Portal) liên tục polling API gọi vào `ContestantBE` để lấy thông tin chi tiết challenge. Khi phát hiện `is_started=true` từ cache, giao diện sẽ hiển thị URL (kèm Token truy cập Gateway) để thí sinh có thể trực tiếp làm bài.

---

### 💡 Tổng kết kiến trúc

* **Luồng "Up Challenges":** Giải quyết bài toán **CI (Continuous Integration)**. Admin không cần can thiệp command line, chỉ việc upload file ZIP -> File chuyển vào Storage dùng chung (NFS) -> Argo + Kaniko build thành Docker Image an toàn trên Cluster K8s -> Đẩy về Registry tập trung.
* **Luồng "Start Challenges":** Giải quyết bài toán **Scale và Isolation (Cách ly)**. Hệ thống dùng RabbitMQ làm bộ đệm để chống ngập lụt request -> Background Worker tuần tự xử lý để đảm bảo Cluster K8s không sập -> Mỗi challenge cho mỗi đội được đặt trong một namespace K8s riêng với giới hạn CPU/RAM chặt chẽ để đảm bảo an toàn. Trạng thái sau đó được luân chuyển mượt mà qua K8s Watcher và Redis để phản hồi thời gian thực tới frontend.
