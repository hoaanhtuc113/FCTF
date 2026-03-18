# Hướng dẫn cài đặt FCTF K3s

Tài liệu này hướng dẫn cài đặt hệ thống FCTF K3s trên 2 môi trường:
- **Option 1:** Production trên Server Cloud VM ...
- **Option 2:** Development/Testing trên WSL, VirtualBox Local

- **DockerHub** 
Docker Hub được sử dụng làm kho lưu trữ và phân phối các container image phục vụ triển khai hệ thống, lưu trữ các challenge. Bạn cần tạo tài khoảng DockerHub và tạo 1 private repo đẻ quản lý các challenge 

## Các bước cài đặt

### 1. Chuẩn bị server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Cài đặt các công cụ cần thiết
sudo apt install -y curl wget git nano vim net-tools nfs-common

# Cấu hình timezone
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
```

### 2. Cài đặt K3s Master Node
**Cho Production (Cloud serrver):**
```bash

sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: 250
EOF

# Cài K3s với domain TLS SAN
# Chú ý đổi tls-san thành ip của master 
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --flannel-backend=none \
  --disable-network-policy \
  --disable traefik \
  --kubelet-arg=config=/etc/rancher/k3s/kubelet.config \
  --write-kubeconfig-mode 644 \
  --tls-san=34.124.131.240 \
  --node-taint node-role.kubernetes.io/control-plane=true:NoSchedule" sh -

```

**Kiểm tra và cấu hình kubectl:**
```bash
# Kiểm tra K3s đã chạy
sudo systemctl status k3s

# Cấu hình kubectl
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config

# Thêm vào ~/.bashrc để tự động load
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc

# Kiểm tra cluster
kubectl get nodes
```
## install calico
```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/custom-resources.yaml
```


# cài k3s worker-node là ip private của server
```bash
# Lấy master node token
sudo cat /var/lib/rancher/k3s/server/node-token

sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: 250
EOF

# Cài k3s worker-node
# Truy cập vào worker-node và chạy lệnh này để join vào master node
curl -sfL https://get.k3s.io | K3S_URL=https://10.148.0.32:6443 \
  K3S_TOKEN=K104c2087b7054c4dce1ba83f62503501983f9678e1ec719ab0adbcaba14d2aedf6::server:0bad0ef30cd7d18735a199bde9f18d7e \
  INSTALL_K3S_EXEC="agent --kubelet-arg=config=/etc/rancher/k3s/kubelet.config" sh -
```

## Cài gVisor (runsc)

```bash
ARCH=$(uname -m)
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"

sudo curl -fsSL ${URL}/runsc -o /usr/local/bin/runsc
sudo curl -fsSL ${URL}/runsc.sha512 -o /tmp/runsc.sha512
(cd /tmp && sha512sum -c runsc.sha512)
sudo chmod +x /usr/local/bin/runsc

sudo curl -fsSL ${URL}/containerd-shim-runsc-v1 \
  -o /usr/local/bin/containerd-shim-runsc-v1

sudo chmod +x /usr/local/bin/containerd-shim-runsc-v1

runsc --version
containerd-shim-runsc-v1 -v || echo OK
```

## Cấu hình containerd cho k3s

```bash
sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd
```

```bash
sudo tee /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl > /dev/null <<'EOF'
version = 2

[plugins."io.containerd.grpc.v1.cri".containerd]
  default_runtime_name = "runc"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
EOF
```

## Restart k3s

```bash
sudo systemctl restart k3s || sudo systemctl restart k3s-agent
```

Chờ k3s lên:

```bash
kubectl get nodes
```

### 3. Cài đặt NFS Server

```bash
# Cài đặt NFS server
kubectl create namespace storage
sudo apt update
sudo apt install -y nfs-kernel-server nfs-common

# Tạo thư mục share
sudo mkdir -p /srv/nfs/share
sudo chown nobody:nogroup /srv/nfs/share
sudo chmod 777 /srv/nfs/share

# Cấu hình exports
echo "/srv/nfs/share *(rw,sync,no_subtree_check,no_root_squash,insecure)" | sudo tee -a /etc/exports

