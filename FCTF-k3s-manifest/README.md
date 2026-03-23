# Hướng dẫn cài đặt FCTF K3s

Tài liệu này hướng dẫn cài đặt hệ thống FCTF K3s trên 2 môi trường:
- **Option 1:** Production trên Server Cloud VM ...
- **Option 2:** Development/Testing trên WSL, VirtualBox Local

- **DockerHub** 
Docker Hub được sử dụng làm kho lưu trữ và phân phối các container image phục vụ triển khai hệ thống, lưu trữ các challenge. Bạn cần tạo tài khoảng DockerHub và tạo 1 private repo đẻ quản lý các challenge 

## Các bước cài đặt

### 0. Chuẩn bị secret MariaDB (bat buoc truoc khi cai Helm)

MariaDB da duoc cau hinh dung existingSecret trong Helm values, vi vay ban phai cap nhat secret truoc khi chay helm:

```bash
# 1) Sua mat khau manh trong file secret
nano ./prod/env/secret/mariadb-auth-secret.yaml

# 2) Tao namespace db neu chua co va apply secret
kubectl create namespace db --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f ./prod/env/secret/mariadb-auth-secret.yaml
```

Neu ban dung tai khoan admin DB cho ManagementPlatform, cap nhat them:

```bash
nano ./prod/env/secret/admin-mvc-secret.yaml
```

Neu DB da du lieu san (PVC cu), file initdbScripts se khong chay lai. Khi do hay chay SQL cap quyen thu cong:

```bash
# Sua mat khau trong script truoc khi chay
nano ./prod/helm/db/mariadb/least-privilege-service-accounts.sql
```

Luu y quan trong cho cai dat moi:
- CTFd schema/table thuong duoc tao sau khi `admin-mvc` khoi dong lan dau.
- Vi vay `initdbScripts` co the chay truoc khi schema day du, dan den user da tao nhung grant chua day du.
- Sau khi `admin-mvc` chay on dinh, can apply lai file SQL grant mot lan:

```bash
kubectl rollout status deployment/admin-mvc -n app --timeout=300s
kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ctfd' < ./prod/helm/db/mariadb/least-privilege-service-accounts.sql
```

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

# Cài Access Control Lists
sudo apt install acl -y
# Tạo thư mục share
sudo mkdir -p /srv/nfs/share
sudo mkdir -p /srv/nfs/share/challenges /srv/nfs/share/start-challenge /srv/nfs/share/file

# 5 group/UID
# admin-mvc: 1101 -> /challenges rwx, /file rwx
# contestant-be: 1102 -> /file r-x
# up-challenge-workflow: 1103 -> /challenges r-x
# start-chal-v2-workflow: 1104 -> /start-challenge r-x
# filebrowser: 1105 -> full rwx

# baseline: chủ sở hữu root, không cho others
sudo chmod 770 /srv/nfs/share/challenges /srv/nfs/share/start-challenge /srv/nfs/share/file

# admin-mvc
sudo setfacl -R -m u:1101:rwx /srv/nfs/share/challenges /srv/nfs/share/file
sudo setfacl -R -m d:u:1101:rwx /srv/nfs/share/challenges /srv/nfs/share/file

# contestant-be (read-only)
sudo setfacl -R -m u:1102:rx /srv/nfs/share/file
sudo setfacl -R -m d:u:1102:rx /srv/nfs/share/file

# up-challenge-workflow (read-only)
sudo setfacl -R -m u:1103:rx /srv/nfs/share/challenges
sudo setfacl -R -m d:u:1103:rx /srv/nfs/share/challenges
# Kaniko chạy root nhưng NFS đang root_squash -> root bị map thành anon (thường 65534)
# Cần cấp quyền cho anon user/group để đọc được challenges
sudo setfacl -R -m u:65534:rx,g:65534:rx /srv/nfs/share/challenges
sudo setfacl -R -m d:u:65534:rx,d:g:65534:rx /srv/nfs/share/challenges



# start-chal-v2-workflow (read-only)
sudo setfacl -R -m u:1104:rx /srv/nfs/share/start-challenge
sudo setfacl -R -m d:u:1104:rx /srv/nfs/share/start-challenge

