# Deploy Local — Docker Compose

> **Lưu ý trước khi bắt đầu:**
> - `deployment-center`, `deployment-worker`, `deployment-consumer` phụ thuộc K8s/Argo — sẽ báo lỗi khi chạy local. **Bình thường.** Core platform (CTFd + Contestant Portal + Gateway) vẫn hoạt động đầy đủ.
> - `PRIVATE_KEY` phải **giống nhau** ở tất cả services — kiểm tra kỹ trong `.env.local` trước khi chạy.

---

## Bước 1 — Prerequisites

Kiểm tra Docker đã cài chưa:

```bash
docker --version
docker compose version
```

Nếu chưa có: cài [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/).

---

## Bước 2 — Chuẩn bị thư mục

Chạy trong **Git Bash / WSL** (không dùng PowerShell):

```bash
# Di chuyển vào thư mục gốc của dự án
cd /đường/dẫn/đến/FCTF-Multiple_Contest

# Thư mục thay thế NFS cho local
mkdir -p ./local-nfs/challenges ./local-nfs/start-challenge ./local-nfs/file

# Dummy kubeconfig để deployment services không crash ngay khi start
mkdir -p ./local-kube
cat > ./local-kube/config << 'EOF'
apiVersion: v1
kind: Config
clusters: []
users: []
contexts: []
current-context: ""
EOF
```

---

## Bước 3 — Tạo file `.env.local`

**Bước 3.1:** Generate `PRIVATE_KEY`:

```bash
PRIVATE_KEY=$(openssl rand -hex 32)
echo "PRIVATE_KEY=$PRIVATE_KEY"
```

Copy giá trị output ra, dùng cho bước tiếp theo.

**Bước 3.2:** Tạo file `.env.local` (thay `REPLACE_WITH_YOUR_KEY` bằng key vừa generate):

```bash
cat > .env.local << 'EOF'
# ===== DATABASE =====
DATABASE_URL=mysql+pymysql://ctfd:ctfd@db/ctfd
DATABASE_PORT=3306
DB_CONNECTION=Server=db;Port=3306;Database=ctfd;Uid=ctfd;Pwd=ctfd;

# ===== REDIS =====
REDIS_URL=redis://cache:6379
REDIS_HOST=cache
REDIS_PORT=6379
REDIS_PASS=
REDIS_DB=0
HOST_CACHE=cache
REDIS_CONNECTION=cache:6379
REDIS_ADDR=cache:6379
REDIS_PASSWORD=

# ===== SECURITY =====
PRIVATE_KEY=REPLACE_WITH_YOUR_KEY

# ===== NFS (dùng folder local thay vì NFS thật) =====
NFS_MOUNT_PATH=/srv/nfs/share

# ===== DOCKER / IMAGE =====
UPLOAD_PROVIDER=filesystem
IMAGE_REPO=quachuoiscontainer/fctf
DOCKER_USERNAME=quachuoiscontainer

# ===== ARGO WORKFLOWS (dummy - deployment services sẽ lỗi nhưng các service khác OK) =====
ARGO_WORKFLOWS_URL=http://localhost:2746
ARGO_WORKFLOWS_TOKEN=dummy-token

# ===== CHALLENGE TEMPLATES =====
UP_CHALLENGE_TEMPLATE=up-challenge-template
START_CHALLENGE_TEMPLATE=start-chal-v2-template

# ===== ASP.NET SERVICES =====
ASPNETCORE_ENVIRONMENT=Development

# ===== DEPLOYMENT RESOURCES =====
DEPLOYMENT_SERVICE_API=http://deployment-center:5020
CPU_LIMIT=500m
CPU_REQUEST=100m
MEMORY_LIMIT=256Mi
MEMORY_REQUEST=128Mi
POW_DIFFICULTY_SECONDS=5

# ===== RABBITMQ =====
RABBIT_HOST=rabbitmq
RABBIT_USERNAME=fctf_producer
RABBIT_PASSWORD=fctf_pass
RABBIT_PORT=5672
RABBIT_VHOST=fctf_deploy

# ===== NETWORK =====
TCP_DOMAIN=localhost:1337

# ===== CONTESTANT PORTAL (browser URLs -> phải là localhost) =====
VITE_API_URL=http://localhost:5010
VITE_BASE_GATEWAY=localhost
VITE_HTTP_PORT=8888
VITE_TCP_PORT=1337
EOF
```

