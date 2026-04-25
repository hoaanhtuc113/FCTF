# FCTF Platform — Tổng Hợp URL & Tài Khoản Các Service

> [!CAUTION]
> Tài liệu này chứa **toàn bộ credentials** của hệ thống. **KHÔNG** chia sẻ public.
> Các giá trị `<PLACEHOLDER>` cần được thay thế bằng domain/IP thực tế khi deploy (chạy `configure-domains.sh`).

---

## 1. Service URLs (Production — qua Ingress HTTPS)

| # | Service | Domain Placeholder | Ingress Port | Mô tả |
|---|---|---|---|---|
| 1 | **Contestant Portal** | `https://<CONTESTANT_DOMAIN>` | 443 → svc `contestant-portal-svc:5173` | Giao diện thi sinh |
| 2 | **Contestant API** | `https://<CONTESTANT_API_DOMAIN>` | 443 → svc `contestant-be-svc:5010` | REST API cho thí sinh |
| 3 | **Admin Panel (CTFd)** | `https://<ADMIN_DOMAIN>` | 443 → svc `admin-mvc-svc:8000` | Quản trị CTF (Management Platform) |
| 4 | **Challenge Gateway** | `<GATEWAY_DOMAIN>` | TCP `:30037` / HTTP `:30038` | Proxy truy cập challenge instances |
| 5 | **Argo Workflows** | `https://<ARGO_DOMAIN>` | 443 → svc `argo-workflows-server:2746` | CI/CD workflow cho challenge |
| 6 | **Grafana** | `https://<GRAFANA_DOMAIN>` | 443 → svc `prometheus-grafana:80` | Monitoring dashboard |
| 7 | **RabbitMQ Management** | `https://<RABBITMQ_DOMAIN>` | 443 → svc `rabbitmq:15672` | Message queue management UI |
| 8 | **Harbor Registry** | `https://<REGISTRY_DOMAIN>` | 443 → svc `harbor:80` | Docker image registry |
| 9 | **Rancher** | `https://<RANCHER_DOMAIN>` | 443 → svc `rancher:443` | K8s cluster management UI |

### NodePort Fallback (khi chưa có domain)

| Service | NodePort | Truy cập |
|---|---|---|
| Admin Panel | `30080` | `http://MASTER_IP:30080` |
| Contestant Portal | `30517` | `http://MASTER_IP:30517` |
| Contestant API | `30501` | `http://MASTER_IP:30501` |
| MariaDB | `30306` | `MASTER_IP:30306` |
| Redis | `30320` | `MASTER_IP:30320` |
| Challenge Gateway TCP | `30037` | `MASTER_IP:30037` |
| Challenge Gateway HTTP | `30038` | `MASTER_IP:30038` |

### Port-Forward (dev/debug)

```bash
kubectl port-forward -n app svc/contestant-portal 8080:80 --address=0.0.0.0 &
kubectl port-forward -n app svc/contestant-be 5000:80 --address=0.0.0.0 &
kubectl port-forward -n app svc/admin-mvc 4000:8000 --address=0.0.0.0 &
```

---

## 2. Database — MariaDB

| Key | Value |
|---|---|
| **Internal Host** | `mariadb-headless.db.svc.cluster.local` |
| **Port** | `3306` |
| **Database** | `ctfd` |
| **Root Password** | `cm9vdC1jdGZkLXBhc3N3b3JkQA` |
| **Default User** | `ctfd-username` |
| **Default Password** | `5od4k6jgcmobfavNtTCddADlum1agrRUPOhKA0LA3WFiYxckWz` |
| **Replication Password** | `VAT1zd53iPs8yC2CReYvyyCksQZGbsFX0fqazyso1MkeywIBIP` |
| **TLS** | Enabled (auto-generated) |

### Per-Service DB Users (tạo bởi rotate-service-passwords.sh)

| Service | DB User | Password |
|---|---|---|
| Admin MVC (CTFd) | `ctfd-username` | `5od4k6jgcmobfavNtTCddADlum1agrRUPOhKA0LA3WFiYxckWz` |
| Contestant BE | `contestant_be` | `NKtFmlmqOKWCqmAkE8ICZAykAsTwasu5fWxdpvCeEYBgWeNbKS` |
| Deployment Center | `deployment_center` | `2ePNjWVf2bPhnXA5bKXNMQDkmziaJT9PqDPkaSbmcutzkzUL89` |
| Deployment Consumer | `deployment_consumer` | `UCEoSbGsU2haYN1jwFPP0JhOBqlGgC1IlociA8i5wIGageGOHF` |
| Deployment Listener | `deployment_listener` | `iHOu7LxTV0cggemLl2NfDOY6Qq0u6MgueurDCNfwFcU3Awx47H` |

