# FCTF Bare-Metal Setup Guide

**Môi trường:** 2 máy Ubuntu Desktop, không có quyền router, truy cập internet qua Cloudflare Tunnel.

---

## Tổng quan kiến trúc

```
Internet
   │ HTTPS
   ▼
Cloudflare Edge  ◄─── DNS: *.yourdomain.com → tunnel
   │ Cloudflare Tunnel (outbound từ PC1)
   ▼
PC1 (Master) ─────────── LAN ────────── PC2 (Worker)
  k3s control-plane                      k3s agent
  Nginx Ingress                          Challenge containers
  Harbor registry                        DeploymentCenter/Consumer/Listener
  MariaDB, Redis, RabbitMQ               ContestantPortal
  Admin MVC, ContestantBE
  Argo Workflows
  cloudflared daemon
```

**PC1 = master**, **PC2 = worker**. Tất cả traffic public vào qua Cloudflare Tunnel chạy trên PC1.

---

## Yêu cầu trước khi bắt đầu

- 2 máy Ubuntu Desktop (20.04+ hoặc 22.04+) kết nối cùng mạng LAN
- Đã có domain, đã trỏ nameserver về Cloudflare
- Repo `v5-official` đã clone trên **PC1**
- Internet access trên cả 2 máy

---

## Bước 0 — Chuẩn bị mạng LAN (dây LAN trực tiếp)

Vì router WiFi bật **AP Client Isolation** (chặn 2 WiFi client nói chuyện với nhau) và không có quyền router để tắt, giải pháp là **cắm dây LAN thẳng giữa 2 máy**.

- WiFi giữ nguyên → dùng để ra internet
- Dây LAN trực tiếp → dùng cho k3s cluster traffic

Dây LAN thông thường là đủ — card mạng hiện đại tự auto-negotiate, không cần dây crossover.

```
PC1 ──────── dây LAN ──────── PC2
 │                              │
 └── WiFi → router → internet ─┘
```

### 0.1. Cắm dây và tìm tên interface LAN

Cắm dây xong, chạy trên từng máy:

```bash
ip link show
# Tìm interface có trạng thái UP nhưng không phải lo (loopback) hay wl* (wifi)
# Thường là: eth0, enp2s0, enp3s0, eno1, ...
```

### 0.2. Set IP tĩnh cho interface LAN (chạy trên từng máy)

Ubuntu Desktop dùng NetworkManager. Thay `enp2s0` bằng tên interface LAN thực tế.

**PC1:**
```bash
# Tạo connection mới cho interface LAN
nmcli connection add type ethernet ifname enp2s0 con-name lan-cluster \
  ipv4.method manual \
  ipv4.addresses 10.0.0.1/24 \
  ipv6.method disabled

nmcli connection up lan-cluster
```

**PC2:**
```bash
nmcli connection add type ethernet ifname enp2s0 con-name lan-cluster \
  ipv4.method manual \
  ipv4.addresses 10.0.0.2/24 \
  ipv6.method disabled

nmcli connection up lan-cluster
```

### 0.3. Verify

```bash
# Kiểm tra IP
ip addr show enp2s0

# PC1 ping PC2
ping -c 3 10.0.0.2   # chạy trên PC1

# PC2 ping PC1
ping -c 3 10.0.0.1   # chạy trên PC2
```

Từ bước này trở đi, mọi IP cluster dùng `10.0.0.1` (PC1) và `10.0.0.2` (PC2).

---

## Bước 1 — Cài đặt Cloudflare Tunnel (PC1)

Phải làm trước khi setup k3s vì cert-manager cần domain resolve được.

### 1.1. Cài cloudflared

```bash
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update && sudo apt install cloudflared
```

### 1.2. Login Cloudflare (mở browser)

```bash
cloudflared tunnel login
```

Trình duyệt mở ra, chọn domain của mày, authorize. File credentials lưu tại `~/.cloudflared/cert.pem`.

### 1.3. Tạo tunnel

```bash
cloudflared tunnel create fctf
```

Lệnh này in ra tunnel ID, ví dụ: `a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Ghi lại để dùng sau.

Credentials lưu tại: `~/.cloudflared/<tunnel-id>.json`

### 1.4. Tạo config tunnel

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml > /dev/null << 'EOF'
tunnel: fctf
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: admin.yourdomain.com
    service: http://localhost:80
  - hostname: ctf.yourdomain.com
    service: http://localhost:80
  - hostname: api.yourdomain.com
    service: http://localhost:80
  - hostname: gateway.yourdomain.com
    service: http://localhost:80
  - hostname: registry.yourdomain.com
    service: http://localhost:80
  - hostname: argo.yourdomain.com
    service: http://localhost:80
  - hostname: grafana.yourdomain.com
    service: http://localhost:80
  - hostname: rabbitmq.yourdomain.com
    service: http://localhost:80
  - hostname: rancher.yourdomain.com
    service: http://localhost:80
  - service: http_status:404
EOF
```