---

## Bước 4 — Tạo file `docker-compose.local.yml`

```bash
cat > docker-compose.local.yml << 'EOF'
services:

  # ── Database & Cache ────────────────────────────────────────────────

  db:
    image: mariadb:10.11
    ports:
      - "3306:3306"
    restart: always
    environment:
      - MARIADB_ROOT_PASSWORD=ctfd
      - MARIADB_USER=ctfd
      - MARIADB_PASSWORD=ctfd
      - MARIADB_DATABASE=ctfd
      - MARIADB_AUTO_UPGRADE=1
    volumes:
      - ./FCTF-ManagementPlatform/data/mysql:/var/lib/mysql
    networks:
      - fctf
    command: [mysqld, --character-set-server=utf8mb4, --collation-server=utf8mb4_unicode_ci, --max-connection=1000, --wait_timeout=28800, --log-warnings=0]

  cache:
    image: redis:7
    ports:
      - "6379:6379"
    restart: always
    volumes:
      - ./FCTF-ManagementPlatform/data/redis:/data
    networks:
      - fctf

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    restart: always
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin
    volumes:
      - ./local-rabbitmq:/var/lib/rabbitmq
    networks:
      - fctf

  # ── Admin Platform (CTFd) ───────────────────────────────────────────

  ctfd:
    build: ./FCTF-ManagementPlatform
    user: root
    restart: always
    ports:
      - "8000:8000"
    env_file:
      - .env.local
    volumes:
      - ./FCTF-ManagementPlatform/CTFd/logs:/var/log/CTFd
      - ./FCTF-ManagementPlatform/CTFd/uploads:/var/uploads
      - ./FCTF-ManagementPlatform:/opt/CTFd
      - ./local-nfs:/srv/nfs/share
    depends_on:
      - db
      - cache
    networks:
      - fctf
    entrypoint: sh -c "export PYTHONUNBUFFERED=1 && export FLASK_APP=CTFd:create_app && export FLASK_ENV=development && python ping.py && flask db upgrade && flask run --host=0.0.0.0 --port=8000 --reload"

  # ── Contestant Backend ──────────────────────────────────────────────

  contestant-be:
    build:
      context: ./ControlCenterAndChallengeHostingServer
      dockerfile: ContestantBE/Dockerfile
    restart: always
    ports:
      - "5010:5010"
    env_file:
      - .env.local
    environment:
      - ASPNETCORE_URLS=http://+:5010
    volumes:
      - ./local-nfs:/srv/nfs/share
    depends_on:
      - db
      - cache
    networks:
      - fctf

  # ── Contestant Portal (Frontend) ────────────────────────────────────

  contestant-portal:
    build:
      context: ./ContestantPortal
      dockerfile: docker/Dockerfile
    restart: always
    ports:
      - "3000:8080"
    env_file:
      - .env.local
    networks:
      - fctf

  # ── Challenge Gateway ───────────────────────────────────────────────

  challenge-gateway:
    build:
      context: ./ChallengeGateway
      dockerfile: Dockerfile
    restart: always
    ports:
      - "8888:8080"
      - "1337:1337"
    env_file:
      - .env.local
    environment:
      - REDIS_ADDR=cache:6379
      - REDIS_PASSWORD=
    depends_on:
      - cache
    networks:
      - fctf

  # ── Deployment Services (cần K8s/Argo — sẽ lỗi khi chạy local) ─────

  deployment-center:
    build:
      context: ./ControlCenterAndChallengeHostingServer
      dockerfile: DeploymentCenter/Dockerfile
    restart: on-failure
    ports:
      - "5020:5020"
    env_file:
      - .env.local
    environment:
      - ASPNETCORE_URLS=http://+:5020
      - KUBECONFIG=/root/.kube/config
    volumes:
      - ./local-kube/config:/root/.kube/config:ro
    depends_on:
      - db
      - cache
    networks:
      - fctf

  deployment-listener:
    build:
      context: ./ControlCenterAndChallengeHostingServer
      dockerfile: DeploymentListener/Dockerfile
    restart: on-failure
    ports:
      - "5030:5030"
    env_file:
      - .env.local
    environment:
      - ASPNETCORE_URLS=http://+:5030
      - KUBECONFIG=/root/.kube/config
    volumes:
      - ./local-kube/config:/root/.kube/config:ro
    depends_on:
      - db
      - cache
    networks:
      - fctf

  deployment-consumer:
    build:
      context: ./ControlCenterAndChallengeHostingServer
      dockerfile: DeploymentConsumer/Dockerfile
    restart: on-failure
    env_file:
      - .env.local
    depends_on:
      - db
      - cache
      - rabbitmq
    networks:
      - fctf

networks:
  fctf:
    driver: bridge
EOF
```

