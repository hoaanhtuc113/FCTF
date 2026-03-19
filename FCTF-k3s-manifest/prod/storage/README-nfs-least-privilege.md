# NFS least-privilege theo ma trận quyền

Tài liệu này cấu hình NFS theo ma trận bạn cung cấp:

| Service/Workflow | /Challenges | /Start-challenge | /file |
|---|---|---|---|
| admin-mvc | rwx | - | rwx |
| filebrowser | rwx | rwx | rwx |
| contestant-be | - | - | r-x |
| up-challenge-workflow | - | - | r-x |
| start-challenge-workflow | - | r-x | - |

## 1) Cấu hình `/etc/exports` chuẩn theo từng thư mục

> Lưu ý quan trọng: NFS export phân quyền theo **client IP/CIDR**, không phân biệt service trong Kubernetes.
> Nếu nhiều service chạy cùng node/CIDR thì không thể tách tuyệt đối chỉ bằng `/etc/exports`.

Mẫu cấu hình (dùng 1 CIDR chung cho worker nodes):

```exports
/srv/nfs/share/Challenges <WORKER_NODE_CIDR>(rw,sync,no_subtree_check,root_squash,sec=sys)
/srv/nfs/share/start-challenge <WORKER_NODE_CIDR>(rw,sync,no_subtree_check,root_squash,sec=sys)
/srv/nfs/share/file <WORKER_NODE_CIDR>(rw,sync,no_subtree_check,root_squash,sec=sys)
```

Áp dụng:

```bash
sudo exportfs -ra
sudo exportfs -v
showmount -e localhost
```

## 2) Tạo thư mục NFS theo đúng scope

```bash
sudo mkdir -p /srv/nfs/share/Challenges
sudo mkdir -p /srv/nfs/share/start-challenge
sudo mkdir -p /srv/nfs/share/file
sudo chmod 2775 /srv/nfs/share/Challenges /srv/nfs/share/start-challenge /srv/nfs/share/file
```

## 3) PV/PVC riêng cho từng service/workflow

File manifest:

- [prod/storage/pv/admin-mvc-pv.yaml](prod/storage/pv/admin-mvc-pv.yaml)
- [prod/storage/pv/contestant-be-pv.yaml](prod/storage/pv/contestant-be-pv.yaml)
- [prod/storage/pv/up-challenge-workflow-pv.yaml](prod/storage/pv/up-challenge-workflow-pv.yaml)
- [prod/storage/pv/start-challenge-workflow-pv.yaml](prod/storage/pv/start-challenge-workflow-pv.yaml)
- [prod/storage/pv/filebrowser-pv.yaml](prod/storage/pv/filebrowser-pv.yaml)
- [prod/storage/pvc/admin-mvc-pvc.yaml](prod/storage/pvc/admin-mvc-pvc.yaml)
- [prod/storage/pvc/contestant-be-pvc.yaml](prod/storage/pvc/contestant-be-pvc.yaml)
- [prod/storage/pvc/up-challenge-workflow-pvc.yaml](prod/storage/pvc/up-challenge-workflow-pvc.yaml)
- [prod/storage/pvc/start-challenge-workflow-pvc.yaml](prod/storage/pvc/start-challenge-workflow-pvc.yaml)
- [prod/storage/pvc/filebrowser-pvc.yaml](prod/storage/pvc/filebrowser-pvc.yaml)

Apply:

```bash
kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace argo --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f prod/storage/pv/admin-mvc-pv.yaml
kubectl apply -f prod/storage/pv/contestant-be-pv.yaml
kubectl apply -f prod/storage/pv/up-challenge-workflow-pv.yaml
kubectl apply -f prod/storage/pv/start-challenge-workflow-pv.yaml
kubectl apply -f prod/storage/pv/filebrowser-pv.yaml

kubectl apply -f prod/storage/pvc/admin-mvc-pvc.yaml
kubectl apply -f prod/storage/pvc/contestant-be-pvc.yaml
kubectl apply -f prod/storage/pvc/up-challenge-workflow-pvc.yaml
kubectl apply -f prod/storage/pvc/start-challenge-workflow-pvc.yaml
kubectl apply -f prod/storage/pvc/filebrowser-pvc.yaml
```

Kiểm tra:

```bash
kubectl get pv
kubectl get pvc -n app
kubectl get pvc -n argo
kubectl get pvc -n storage
```

## 4) Trạng thái hiện tại

- Đã chuyển workload sang `persistentVolumeClaim`.
- Đã áp dụng `securityContext` cho Pod/Container liên quan.
- `contestant-be`, `up-challenge-workflow`, `start-chal-v2-workflow` đang mount `readOnly: true` ở phần cần chỉ-đọc.
- `admin-mvc` và `filebrowser` được mount RW đúng phạm vi cần ghi.