# filebrowser full quyền toàn bộ
sudo setfacl -R -m u:1105:rwx /srv/nfs/share/challenges /srv/nfs/share/start-challenge /srv/nfs/share/file
sudo setfacl -R -m d:u:1105:rwx /srv/nfs/share/challenges /srv/nfs/share/start-challenge /srv/nfs/share/file

# Chỉ cho phép đúng IP của 3 node
# Đổi 3 IP bên dưới theo cluster thực tế
echo "/srv/nfs/share 10.184.0.2(rw,sync,no_subtree_check,root_squash,sec=sys) 10.184.0.6(rw,sync,no_subtree_check,root_squash,sec=sys) 10.184.0.7(rw,sync,no_subtree_check,root_squash,sec=sys)" | sudo tee -a /etc/exports

# Apply cấu hình
sudo exportfs -ra
sudo systemctl enable nfs-kernel-server
sudo systemctl restart nfs-kernel-server

# Kiểm tra
getfacl /srv/nfs/share
getfacl /srv/nfs/share/file
getfacl /srv/nfs/share/challenges
getfacl /srv/nfs/share/start-challenge
showmount -e localhost
sudo exportfs -v
```

### 4. Lấy IP local và setup NFS PV/PVC
```bash
# thường sẽ là IP đầu tiên 
hostname -I
# Ví dụ tôi có 10.148.0.32 
# Cần sửa phần spec.nfs.server trong các file PV bên dưới
#   prod\storage\pv\admin-mvc-pv.yaml
#   prod\storage\pv\contestant-be-pv.yaml
#   prod\storage\pv\up-challenge-workflow-pv.yaml
#   prod\storage\pv\start-challenge-workflow-pv.yaml
#   prod\storage\pv\filebrowser-pv.yaml

# apply NFS PV/PVC theo từng service
kubectl apply -f ./prod/storage/pv/admin-mvc-pv.yaml
kubectl apply -f ./prod/storage/pv/contestant-be-pv.yaml
kubectl apply -f ./prod/storage/pv/up-challenge-workflow-pv.yaml
kubectl apply -f ./prod/storage/pv/start-challenge-workflow-pv.yaml
kubectl apply -f ./prod/storage/pv/filebrowser-pv.yaml

kubectl apply -f ./prod/storage/pvc/admin-mvc-pvc.yaml
kubectl apply -f ./prod/storage/pvc/contestant-be-pvc.yaml
kubectl apply -f ./prod/storage/pvc/up-challenge-workflow-pvc.yaml
kubectl apply -f ./prod/storage/pvc/start-challenge-workflow-pvc.yaml
kubectl apply -f ./prod/storage/pvc/filebrowser-pvc.yaml

# Kiểm tra
kubectl get pv
kubectl get pvc -n app
kubectl get pvc -n argo
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
# Luu y: setup-master.sh se tu apply prod/env/secret/mariadb-auth-secret.yaml truoc khi chay helm.sh
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

# Apply Service Accounts + RBAC theo least-privilege
kubectl apply -f prod/sa/argo-workflow/argo-sa.yaml

# start-chal-v2-workflow-sa đang dùng cluster-admin mặc định để đảm bảo deploy challenge ổn định trên Rancher.

# Không dùng static token secret nữa.
# DeploymentCenter / DeploymentConsumer sẽ dùng token tự động được mount theo service account trong pod.
# Nếu cần test thủ công Argo API, dùng short-lived token:
kubectl create token start-chal-v2-workflow-sa -n argo --duration=1h

```

### 5.1. Bảo mật pod-to-pod toàn hệ thống bằng Linkerd mTLS
`prod/helm.sh` cài Linkerd control plane (`linkerd-crds`, `linkerd-control-plane`) và tự annotate các namespace nội bộ:
- `app`, `challenge`, `db`, `argo`, `monitoring`, `storage`, `ctfd`

Mỗi namespace này được bật:
- `linkerd.io/inject=enabled`
- `config.linkerd.io/default-inbound-policy=all-authenticated`

Kết quả:
- Traffic pod-to-pod trong hệ thống nội bộ (bao gồm MariaDB/Redis/RabbitMQ ở namespace `db`) được mã hóa mTLS.
- Workload identity được cấp tự động theo ServiceAccount bởi Linkerd identity.
- Workload certificate ngắn hạn được Linkerd xoay vòng tự động.
- Traffic plaintext inbound vào workload trong các namespace nội bộ bị từ chối.

Lưu ý: `ingress-nginx` và `cert-manager` không bật policy `all-authenticated` vì cần nhận traffic từ ngoài mesh.

Lệnh kiểm tra nhanh:

```bash
# Kiểm tra control plane Linkerd
kubectl get pods -n linkerd

