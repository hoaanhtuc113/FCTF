# FCTF Deployment Options — Hướng Dẫn Deploy Cho Dev/Test

## Tổng Quan

Project FCTF gồm **7 microservices** (4 ngôn ngữ) + infrastructure stack nặng (MariaDB, Redis, RabbitMQ, Argo Workflows, NFS). Tùy mục đích test/dev, bạn có 3 option sau:

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| **Tên** | Local Dev (Native) | Single-Node K3s | Multi-Node K3s (Cloud) |
| **Môi trường** | Windows/macOS trực tiếp | WSL2 / VirtualBox VM | 2+ Cloud VMs (GCP/AWS/Azure) |
| **Độ khó** | ⭐ Dễ | ⭐⭐ Trung bình | ⭐⭐⭐ Phức tạp |
| **Thời gian setup** | ~15-30 phút | ~45-60 phút | ~60-90 phút |
| **Phù hợp cho** | Dev features, debug code | Test integration, K8s behavior | Staging, load test, demo |
| **Challenge deployment** | ❌ Không hoạt động | ✅ Đầy đủ | ✅ Đầy đủ |
| **Tài nguyên cần** | 8GB RAM, 4 cores | 16GB RAM, 8 cores | 2 VMs (16GB + 32GB RAM) |
| **Network Policies** | ❌ | ⚠️ Hạn chế | ✅ Đầy đủ |
| **gVisor sandbox** | ❌ | ✅ | ✅ |

---

## Option 1: Local Dev (Chạy Native — Nhanh Nhất)

> **Phù hợp**: Dev tính năng frontend/backend, debug logic, test API đơn lẻ.
> **Không phù hợp**: Test challenge deployment pipeline (cần K8s + Argo).

### Prerequisites