### Connection Strings

```
# Admin MVC (Python/SQLAlchemy)
mysql+pymysql://ctfd-username:5od4k6jgcmobfavNtTCddADlum1agrRUPOhKA0LA3WFiYxckWz@mariadb-headless.db.svc.cluster.local:3306/ctfd

# .NET Services
Server=mariadb-headless.db.svc.cluster.local;Port=3306;Database=ctfd;User=<USER>;Password=<PASSWORD>;
```

---

## 3. Cache — Redis

| Key | Value |
|---|---|
| **Internal Host** | `redis-headless.db.svc.cluster.local` |
| **Port** | `6379` |
| **Master Password** | `Fctf2025@` |
| **TLS** | Enabled (auto-generated) |
| **ACL** | Enabled |
| **Architecture** | Standalone |

### Redis ACL Users (per-service)

| Service | Username | Password |
|---|---|---|
| Admin MVC | `svc_admin_mvc` | `AdmMvcRedis2026A` |
| Challenge Gateway | `svc_gateway` | `GwRedis2026A` |
| Contestant BE | `svc_contestant_be` | `CbeRedis2026A` |
| Deployment Center | `svc_deployment_center` | `DpcRedis2026A` |
| Deployment Consumer | `svc_deployment_consumer` | `DpsCRedis2026A` |
| Deployment Listener | `svc_deployment_listener` | `DpsLRedis2026A` |

### Redis Connection Strings

```
# Admin MVC (Python/Redis URL)
rediss://svc_admin_mvc:AdmMvcRedis2026A@redis-headless.db.svc.cluster.local:6379/0?ssl_cert_reqs=none

# .NET Services
redis-headless.db.svc.cluster.local:6379,user=<USERNAME>,password=<PASSWORD>,defaultDatabase=0,ssl=true,sslProtocols=Tls12
```

---

## 4. Message Queue — RabbitMQ

| Key | Value |
|---|---|
| **Internal Host** | `rabbitmq.db.svc.cluster.local` |
| **AMQP Port (TLS)** | `5671` |
| **AMQP Port (plain)** | `5672` |
| **Management Port** | `15672` |
| **VHost** | `fctf_deploy` |
| **TLS** | Enabled (auto-generated) |

### RabbitMQ Users

| Role | Username | Password |
|---|---|---|
| **Admin** | `rabbit-admin` | `Fctf2025@admin` |
| Producer (Deployment Center) | `deployment-producer` | `Fctf2025@producer` |
| Consumer (Deployment Consumer) | `deployment-consumer` | `Fctf2025@consumer` |

### RabbitMQ Topology

| Resource | Value |
|---|---|
| Exchange | `deployment_exchange` (direct, durable) |
| Queue | `deployment_queue` (durable, max-length: 300) |
| Binding | `deployment_exchange` → `deployment_queue` (routing key: `deploy`) |

---

## 5. Harbor Registry

| Key | Value |
|---|---|
| **URL** | `https://<REGISTRY_DOMAIN>` |
| **Admin User** | `admin` |
| **Admin Password** | `FCTF@2025` |
| **Project** | `fctf` (Private) |
| **Secret Key** | `oMT66fZeAVeVE1lLgI6bgn9dQInYWCuOWyGGKYXDDTCh1K8nKj` |

### Harbor Robot Account (CI/CD)

| Key | Value |
|---|---|
| **Username** | `robot$fctf-ci` |
| **Password** | `aJet6hYxBRw3cUOoScSoZ6bslu8cWR4O` |

> Robot account được dùng cho Kaniko build (Argo Workflows) và image pull trong namespace `app` + `argo`.

---

## 6. Rancher

| Key | Value |
|---|---|
| **URL** | `https://<RANCHER_DOMAIN>` |
| **Bootstrap Password** | `Ab@123456789` |

> Sau lần đăng nhập đầu tiên, Rancher sẽ yêu cầu đổi password.

---

## 7. Grafana (Prometheus Stack)