# Apply cấu hình
sudo exportfs -ra
sudo systemctl enable nfs-kernel-server
sudo systemctl restart nfs-kernel-server

# Kiểm tra
showmount -e localhost
sudo exportfs -v
```

### 4. Lấy IP local và setup NFS PV/PVC
```bash
# thường sẽ là IP đầu tiên 
hostname -I
# Ví dụ tôi có 10.148.0.32 
# Cần sửa trong prod\storage\nfs-pv-pvc.yaml phàn spec.nfs.server ở đây thay thế bằng IP của bạn 
# Tương tự những chỗ mount nfs ở các file sau  
#    prod\app\admin-mvc\deployment.yaml 
#    prod\app\contestant-be\deployment.yaml
#    prod\argo-workflows\start-chal-v2\start-chal-v2-template.yaml
#    prod\argo-workflows\up-challenge\up-challenge-template.yaml

# apply NFS PV/PVC
kubectl apply -f ./prod/storage/nfs-pv-pvc.yaml

# Kiểm tra
kubectl get pv
kubectl get pvc -n storage
```

### 5. Cài đặt heml và các thành phần qua Helm
```bash
# Cài đặt Helm 3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Kiểm tra
helm version

# Nếu cài trên server ingress domain không hoạt động bạn cần expose node port (range 30000-32767)
# Các helm cần expose node port Argo,Filebrowser, Grafana, K8s Dashboard
# Vào file helm của các service đẻ kiểm tra và chỉnh sửa
# kiểm tra các node port đã expose sau khi apply các helm
kubectl get svc --all-namespaces -o custom-columns="NAMESPACE:.metadata.namespace,NAME:.metadata.name,NODEPORTS:.spec.ports[*].nodePort"
```
```bash
# Chạy script cài đặt tự động 
# Hoặc cài đặt từng bước: có thể vào ./helm.sh để cài từng bước bắt đầu từ # Apply helm repos
# Đối với môi trường dev có thể bỏ qua nginx ingress và cert-manager (comment phần đó lại)
bash helm.sh
# nếu không chạy được bash helm.sh bạn cần chuyển từ CLRF sang FL và đặt file executable sau đó chạy lại
chmod +x helm.sh

# Đối với K8s Dashboard, cài trên server không có ingress domain cần expose node
# chạy lệnh bên dưới để expose nodeport
kubectl -n kubernetes-dashboard edit svc kubernetes-dashboard-dashboard
# Sau đó sửa: 
# spec:
#   type: NodePort
# và 
# ports
#   nodePort: 30800 //số bất kì hoặc để trống đều được

# Apply Service Accounts để lấy được token cho argo và k8s dashboard
kubectl apply -f prod/sa/argo-workflow/argo-sa.yaml
kubectl -n argo get secret argo-sa.service-account-token -o jsonpath="{.data.token}" | base64 --decode
# Token này dùng để authen argo và k8s 
# Và sửa trong đây để các service có thể sự dụng argo prod\env\secret\common-secret.yaml

```

### 6. Deploy ứng dụng CTF
```bash
# Đầu tiên bạn cần vào prod\app trong các service có file deployment.yaml để cấu hình sử dụng image nào, resource bao nhiêu
# Trong thư mục prod\env\secret có file docker-secret.yaml nhiệm vụ của file này lưu thông tin đăng nhập để Kubernetes có thể pull image từ private Docker registry vì chúng tôi sử dụng private repo
kubectl create secret docker-registry regcred 
  --docker-server=https://index.docker.io/v1/ 
  --docker-username=<username> 
  --docker-password=<password> 
  --docker-email=<email> 
  --namespace=<namespace> # dùng cho namespace nào trong k8s
  --dry-run=client -o yaml
# hoặc sửa thông tin đăng nhập trong docker-creds.sh và chạy bash docker-creds.sh

# Tạo Namespace
kubectl create namespace app
kubectl create namespace challenge


kubectl apply -f ./prod/priority-classes.yaml
kubectl apply -f ./prod/runtime-class.yaml
# Apply ConfigMaps và Secrets
kubectl apply -f ./prod/env/configmap/
kubectl apply -f ./prod/env/secret/