# Kiểm tra sidecar injection
kubectl get pods -n app -l app=deployment-center -o jsonpath='{range .items[*]}{.metadata.name}{" => "}{.spec.containers[*].name}{"\n"}{end}'

# Kiểm tra trạng thái mesh và mTLS
linkerd check
linkerd -n app check --proxy
linkerd -n db check --proxy
linkerd viz stat deploy -n app

# Rollout để pod cũ nhận sidecar/policy mới
kubectl rollout restart deploy -n app
kubectl rollout restart statefulset -n db
kubectl rollout restart deploy -n db
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
kubectl create namespace db


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

#Network Policy
kubectl apply -f ./prod/app/NetworkPolicy
# Sau khi admin-mvc khoi tao xong CTFd schema, apply lai grant SQL de dam bao quyen user dich vu
kubectl rollout status deployment/admin-mvc -n app --timeout=300s
kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ctfd' < ./prod/helm/db/mariadb/least-privilege-service-accounts.sql

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

### RabbitMQ setup cho Deployment Center/Consumer

`deployment-center` và `deployment-consumer` **không tự khai báo topology trong code**. Topology + tài khoản + phân quyền được khai báo sẵn ở setup Helm:

- Queue: `deployment_queue`
- Exchange: `deployment_exchange` (direct)
- Binding: `deployment_exchange` -> `deployment_queue` với routing key `deploy`
- Vhost: `fctf_deploy`
- Users:
  - `deployment-producer` (chỉ publish vào `deployment_exchange`)
  - `deployment-consumer` (chỉ consume từ `deployment_queue`)

Cấu hình nằm trong file [prod/helm/db/rabbitmq/rabbitmq-values.yaml](prod/helm/db/rabbitmq/rabbitmq-values.yaml) (`extraDeploy` + `loadDefinition`).

### Redis ACL setup (không dùng chung `default` toàn quyền)
#### 1) Bật ACL và khai báo user theo service

Sửa file [prod/helm/db/redis/redis-values.yaml](prod/helm/db/redis/redis-values.yaml):
- Bật `auth.acl.enabled: true`
- **Không khai báo `default` trong `auth.acl.users`** (nếu thêm sẽ gây lỗi duplicate user khi Redis start)
- Để vô hiệu hóa sử dụng thực tế của `default`: không cấp/không phát tán `auth.password`
- Tạo các user riêng cho từng service, ví dụ:
  - `svc_admin_mvc`
  - `svc_gateway`
  - `svc_contestant_be`
  - `svc_deployment_center`
  - `svc_deployment_consumer`
  - `svc_deployment_listener`

Lưu ý:
- `svc_gateway` chỉ nên truy cập key prefix `fctf:gateway:*` và quyền cần cho limiter/Lua (`EVAL`, `EVALSHA`, `HGET/HSET`, `INCR/DECR`, `EXPIRE`, ...)
- Các service deployment chỉ cấp key pattern liên quan deploy như `deploy_challenge_*`, `active_deploys_team_*`, ...
- `svc_contestant_be` hiện cần key rộng (`~*`) do AspNetCoreRateLimit tạo key động (nếu bó hẹp sẽ dễ phát sinh `NOPERM No permissions to access a key`).
#### 2) Cập nhật secret/env theo từng service
#### 3) Kiểm tra nhanh
```bash
# Kiểm tra user ACL đã có
kubectl exec -n db sts/redis-master -- redis-cli -a '<redis-admin-password>' ACL LIST



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
helm uninstall linkerd-control-plane -n linkerd
helm uninstall linkerd-crds -n linkerd

# Xóa namespaces
kubectl delete namespace storage argo monitoring db cert-manager ingress-nginx linkerd
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
