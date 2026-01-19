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
sudo apt install -y curl wget git nano vim net-tools

# Cấu hình timezone
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
```

### 2. Cài đặt K3s Master Node
# Trên config node
```bash
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: 250
EOF
```
**Cho Production (Cloud serrver):**
# cài đặt k3s master-node là ip public của server
```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --disable traefik \
  --flannel-backend=none \
  --disable-network-policy \
  --kubelet-arg=config=/etc/rancher/k3s/kubelet.config \
  --write-kubeconfig-mode=644 \
  --tls-san 34.142.167.47" sh -
```

# cài k3s worker-node là ip private của server
```bash
# Lấy master node token
sudo cat /var/lib/rancher/k3s/server/node-token

# Cài k3s worker-node
# Truy cập vào worker-node và chạy lệnh này để join vào master node
curl -sfL https://get.k3s.io | K3S_URL=https://10.148.0.8:6443 \
  K3S_TOKEN=K1093ecca6c22d2a61c98a88ea654638744c52d46cc09ed4cf8649434312c3af985::server:27a1c0290ab435fbcbd59754dc967345 \
  INSTALL_K3S_EXEC="agent --kubelet-arg=config=/etc/rancher/k3s/kubelet.config" sh -
```

**Cho Development (Local, WSL...):**
```bash
# Cài K3s đơn giản hơn, không cần domain

curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --disable traefik \
  --flannel-backend=none \
  --disable-network-policy \
  --kubelet-arg=config=/etc/rancher/k3s/kubelet.config \
  --write-kubeconfig-mode=644" sh -
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
# Ví dụ tôi có 10.148.0.8 
# Cần sửa trong prod\storage\nfs-pv-pvc.yaml phàn spec.nfs.server ở đây thay thế bằng IP của bạn 
# Cần sửa trong file helm.yaml phần "cài k3s worker-node là ip private của server" thay thế bằng ip server của bạn nếu cần cái node-worker
# Tương tự những chỗ mount nfs ở các file sau  
#    prod\app\admin-mvc\deployment.yaml 
#    prod\app\contestant-be\deployment.yaml
#    prod\argo-workflows\start-chal-v2\start-chal-v2-template.yaml
#    prod\argo-workflows\up-challenge\up-challenge-template.yaml

# Cấu hình nodeSelector / hostname
# Kiểm tra hostname node trong cluster:
kubectl get nodes
# Cập nhật đúng tên hostname của server chứa nfs trong các file sau phần kubernetes.io/hostname
#    prod\helm\db\mariadb\maria-values.yaml
#    prod\helm\db\mariadb\redis-values.yaml

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
# Vào folder FCTF-k3s-manifest/prod
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

# Apply ConfigMaps và Secrets
kubectl apply -f ./prod/env/configmap/
kubectl apply -f ./prod/env/secret/

# Deploy applications
kubectl apply -f ./prod/app/admin-mvc/
kubectl apply -f ./prod/app/contestant-be/
kubectl apply -f ./prod/app/contestant-portal/
kubectl apply -f ./prod/app/deployment-center/
kubectl apply -f ./prod/app/deployment-listener/

# Ở đây có 2 cách bạn có thể chuyển đổi qua lại
# Apply NodePort services: Nếu Ở môi trường local, ingress domain không hoạt động. sử dụng cách này**
kubectl apply -f ./prod/app/service-nodeport.yaml
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
kubectl apply -f ./cron-job/delete-chal-job.yaml 
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
helm uninstall cert-manager -n cert-manager
helm uninstall ingress-nginx -n ingress-nginx

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