> **Lưu ý:** Thay `<TUNNEL_ID>` bằng tunnel ID thực tế, thay `yourdomain.com` bằng domain thực.
> File credentials mặc định tạo tại `~/.cloudflared/`, cần copy sang `/root/`:
> ```bash
> sudo cp ~/.cloudflared/<TUNNEL_ID>.json /root/.cloudflared/
> ```

### 1.5. Tạo DNS records (tự động)

```bash
cloudflared tunnel route dns fctf admin.yourdomain.com
cloudflared tunnel route dns fctf ctf.yourdomain.com
cloudflared tunnel route dns fctf api.yourdomain.com
cloudflared tunnel route dns fctf gateway.yourdomain.com
cloudflared tunnel route dns fctf registry.yourdomain.com
cloudflared tunnel route dns fctf argo.yourdomain.com
cloudflared tunnel route dns fctf grafana.yourdomain.com
cloudflared tunnel route dns fctf rabbitmq.yourdomain.com
cloudflared tunnel route dns fctf rancher.yourdomain.com
```

Lệnh này tự tạo CNAME records trên Cloudflare DNS trỏ về tunnel. Không cần làm gì thêm trên dashboard Cloudflare.

### 1.6. Cài cloudflared làm service (tự khởi động khi boot)

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Kiểm tra:
```bash
sudo systemctl status cloudflared
```

> Tunnel chưa có traffic đi qua lúc này là bình thường — chờ k3s và Nginx Ingress lên mới có.

---

## Bước 2 — Setup Master (PC1)

### 2.1. Chạy manage.sh

```bash
cd /path/to/v5-official
bash manage.sh
```

Chọn **option 1 (Setup master)**.

Script hỏi 2 thông tin:

| Prompt | Trả lời |
|--------|---------|
| `Master TLS SAN` | `10.0.0.1` (LAN IP của PC1 qua dây) |
| `NFS allowed subnet` | `10.0.0.0/24` (cho phép cả PC2 mount NFS) |

Script tự động:
- Cài dependencies, set timezone
- Disable swap, cấu hình kernel modules cho k3s
- Cài k3s server với Calico CNI (vxlan mode)
- Cài gVisor (runsc) cho sandbox challenge containers
- Setup NFS server tại `/srv/nfs/share`
- Apply RuntimeClass

### 2.2. Lấy worker join token

```bash
bash manage.sh
# Chọn option 7 (Get master token)
```

Hoặc:
```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

Ghi lại token này để dùng ở Bước 3.

---

## Bước 3 — Setup Worker (PC2)

### 3.1. Clone repo lên PC2

```bash
# Trên PC2
git clone <repo-url> v5-official
cd v5-official
```

### 3.2. Chạy manage.sh

```bash
bash manage.sh
# Chọn option 2 (Setup worker)
```

Script hỏi:

| Prompt | Trả lời |
|--------|---------|
| `Master URL` | `https://10.0.0.1:6443` |
| `Node token` | Token lấy từ Bước 2.2 |

Script tự động:
- Cài dependencies
- Cài k3s agent, join vào cluster
- Cài gVisor (runsc)

### 3.3. Verify từ PC1

```bash
kubectl get nodes -o wide
# NAME             STATUS   ROLES                  AGE
# server-1-master  Ready    control-plane,master   5m
# <pc2-hostname>   Ready    <none>                 1m
```

---

## Bước 4 — Cấu hình domains và IP (PC1)

```bash
bash manage.sh
# Chọn option 9 (Configure service domains/IP)
```

Điền các giá trị:

| Token | Giá trị |
|-------|---------|
| `MASTER_NODE_PRIVATE_IP` | `10.0.0.1` |
| `ADMIN_DOMAIN` | `admin.yourdomain.com` |
| `CONTESTANT_DOMAIN` | `ctf.yourdomain.com` |
| `CONTESTANT_API_DOMAIN` | `api.yourdomain.com` |
| `GATEWAY_DOMAIN` | `gateway.yourdomain.com` |
| `REGISTRY_DOMAIN` | `registry.yourdomain.com` |
| `ARGO_DOMAIN` | `argo.yourdomain.com` |
| `GRAFANA_DOMAIN` | `grafana.yourdomain.com` |
| `RABBITMQ_DOMAIN` | `rabbitmq.yourdomain.com` |
| `RANCHER_DOMAIN` | `rancher.yourdomain.com` |

Xác nhận `y` để replace tất cả placeholders trong project.

---

## Bước 5 — Cài FCTF (PC1)

