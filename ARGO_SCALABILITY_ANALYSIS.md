# FCTF Multi-Contest — Phân Tích & Giải Pháp Scalability Cho Argo Workflows

> **Ngày tạo:** 15/04/2026
> **Ngày cập nhật:** 19/04/2026
> **Version:** FCTF-Multiple_Contest
> **Mục tiêu:** Giải quyết bài toán quá tải khi hàng ngàn thí sinh từ nhiều cuộc thi khác nhau trigger việc Deploy Challenge (Start Pod) cùng lúc, dẫn đến "nghẽn cổ chai" tại Argo Workflows.

---

## 1. Bản Chất Của Điểm Nghẽn (Bottleneck)

Hệ thống FCTF-Multiple_Contest kế thừa luồng từ v5:
`Thí sinh` ➔ `RabbitMQ` ➔ `DeploymentConsumer` ➔ `Argo Workflows API` ➔ `K8s khởi tạo Pod`.

**Tại sao luồng này sẽ "sập" khi chạy Multi-Contest scale lớn?**

1. **Overhead của Argo:** Argo Workflows được thiết kế để chạy các job CI/CD phức tạp (nhiều steps, DAGs). Việc dùng Argo chỉ để *tạo một Pod challenge duy nhất* là "dùng dao mổ trâu giết gà". Mỗi lần chạy, Argo cần:
   - Lưu trạng thái vào database của nó (thuộc K8s etcd).
   - Tạo ra pod phụ (wait container, init container) để theo dõi.
2. **Kube-API Server Overload:** Argo liên tục gọi Kube-API để cập nhật trạng thái Workflow. Hàng ngàn workflow cùng chạy sẽ ddos chính Kube-API của cụm K3s.
3. **Database Etcd phình to:** Các workflow đã chạy xong nếu không được dọn dẹp ngay sẽ làm đầy bộ nhớ của cluster, khiến toàn bộ cụm Kubernetes bị chậm (timeout).
4. **RabbitMQ Backpressure:** Khi Argo xử lý không kịp, `DeploymentConsumer` bị block ➔ Message ứ đọng trên RabbitMQ ➔ Thí sinh bấm Start nhưng 5-10 phút sau pod mới chạy.
5. **Global quota không phân biệt contest:** `MAX_RUNNING_WORKFLOW` hiện tại là global — contest 1 có thể flood hết slot, contest 2 và 3 không submit được workflow nào (starvation).

---

## 2. Các Giải Pháp Tối Ưu (Từ Dễ Đến Khó)

Để xử lý, chúng ta cần áp dụng các tầng phòng thủ từ Application, Cấu hình đến Kiến trúc.

### 🌟 GIẢI PHÁP 1: Chuyển Đối Kiến Trúc (Game Changer - Khuyến nghị cao nhất)

**Bypass (Xuyên qua) Argo Workflows khi Start Challenge.**

- **Nhiệm vụ "Build Image" (khi Admin upload file):** VẪN dùng Argo Workflows (vì cần clone code, build docker, push registry).
- **Nhiệm vụ "Start Challenge" (khi Thí sinh chơi):** **BỎ Argo Workflows**. `DeploymentConsumer` sẽ gọi **trực tiếp K8s API** để tạo Pod (dùng `Kubernetes C# SDK` đã có sẵn trong FCTF).

**Vì sao giải pháp này tuyệt vời?**
- Tạo 1 Pod qua K8s API trực tiếp tốn `~50ms` và hoàn toàn stateless.
- Bỏ qua toàn bộ overhead của Argo. K8s Controller natvie siêu tối ưu cho việc tạo Pod.
- Chỉ cần cấu hình lại file `DeploymentConsumer/Services/ArgoWorkflowService.cs` thành `K8sDeploymentService.cs`.

*Hành động: Thay vì gửi JSON workflow cho Argo API, ta gửi JSON `V1Pod` trực tiếp cho `Kube-API`.*

---

### Giả sử vẫn PHẢI dùng Argo Workflows (hoặc áp dụng song song chờ Migrate)

Nếu chưa thể đổi code sang gọi trực tiếp K8s API ngay, hãy áp dụng các giải pháp 2, 3 và 4 dưới đây:

### 🌟 GIẢI PHÁP 2: Tuning Thông Số Của Argo Controller