| Tool | Version | Cài đặt |
|---|---|---|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| .NET SDK | 8.0 | [dotnet.microsoft.com](https://dotnet.microsoft.com/download/dotnet/8.0) |
| Go | 1.22+ | [go.dev](https://go.dev/dl/) |
| Python | 3.10+ | [python.org](https://python.org) |
| Docker Desktop | Latest | [docker.com](https://docker.com) |

### Bước 1: Chạy Infrastructure bằng Docker

Bạn cần MariaDB, Redis, RabbitMQ chạy local. Tạo file `docker-compose.dev.yml` tại root project:

```yaml
# docker-compose.dev.yml
services:
  mariadb:
    image: bitnami/mariadb:11.2
    ports:
      - "3306:3306"
    environment:
      MARIADB_ROOT_PASSWORD: root_password
      MARIADB_DATABASE: ctfd
      MARIADB_USER: fctf_user
      MARIADB_PASSWORD: fctf_password
    volumes:
      - mariadb_data:/bitnami/mariadb

  redis:
    image: bitnami/redis:7.2
    ports:
      - "6379:6379"
    environment:
      REDIS_PASSWORD: redis_password

  rabbitmq:
    image: bitnami/rabbitmq:3.13
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: rabbitmq_password

volumes:
  mariadb_data:
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

### Bước 2: Chạy từng service

Mở mỗi service trong **terminal riêng**:

```bash
# Terminal 1 — ContestantPortal (React frontend)
cd ContestantPortal
npm install
npm run dev
# → http://localhost:5173

# Terminal 2 — ContestantBE (API cho thí sinh)
cd ControlCenterAndChallengeHostingServer/ContestantBE
# Sửa appsettings.json: connection string trỏ về localhost:3306, Redis localhost:6379
dotnet run
# → http://localhost:5000 (hoặc port trong launchSettings.json)

# Terminal 3 — DeploymentCenter (API deploy)
cd ControlCenterAndChallengeHostingServer/DeploymentCenter
dotnet run

# Terminal 4 — ChallengeGateway (Go proxy)
cd ChallengeGateway
cp .env.example .env
# Sửa .env: REDIS_URL, backend URLs
go run main.go

# Terminal 5 — ManagementPlatform (Admin - Flask/CTFd)
cd FCTF-ManagementPlatform
pip install -r requirements.txt
flask run
# → http://localhost:4000
```

> [!IMPORTANT]
> **Challenge deployment pipeline sẽ KHÔNG hoạt động** ở option này vì cần Kubernetes cluster + Argo Workflows. Nhưng bạn vẫn có thể test toàn bộ auth, challenge listing, flag submission, scoreboard, admin panel.

### Bước 3: Cấu hình connection strings

Mỗi service cần cấu hình để trỏ về infra local. Kiểm tra và sửa:

- **ContestantBE**: `appsettings.json` hoặc `appsettings.Development.json`
- **DeploymentCenter**: `appsettings.json`
- **ChallengeGateway**: `.env` file
- **ManagementPlatform**: `CTFd/config.py` hoặc biến môi trường

```
# Ví dụ connection strings:
MySQL:     Server=localhost;Port=3306;Database=ctfd;User=fctf_user;Password=fctf_password
Redis:     localhost:6379,password=redis_password
RabbitMQ:  amqp://admin:rabbitmq_password@localhost:5672/fctf_deploy
```

---

## Option 2: Single-Node K3s trên WSL2 / VirtualBox (Recommended cho Test)

> **Phù hợp**: Test toàn bộ hệ thống bao gồm challenge deployment, Argo Workflows, NFS, Ingress.
> **Ưu điểm**: Chạy full stack trên máy local, không tốn tiền cloud.

### Prerequisites

- **WSL2** (Windows) hoặc **VirtualBox VM** chạy Ubuntu 22.04
- **RAM**: ≥ 16GB cho WSL2/VM (vì chạy cả infra + app trên 1 node)
- **Disk**: ≥ 50GB free

### Bước 1: Setup Ubuntu environment

**Nếu dùng WSL2:**
```powershell
# Trên PowerShell (Admin)
wsl --install -d Ubuntu-22.04
```

**Nếu dùng VirtualBox:**
- Tạo VM Ubuntu 22.04, cấp 16GB RAM, 8 cores, 100GB disk
- Enable nested virtualization nếu có

### Bước 2: Clone repo và configure domains

```bash
# Trong WSL2 / VM
git clone <repo-url> FCTF
cd FCTF
chmod +x manage.sh

# Bước 1: Configure domains/IP
# Vì chạy local, dùng IP private của WSL2/VM
./manage.sh
# Chọn: 9) Configure service domains/IP
```

Khi được hỏi các giá trị, dùng:

| Token | Giá trị cho local dev |
|---|---|
| `MASTER_NODE_PRIVATE_IP` | IP của WSL2/VM (dùng `hostname -I` để lấy) |
| `RABBITMQ_DOMAIN` | `rabbitmq.local` |
| `GRAFANA_DOMAIN` | `grafana.local` |
| `CONTESTANT_DOMAIN` | `contestant.local` |
| `ADMIN_DOMAIN` | `admin.local` |
| `ARGO_DOMAIN` | `argo.local` |
| `CONTESTANT_API_DOMAIN` | `api.local` |
| `REGISTRY_DOMAIN` | `registry.local` |
| `RANCHER_DOMAIN` | `rancher.local` |
| `GATEWAY_DOMAIN` | `gateway.local` |

### Bước 3: Setup K3s master (single-node, không cần worker)

```bash
./manage.sh
# Chọn: 1) Setup master
```

Script sẽ hỏi:
- **TLS SAN**: nhập IP private của WSL2/VM (VD: `172.18.0.2`)
- **NFS allowed subnet**: nhập `*` (cho phép tất cả, vì test local)

> [!TIP]
> Vì chạy single-node, bạn cần **bỏ taint** cho master để pods có thể schedule:
> ```bash
> kubectl taint nodes server-1-master node-role.kubernetes.io/control-plane=true:NoSchedule-
> ```

### Bước 4: Install FCTF platform

```bash
./manage.sh
# Chọn: 3) Install FCTF
```

> [!WARNING]
> Trước khi chạy step này, review và cập nhật:
> - `FCTF-k3s-manifest/prod/env/secret/` — passwords cho MariaDB, Redis
> - `FCTF-k3s-manifest/prod/env/configmap/` — URLs, feature flags
> - PV files trong `prod/storage/pv/` — sửa `spec.nfs.server` thành IP local

Script sẽ tự động:
1. Tạo namespaces (app, db, argo, storage)
2. Apply secrets & configmaps
3. Install Helm charts (MariaDB, Redis, RabbitMQ, Argo, monitoring)
4. Deploy 7 app services
5. Apply NetworkPolicies
6. Bootstrap RabbitMQ users
7. Create DB schema
8. Rotate service passwords

### Bước 5: Kiểm tra & truy cập

```bash
# Kiểm tra tất cả pods
kubectl get pods -A

# Chờ tất cả pods Ready
watch kubectl get pods -A
```

**Truy cập services qua NodePort:**
```bash
# Xem NodePort ports
kubectl get svc -A -o wide

# Hoặc dùng port-forward
kubectl port-forward -n app svc/contestant-portal 8080:80 &
kubectl port-forward -n app svc/contestant-be 5000:80 &
kubectl port-forward -n app svc/admin-mvc 4000:8000 &
```

**Nếu dùng WSL2**, truy cập từ Windows:
```
http://localhost:8080    → ContestantPortal
http://localhost:5000    → ContestantBE API
http://localhost:4000    → Admin Panel (CTFd)
```

### Bước 6 (Optional): Setup Harbor

```bash
./manage.sh
# Chọn: 4) Setup harbor
```

> [!NOTE]
> Harbor cần ≥ 4GB RAM riêng. Trên máy 16GB có thể bỏ qua Harbor và dùng DockerHub hoặc build image local + load vào K3s:
> ```bash
> docker build -t contestant-be:dev ./ControlCenterAndChallengeHostingServer/ContestantBE
> sudo k3s ctr images import contestant-be-dev.tar
> ```

---

## Option 3: Multi-Node K3s trên Cloud VMs (Production-like)

> **Phù hợp**: Staging environment, load testing, demo cho stakeholders.
> **Ưu điểm**: Gần nhất với production, test được network policies, multi-node scheduling.

### Prerequisites

| VM | Spec | Role |
|---|---|---|
| **VM1 (Master)** | 8 cores, 16GB RAM, 200GB SSD, Ubuntu 22.04 | K3s Server, NFS Server |
| **VM2 (Worker)** | 8 cores, 32GB RAM, 200GB SSD, Ubuntu 22.04 | K3s Agent, chạy workloads |

- Cả 2 VM phải cùng private subnet, ping được nhau
- Mở ports: `80`, `443`, `6443`, `30037`, `30038` (inbound trên master)
- Mở UDP `4789` giữa 2 nodes (Calico VXLAN)

### Bước thực hiện

Làm theo đúng README chính của project:

```bash
# === Trên Master Node ===
git clone <repo-url> FCTF && cd FCTF
chmod +x manage.sh

# Step 1: Configure domains (nhập domain thật hoặc IP public)
./manage.sh  # → 9

# Step 2: Setup master
./manage.sh  # → 1
# Nhập TLS SAN = public IP của master (VD: 34.124.131.240)
# Nhập NFS allowed subnet = private IPs (VD: 10.148.0.0/24)

# Step 3: Lấy master token
./manage.sh  # → 7
# Copy token output

# === Trên Worker Node ===
git clone <repo-url> FCTF && cd FCTF
chmod +x manage.sh

# Step 4: Join worker
./manage.sh  # → 2
# Nhập Master URL: https://<master-private-ip>:6443
# Paste master token

# === Quay lại Master Node ===

# Step 5: Install FCTF
./manage.sh  # → 3

# Step 6: Setup Harbor
./manage.sh  # → 4

# Step 7 (Optional): Setup CI/CD
./manage.sh  # → 5
```

### Sau khi cài xong

```bash
# Verify cluster
kubectl get nodes -o wide

# Verify all pods
kubectl get pods -A

# Verify services
kubectl get svc -A

# Verify ingress
kubectl get ingress -A
```

> [!IMPORTANT]
> **Checklist trước khi deploy lên cloud:**
> - [ ] Sửa NFS server IP trong tất cả PV files (`prod/storage/pv/*.yaml`)
> - [ ] Sửa domain trong ingress rules (`prod/ingress/nginx/*.yaml`)
> - [ ] Cập nhật ConfigMaps với URLs đúng (`prod/env/configmap/`)
> - [ ] Thay hết passwords mặc định trong Secrets (`prod/env/secret/`)
> - [ ] Sửa Helm values cho Rancher domain (`prod/helm/rancher/rancher-values.yaml`)

---

## Khuyến Nghị

```mermaid
graph TD
    Q{"Mục đích deploy?"} --> A["Dev feature<br/>Debug code"]
    Q --> B["Test integration<br/>Test deployment flow"]
    Q --> C["Staging / Demo<br/>Load testing"]
    
    A --> OPT1["✅ Option 1: Local Dev"]
    B --> OPT2["✅ Option 2: Single-Node K3s"]
    C --> OPT3["✅ Option 3: Multi-Node Cloud"]
    
    OPT1 --> NOTE1["Nhanh nhất, ~15 phút<br/>Không cần K8s knowledge"]
    OPT2 --> NOTE2["Full pipeline, ~60 phút<br/>Free, chạy trên máy local"]
    OPT3 --> NOTE3["Production-like, ~90 phút<br/>Cần cloud budget"]
```

### Recommended Path cho Dev/Test:

1. **Bắt đầu với Option 1** — dev features, test API, fix bugs nhanh
2. **Chuyển sang Option 2** khi cần test challenge deployment pipeline
3. **Dùng Option 3** khi cần staging hoặc demo

---

## Quick Reference: Service Ports

| Service | Default Port | K8s Service Name |
|---|---|---|
| ContestantPortal | 5173 (dev) / 80 (prod) | `contestant-portal` |
| ContestantBE | 5000 | `contestant-be` |
| DeploymentCenter | 5001 | `deployment-center` |
| ChallengeGateway | 8080 (HTTP) + 9090 (TCP) | `challenge-gateway` |
| ManagementPlatform | 4000 / 8000 | `admin-mvc` |
| DeploymentConsumer | N/A (worker) | N/A |
| DeploymentListener | N/A (worker) | N/A |
| MariaDB | 3306 | `mariadb` |
| Redis | 6379 | `redis-master` |
| RabbitMQ | 5672 / 15672 (mgmt) | `rabbitmq` |
| Argo Workflows | 2746 | `argo-workflows-server` |