```bash
bash manage.sh
# Chọn option 3 (Install FCTF)
```

Script hỏi tương tự setup-master:

| Prompt | Trả lời |
|--------|---------|
| `Master TLS SAN` | `10.0.0.1` |
| `NFS allowed subnet` | `10.0.0.0/24` |

Script tự động:
- Tạo namespaces (`app`, `argo`, `storage`, `db`)
- Apply Helm stack (MariaDB, Redis, RabbitMQ, Nginx Ingress, Argo Workflows, Prometheus/Grafana/Loki, Rancher)
- Apply PV/PVC (NFS-backed)
- Deploy tất cả app services
- Apply Ingress và cert-manager
- Bootstrap RabbitMQ users
- Khởi tạo MariaDB schema
- Rotate service passwords

> Script chạy khá lâu (~15-30 phút) do pull images và khởi động services.

---

## Bước 6 — Setup Harbor registry (PC1)

```bash
bash manage.sh
# Chọn option 4 (Setup harbor)
```

Script đợi Harbor sẵn sàng, sau đó hướng dẫn:

**Làm thủ công trên Harbor UI trước:**
1. Mở `https://registry.yourdomain.com`
2. Login (mặc định: `admin` / `Harbor12345`)
3. Tạo project `fctf` (Private)
4. Tạo Robot Account trong project `fctf`
5. Cấp quyền pull + push cho robot account
6. Copy robot username và secret

**Quay lại terminal**, nhập robot credentials khi được hỏi.

Script tự động:
- Apply Kubernetes registry secrets cho namespace `app` và `argo`
- Build tất cả Docker images
- Push lên Harbor

---

## Bước 7 — Setup CI/CD (tùy chọn, PC1)

```bash
bash manage.sh
# Chọn option 5 (Setup CI/CD)
```

---

## Bước 8 — Lấy Argo token (PC1)

```bash
bash manage.sh
# Chọn option 6 (Get Argo token)
```

Dùng token này để đăng nhập Argo Workflows UI tại `https://argo.yourdomain.com`.

---

## Verify hệ thống

### Kiểm tra nodes và pods

```bash
kubectl get nodes -o wide
kubectl get pods -A
```

### Kiểm tra ingress

```bash
kubectl get ingress -A
```

### Kiểm tra tunnel đang nhận traffic

```bash
sudo systemctl status cloudflared
cloudflared tunnel info fctf
```

### Truy cập các service

| Service | URL |
|---------|-----|
| Admin (CTFd) | `https://admin.yourdomain.com` |
| Contestant Portal | `https://ctf.yourdomain.com` |
| Harbor Registry | `https://registry.yourdomain.com` |
| Argo Workflows | `https://argo.yourdomain.com` |
| Grafana | `https://grafana.yourdomain.com` |
| RabbitMQ UI | `https://rabbitmq.yourdomain.com` |
| Rancher | `https://rancher.yourdomain.com` |

---

## Xử lý sự cố thường gặp

### Tunnel không kết nối được

```bash
# Xem log
sudo journalctl -u cloudflared -f

# Restart tunnel
sudo systemctl restart cloudflared
```

### Node không join cluster

```bash
# Kiểm tra firewall giữa 2 máy
# Trên PC1, cho phép PC2 kết nối vào port 6443
sudo ufw allow from 10.0.0.2 to any port 6443

# Kiểm tra k3s-agent log trên PC2
sudo journalctl -u k3s-agent -f
```

### Pods không schedule lên worker

```bash
# Kiểm tra taint/label
kubectl describe node <worker-name>

# Nếu worker bị taint, xóa taint
kubectl taint nodes <worker-name> node-role.kubernetes.io/control-plane- 
```

### Harbor không accessible sau khi setup

```bash
# Kiểm tra harbor pod
kubectl get pods -n registry
kubectl logs -n registry <harbor-pod>

# Kiểm tra ingress
kubectl describe ingress -n registry
```

### Cert-manager không cấp cert

Vì dùng Cloudflare Tunnel, cert-manager không cần thiết (Cloudflare tự xử lý SSL). Nếu browser báo lỗi cert, kiểm tra Cloudflare dashboard:
- SSL/TLS mode nên là **Full** (không cần Full Strict vì traffic nội bộ là HTTP)

---

## Khởi động lại sau khi tắt máy

Tất cả services tự khởi động lại khi boot vì đã `systemctl enable`:
- `k3s` (PC1)
- `k3s-agent` (PC2)
- `cloudflared` (PC1)

Kubernetes pods tự restart theo restart policy. Không cần làm gì thêm.

---

## Uninstall

```bash
bash manage.sh
# Chọn option 8 (Uninstall)
# → 1: Uninstall worker (chạy trên PC2 trước)
# → 2: Uninstall master (chạy trên PC1)
```