| Key | Value |
|---|---|
| **URL** | `https://<GRAFANA_DOMAIN>` |
| **Default Admin User** | `admin` |
| **Default Admin Password** | `Fctf2025@` |

---

## 8. Argo Workflows

| Key | Value |
|---|---|
| **URL** | `https://<ARGO_DOMAIN>` |
| **Internal API** | `http://argo-workflows-server.argo.svc.cluster.local:2746/api/v1/workflows/argo` |
| **Auth** | Server mode (token-based, configuration-dependent) |

---

## 9. Application Secrets

| Secret | Value |
|---|---|
| **CTFd SECRET_KEY** | `emdungdepzai` |
| **Common PRIVATE_KEY** (JWT signing) | `emdungdepzai_secret_key_fctf_platform_2025` |
| **Cloudflare Turnstile Secret** | *(chưa cấu hình — empty)* |

---

## 10. Internal Service URLs (Cluster DNS)

| Service | Internal URL | Port |
|---|---|---|
| **Admin MVC** | `admin-mvc-svc.app.svc.cluster.local` | `8000` |
| **Contestant Portal** | `contestant-portal-svc.app.svc.cluster.local` | `5173` |
| **Contestant BE** | `contestant-be-svc.app.svc.cluster.local` | `5010` |
| **Deployment Center** | `deployment-center-svc.app.svc.cluster.local` | `5020` |
| **Deployment Listener** | *(no ClusterIP svc exposed)* | `5030` |
| **MariaDB** | `mariadb-headless.db.svc.cluster.local` | `3306` |
| **Redis** | `redis-headless.db.svc.cluster.local` | `6379` |
| **RabbitMQ** | `rabbitmq.db.svc.cluster.local` | `5671` (TLS) / `5672` |
| **Argo Server** | `argo-workflows-server.argo.svc.cluster.local` | `2746` |
| **Loki** | `loki-stack.monitoring.svc.cluster.local` | `3100` |
| **Grafana** | `prometheus-grafana.monitoring.svc.cluster.local` | `80` |

---

## 11. Local Development (docker-compose.dev.yml)

| Service | Port | User | Password |
|---|---|---|---|
| **MariaDB** | `localhost:3306` | `root` / `fctf_user` | `root_password` / `fctf_password` |
| **Redis** | `localhost:6379` | *(no ACL)* | `redis_password` |
| **RabbitMQ AMQP** | `localhost:5672` | `admin` | `rabbitmq_password` |
| **RabbitMQ UI** | `http://localhost:15672` | `admin` | `rabbitmq_password` |

Local dev database: `ctfd`, VHost: `fctf_deploy`

---

## 12. Tổng Hợp Nhanh — Bảng Master

| Service | URL / Host | Username | Password |
|---|---|---|---|
| MariaDB (root) | `mariadb-headless.db:3306` | `root` | `cm9vdC1jdGZkLXBhc3N3b3JkQA` |
| MariaDB (app) | `mariadb-headless.db:3306` | `ctfd-username` | `5od4k...YxckWz` |
| Redis | `redis-headless.db:6379` | *(master)* | `Fctf2025@` |
| RabbitMQ | `rabbitmq.db:5671` | `rabbit-admin` | `Fctf2025@admin` |
| Harbor | `https://<REGISTRY_DOMAIN>` | `admin` | `FCTF@2025` |
| Harbor Robot | `<REGISTRY_DOMAIN>` | `robot$fctf-ci` | `aJet6h...cWR4O` |
| Rancher | `https://<RANCHER_DOMAIN>` | `admin` | `Ab@123456789` |
| Grafana | `https://<GRAFANA_DOMAIN>` | `admin` | `Fctf2025@` |
| Argo | `https://<ARGO_DOMAIN>` | — | *(token-based)* |
| Admin Panel | `https://<ADMIN_DOMAIN>` | *(CTFd setup)* | *(CTFd setup)* |
| Contestant Portal | `https://<CONTESTANT_DOMAIN>` | — | — |
| Contestant API | `https://<CONTESTANT_API_DOMAIN>` | — | — |
| Gateway | `<GATEWAY_DOMAIN>:30037/30038` | — | — |

> [!WARNING]
> Tất cả password mặc định trên **NÊN được rotate** trước khi deploy production bằng script `rotate-service-passwords.sh`.
