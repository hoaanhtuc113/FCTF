# Kubectl Docker Image

Docker image chứa kubectl CLI để tương tác với Kubernetes.

## 1. Login Harbor

```bash
docker login registry.fctf.site
```

## 2. Build va Push nhanh bang script

```bash
chmod +x ./build-push-kubectl-cli.sh
./build-push-kubectl-cli.sh
```

Neu can truyen credentials truc tiep:

```bash
HARBOR_USER='<harbor-user>' HARBOR_PASSWORD='<harbor-password>' ./build-push-kubectl-cli.sh
```

## 3. Build va Push thu cong

```bash
# Build image
docker build -t registry.fctf.site/fctf/kubectl-cli:latest -f ./dockerfile .

# Push image
docker push registry.fctf.site/fctf/kubectl-cli:latest
```

## 4. Su dung

```bash
# Pull image
docker pull registry.fctf.site/fctf/kubectl-cli:latest

# Chay kubectl (can mount kubeconfig)
docker run --rm \
  -v ~/.kube/config:/root/.kube/config \
  registry.fctf.site/fctf/kubectl-cli:latest \
  kubectl get pods
```

### MacOS (buildx - build va push cung luc)
```bash
docker buildx build \
  --platform linux/amd64 \
  -t registry.fctf.site/fctf/kubectl-cli:latest \
  --push \
  .
```

## Thông tin

- **Image**: `registry.fctf.site/fctf/kubectl-cli:latest`
- **Base**: Alpine Linux 3.20
- **Kubectl**: v1.34.0 