---

## Bước 5 — Setup RabbitMQ

> Chạy **sau khi** RabbitMQ container đã up (bước 6 bên dưới).

**Bước 5.1:** Đợi RabbitMQ sẵn sàng:

```bash
docker compose -f docker-compose.local.yml exec rabbitmq rabbitmqctl await_startup
```

**Bước 5.2:** Tạo vhost và users:

```bash
# Tạo vhost
docker compose -f docker-compose.local.yml exec rabbitmq rabbitmqctl add_vhost fctf_deploy

# Tạo user (do .env.local dùng fctf_producer chung cho các service)
docker compose -f docker-compose.local.yml exec rabbitmq rabbitmqctl add_user fctf_producer fctf_pass
```

**Bước 5.3:** Cấp quyền:

```bash
# Cấp toàn quyền (read, write, configure) cho fctf_producer để phục vụ local (cả Publish lẫn Consume)
docker compose -f docker-compose.local.yml exec rabbitmq rabbitmqctl set_permissions \
  -p fctf_deploy fctf_producer ".*" ".*" ".*"

# Cấp quyền cho admin để được phép dùng rabbitmqadmin tạo exchange/queue
docker compose -f docker-compose.local.yml exec rabbitmq rabbitmqctl set_permissions \
  -p fctf_deploy admin ".*" ".*" ".*"
```

**Bước 5.4:** Tạo exchange, queue, binding:

```bash
docker compose -f docker-compose.local.yml exec rabbitmq \
  rabbitmqadmin -u admin -p admin -V fctf_deploy \
  declare exchange name=deployment_exchange type=direct

docker compose -f docker-compose.local.yml exec rabbitmq \
  rabbitmqadmin -u admin -p admin -V fctf_deploy \
  declare queue name=deployment_queue durable=true

docker compose -f docker-compose.local.yml exec rabbitmq \
  rabbitmqadmin -u admin -p admin -V fctf_deploy \
  declare binding source=deployment_exchange destination=deployment_queue routing_key=deploy
```

---

## Bước 6 — Chạy

**Start db, cache, rabbitmq trước:**

```bash
# Di chuyển vào thư mục gốc của dự án
cd /đường/dẫn/đến/FCTF-Multiple_Contest

docker compose -f docker-compose.local.yml --env-file .env.local up -d db cache rabbitmq
```

Sau khi RabbitMQ sẵn sàng (bước 5), **start toàn bộ:**

```bash
# Build và start tất cả (lần đầu ~10-20 phút)
docker compose -f docker-compose.local.yml --env-file .env.local up --build -d
```

**Xem logs:**

```bash
# Tất cả services
docker compose -f docker-compose.local.yml logs -f

# Từng service
docker compose -f docker-compose.local.yml logs -f ctfd
docker compose -f docker-compose.local.yml logs -f contestant-be
docker compose -f docker-compose.local.yml logs -f challenge-gateway
```

---

## Bước 7 — Truy cập

| URL | Service |
|-----|---------|
| http://localhost:8000 | Admin Platform (CTFd) |
| http://localhost:3000 | Contestant Portal |
| http://localhost:8888 | Challenge Gateway (HTTP) |
| http://localhost:1337 | Challenge Gateway (TCP) |
| http://localhost:5010 | Contestant API |
| http://localhost:15672 | RabbitMQ Management — `admin / admin` |

> Lần đầu truy cập `localhost:8000` sẽ có **wizard setup** — tạo admin account tại đây.

---

## Dừng hệ thống

```bash
# Dừng
docker compose -f docker-compose.local.yml down

# Dừng và xóa toàn bộ data (reset hoàn toàn)
docker compose -f docker-compose.local.yml down -v
rm -rf ./FCTF-ManagementPlatform/data/mysql
rm -rf ./FCTF-ManagementPlatform/data/redis
```
