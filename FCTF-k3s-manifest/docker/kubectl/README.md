# Kubectl Docker Image

Docker image chứa kubectl CLI để tương tác với Kubernetes.

## 1. Login DockerHub

```bash
docker login
# Nhập username và password DockerHub
```

## 2. Build và Tag Image

```bash
# Build image
docker build -t quachuoiscontainer/kubectl-cli:v0.0.1 .

# Tag cho DockerHub (nếu cần)
docker tag quachuoiscontainer/kubectl-cli:v0.0.1 quachuoiscontainer/kubectl-cli:latest
```

## 3. Push Image

```bash
# Push version cụ thể
docker push quachuoiscontainer/kubectl-cli:v0.0.1

# Push latest tag
docker push quachuoiscontainer/kubectl-cli:latest
```

### MacOS (buildx - build và push cùng lúc)
```bash
docker buildx build \
  --platform linux/amd64 \
  -t quachuoiscontainer/kubectl-cli:v0.0.1 \
  --push \
  .
```

## 4. Sử dụng

```bash
# Pull image
docker pull quachuoiscontainer/kubectl-cli:v0.0.1

# Chạy kubectl (cần mount kubeconfig)
docker run --rm \
  -v ~/.kube/config:/root/.kube/config \
  quachuoiscontainer/kubectl-cli:v0.0.1 \
  kubectl get pods
```

## Thông tin

- **Image**: `quachuoiscontainer/kubectl-cli:v0.0.1`
- **Base**: Alpine Linux 3.20
- **Kubectl**: v1.34.0 