# Deploy applications
kubectl apply -f ./prod/app/admin-mvc/
kubectl apply -f ./prod/app/contestant-be/
kubectl apply -f ./prod/app/contestant-portal/
kubectl apply -f ./prod/app/deployment-center/
kubectl apply -f ./prod/app/deployment-listener/
kubectl apply -f ./prod/app/challenge-gateway/
kubectl apply -f ./prod/app/deployment-consumer/

# Ở đây có 2 cách bạn có thể chuyển đổi qua lại
# Apply NodePort services: Nếu Ở môi trường local, ingress domain không hoạt động. sử dụng cách này**
kubectl delete -f ./prod/app/service-nodeport.yaml
# Apply ClusterIP services: Môi trường production có doamin
kubectl apply -f ./prod/app/service-clusterip.yaml

# DEVELOPMENT
# Chạy script port-forward tất cả services
cd ~/FCTF-k3s-manifest
chmod +x local-port-forward.sh
bash local-port-forward.sh
# Script sẽ tự động forward tất cả services
# Nhấn Ctrl+C để dừng tất cả

# PRODUCTION
# Apply Ingress (Nếu Ở môi trường local và ingress domain không hoạt động bỏ qua cách này)
kubectl apply -f ./prod/cert-manager/cluster-issuer.yaml
# Sửa host và dnsNames trong các file ở folder certificate và nginx
kubectl apply -f ./prod/ingress/certificate/
kubectl apply -f ./prod/ingress/nginx/
```
#### Thông tin đăng nhập

**Filebrowser**
```Bash
- Username: `admin`
- Password: `admin`

#### Grafana (Monitoring)
- Username: `admin`
- Password: `Fctf2025@`
```
### 7. Apply Cron job
```Bash
# Cron job dùng để dọn dẹp các challenge/instance un-heathy
kubectl apply -f ./prod/cron-job/delete-chal-job.yaml 
```
### 8. Setup Argo and NFS server to deploy challenge
```bash
# Chúng ra cần 2 chạy lệnh, để có thể sử dụng các template start, up challenge trên argo
kubectl apply -f prod/argo-workflows/start-chal-v2/start-chal-v2-template.yaml
kubectl apply -f prod/argo-workflows/up-challenge/up-challenge-template.yaml
# truy cập vào FileBrowser đăng nhập với tài khoản và mật khẩu admin/admin
# Tạo foler start-challenge và import file prod\argo-workflows\challenge.yaml
```
### 9. Kiểm tra cài đặt

```bash
# Kiểm tra tất cả pods
kubectl get pods -A

# Kiểm tra services
kubectl get svc -A

# Kiểm tra ingress
kubectl get ingress -A

# Kiểm tra PV/PVC
kubectl get pv
kubectl get pvc -A

# Kiểm tra NFS mount
df -h | grep nfs
```


## Xử lý sự cố

### NFS mount failed
```bash
# Kiểm tra NFS server
sudo systemctl status nfs-kernel-server
showmount -e localhost

# Kiểm tra exports
sudo exportfs -v

# Restart NFS
sudo systemctl restart nfs-kernel-server

# Xóa pod để recreate
kubectl delete pod -n storage -l app.kubernetes.io/name=filebrowser
```

### Lưu ý
``` bash
# nếu xử dụng firewall mở các port 80, 443, 30037, 30038
```

### Pod pending hoặc CrashLoopBackOff
```bash
# Xem logs
kubectl logs -n <namespace> <pod-name>

# Xem events
kubectl describe pod -n <namespace> <pod-name>

# Xem tất cả events
kubectl get events -A --sort-by='.lastTimestamp'
```

### Certificate không được issue
```bash
# Kiểm tra cert-manager
kubectl get pods -n cert-manager

# Xem logs cert-manager
kubectl logs -n cert-manager -l app=cert-manager

# Kiểm tra certificate
kubectl get certificate -A
kubectl describe certificate -n <namespace> <cert-name>
```

## Uninstall

### Xóa từng component
```bash
# Xóa helm releases
helm uninstall filebrowser -n storage
helm uninstall argo-workflows -n argo
helm uninstall prometheus -n monitoring
helm uninstall loki-stack -n monitoring
helm uninstall redis -n db
helm uninstall mariadb -n db
helm uninstall rabbitmq -n db
helm uninstall cert-manager -n cert-manager
helm uninstall ingress-nginx -n ingress-nginx
helm uninstall rancher -n cattle-system