Argo Controller mặc định cấu hình rất thấp an toàn. Bạn cần sửa K8s manifest của Argo:

```yaml
# Chỉnh sửa deployment của argo-server và workflow-controller
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workflow-controller
spec:
  template:
    spec:
      containers:
      - name: workflow-controller
        args:
        - --workflow-workers=100           # Tăng tử 32 (mặc định) lên 100 để xử lý song song nhiều WF
        - --qps=200                        # Tăng giới hạn gọi KubeAPI (QPS)
        - --burst=400                      # Tăng giới hạn burst gọi KubeAPI
        - --workflow-ttl-workers=30        # Tăng tốc độ dọn dẹp WF cũ
```

**Workflow TTL Strategy:** BẮT BUỘC cấu hình trong mẫu `START_CHALLENGE_TEMPLATE` để Argo tự xoá rác ngay lập tức:
```yaml
ttlStrategy:
  secondsAfterCompletion: 10   # Xóa workflow khỏi hệ thống sau 10s thành công (Pod thực tế của challenge không bị xóa)
  secondsAfterFailure: 60      # Giữ 60s để debug nếu lỗi
```

---

### 🌟 GIẢI PHÁP 3: Phân Luồng Ưu Tiên Bằng RabbitMQ (Priority Queues)

Chống nghẽn cục bộ bằng cách quy định **ưu tiên xử lý**.

1. Cấu hình Queue `deploy` thành **Priority Queue** (Max = 10).
2. Khi `DeploymentCenter` đẩy message vào:
   - Lệnh `STOP_CHALLENGE` ➔ Priority 10 (Cao nhất). Phải Stop trước để giải phóng RAM/CPU K8s.
   - Hành động từ CTFd Admin (Build image) ➔ Priority 8.
   - Thí sinh `START_CHALLENGE` (Contest VIP đang thi đấu) ➔ Priority 5.
   - Thí sinh `START_CHALLENGE` (Contest đã kết thúc, đang mở practice) ➔ Priority 1.

*RabbitMQ sẽ luôn giao việc có Priority cao cho Consumer xử lý trước.*

---

### 🌟 GIẢI PHÁP 4: Kubernetes Node Pool Separation

Trang bị "đường cao tốc riêng" cho hạ tầng quản lý.

- **System Node Pool:** Gồm các máy ảo chỉ để chạy `MariaDB`, `Redis`, `RabbitMQ`, `ContestantBE`, `Argo Controller`, `Kube-API`.
- **Challenge Node Pool:** Gồm các máy ảo (có auto-scaling) ĐỂ trống chỉ dành cho Challenge Pod của thí sinh.

Nếu người dùng tràn vào làm các máy chủ Challenge hết RAM (crashes), Argo Controller và Database nằm ở System Pool vẫn **sống sót và hoạt động trơn tru**, không bị hệ điều hành "OOM Killed" (Out Of Memory).

Dùng `nodeSelector` và `Tolerations` để ép challenge pod không bao giờ chạy chung node với hạ tầng core.

---

## 3. Tổng Kết Kiến Trúc Mở Rộng 

Để scale cho Multi-contest với 10,000+ người chơi, luồng tối ưu MỚI nên là:

```
Thí sinh Start
      ↓
ContestantBE (validate contest, rule, limit, etc)
      ↓
RabbitMQ (Bố trí Priority queue)
      ↓
DeploymentConsumer (Pull batch 50 message/lần)
      ↓
(X) BỎ bypass Argo Workflows
(V) GỌI trực tiếp K8s API (Tạo namespace, Nạp Quota, Khởi tạo Pod V1)
      ↓
Kube-Scheduler (K8s assign pod cực nhanh vào Worker nodes)
      ↓
DeploymentListener (Nhận event "Running" và báo Redis)
```

**Thành quả:**
- Thời gian launch challenge từ 10-15s (qua Argo) giảm xuống **1-2s** (K8s API native).
- K8s Cluster nhẹ gánh đi hàng chục ngàn Workflow không cần thiết (1 workflow = 1 pod control + 1 db object).
- Argo Workflows được trả về đúng tác dụng: Workflow CI/CD (phân quyền chỉ cho Admin build docker images).

---
*Phân tích cập nhật bởi Antigravity AI - 19/04/2026 — FCTF-Multiple_Contest*