# Xóa namespaces
kubectl delete namespace storage argo monitoring db cert-manager ingress-nginx
```

### Gỡ K3s hoàn toàn
```bash
/usr/local/bin/k3s-uninstall.sh
```

### Gỡ NFS server
```bash
sudo systemctl stop nfs-kernel-server
sudo apt remove --purge -y nfs-kernel-server nfs-common
sudo rm -rf /srv/nfs
```

## Tài liệu tham khảo

- [K3s Documentation](https://docs.k3s.io/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [NFS Server Setup](https://ubuntu.com/server/docs/service-nfs)


## CI/CD Pipeline (GitHub Actions)

Pipeline tự động build Docker image và deploy lên K3s khi push code lên branch `main`.

### Flow hoạt động

```
Push to main → Detect Changes → Build & Push (parallel matrix) → Deploy to K3s → Summary
```

- **Smart change detection**: Chỉ build service nào có file thay đổi
- **Parallel matrix build**: Tất cả services build song song, tiết kiệm thời gian
- **Auto deploy**: Tự động `kubectl set image` + `rollout status` sau khi build thành công
- **Workflow dispatch**: Có thể trigger thủ công để build & deploy toàn bộ

### Setup CI/CD ServiceAccount cho K3s

Script `cicd-setup.sh` tạo ServiceAccount riêng cho pipeline với quyền **least privilege** (chỉ update deployments trong namespace `app`).

```bash
# Chạy trên server K3s (cần cluster-admin access)
chmod +x cicd-setup.sh && ./cicd-setup.sh
```

Script sẽ tự động:
1. Tạo ServiceAccount `cicd-deployer` trong namespace `app`
2. Tạo Role chỉ cho phép `get/list/patch/update` deployments
3. Bind Role vào ServiceAccount
4. Tạo long-lived token
5. Build kubeconfig standalone
6. Xuất **base64** để paste vào GitHub Secret

> **Lưu ý:** Nếu server URL trong kubeconfig là private IP (10.x.x.x, 192.168.x.x), script sẽ hỏi bạn nhập public IP/domain. GitHub Actions runners cần public IP để kết nối tới cluster.

### Cấu hình GitHub Secrets

Vào **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**, thêm 3 secrets:

| Secret | Mô tả | Cách lấy |
|--------|-------|----------|
| `DOCKERHUB_USERNAME` | Username DockerHub | Username đăng nhập DockerHub (vd: `quachuoiscontainer`) |
| `DOCKERHUB_TOKEN` | Access token DockerHub | Tạo tại https://hub.docker.com/settings/security → New Access Token |
| `KUBE_CONFIG` | Kubeconfig base64 | Chạy `cicd-setup.sh` trên server, copy output base64 |

> **Quan trọng:** Dùng **Access Token** thay vì password DockerHub để bảo mật hơn.

### Các services được CI/CD

| Service | Image Tag | Detect thay đổi tại |
|---------|-----------|---------------------|
| ChallengeGateway | `challenge-gateway-prod-*` | `ChallengeGateway/**` |
| ContestantPortal | `contestant-portal-prod-*` | `ContestantPortal/**` |
| ContestantBE | `contestant-be-prod-*` | `ContestantBE/** + ResourceShared/**` |
| DeploymentCenter | `deployment-center-prod-*` | `DeploymentCenter/** + ResourceShared/**` |
| DeploymentListener | `deployment-listener-prod-*` | `DeploymentListener/** + ResourceShared/**` |
| DeploymentConsumer | `deployment-consumer-prod-*` | `DeploymentConsumer/** + ResourceShared/**` |
| ManagementPlatform | `admin-mvc-prod-*` | `FCTF-ManagementPlatform/**` |

Mỗi image được tag bằng:
- `<service>-prod-<git-sha>` — truy vết chính xác commit
- `<service>-prod-latest` — luôn trỏ tới bản build mới nhất
