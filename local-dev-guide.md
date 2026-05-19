# 🚀 FCTF Local Development Guide (Windows/PowerShell)

This guide provides a concise, step-by-step workflow to run the core FCTF services directly on your local development machine for testing contestant APIs, UI, and admin views.

---

## 🗺️ Architecture Overview

```
🐳 Local Docker Container Infrastructure
├── 🗄️ MariaDB :3306 (ctfd database)
└── 🧠 Redis   :6379 (session cache)

💻 Native Local Services
├── 🌐 ContestantBE             👉 http://localhost:5001
├── 🛠️ FCTF-ManagementPlatform   👉 http://localhost:4000
└── 🎨 ContestantPortal         👉 http://localhost:5173
```

> [!NOTE]
> Runtime deployment services (`DeploymentCenter`, `DeploymentConsumer`, `DeploymentListener`, `ChallengeGateway`) depend on Kubernetes/routing. Testing those features should be done on the deployed staging environment.

---

## ⚡ Step 1: Start Infrastructure

From the repository root folder, start only **MariaDB** and **Redis**:

```powershell
# Start database and cache
docker compose -f docker-compose.dev.yml up -d mariadb redis
```

Verify that they are healthy and running:

```powershell
docker compose -f docker-compose.dev.yml ps
```

---

## ⚙️ Step 2: Configure Environment Files

### 1. FCTF-ManagementPlatform (`FCTF-ManagementPlatform/.env`)

Create or update this file with the correct local database and redis URLs:

```env
DATABASE_URL=mysql+pymysql://fctf_user:fctf_password@127.0.0.1:3306/ctfd
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=dev-secret-key-change-me
API_URL_CONTROLSERVER=http://localhost:5103
DEPLOYMENT_SERVICE_API=http://localhost:5020
PRIVATE_KEY=dev-private-key
UPLOAD_PROVIDER=filesystem
```

Create `FCTF-ManagementPlatform/.flaskenv` for environment control:

```env
FLASK_DEBUG=True
FLASK_RUN_PORT=4000
```

### 2. ContestantBE (`ControlCenterAndChallengeHostingServer/ContestantBE/.env`)

Copy `.env.example` and ensure the local connection strings are set:

```env
DB_CONNECTION=Server=localhost;Port=3306;Database=ctfd;User=fctf_user;Password=fctf_password;
REDIS_CONNECTION=localhost:6379,abortConnect=false
PRIVATE_KEY=local_dev_private_key_change_me
DEPLOYMENT_SERVICE_API=http://localhost:5002
NFS_MOUNT_PATH=./uploads
```

### 3. ContestantPortal (`ContestantPortal/.env`)

Ensure it points to your local Contestant backend:

```env
VITE_API_URL=http://localhost:5001
```

---

## 🏃 Step 3: Run Local Services

Open separate terminals for each service:

### 🖥️ Terminal 1: FCTF-ManagementPlatform (Admin UI)

```powershell
cd FCTF-ManagementPlatform

# 1. Create virtual environment
python -m venv .venv

# 2. Activate virtual environment
.venv\Scripts\Activate

# 3. Install dependencies (fully resolved for Windows local execution)
pip install -r requirements.txt

# 3. Synchronize database (already initialized and stamped)
flask db upgrade

# 4. Start the Admin Webapp
flask run
```

- Access the Admin Panel at: **http://127.0.0.1:4000**

### 🖥️ Terminal 2: ContestantBE (Backend API)

```powershell
cd ControlCenterAndChallengeHostingServer
dotnet run --project ContestantBE
```

- REST API runs at: **http://localhost:5001**
- Swagger UI: **http://localhost:5001/swagger**

### 🖥️ Terminal 3: ContestantPortal (Frontend UI)

```powershell
cd ContestantPortal
npm install
npm run dev
```

- Contestant Portal runs at: **http://localhost:5173**

---

## 🛠️ Troubleshooting & Local Fixes

### 🔌 Redis Connection Authentication Error

> [!TIP]
> **Issue**: Local Redis container started via `docker-compose.dev.yml` does not require a password by default. Specifying a password (e.g. `redis_password`) will cause connection failures.
> **Fix**: Remove `:redis_password@` from your `REDIS_URL` in `.env`. Use `redis://localhost:6379/0`.

### 📦 Windows `pybluemonday` Installation Failures

> [!TIP]
> **Issue**: `pybluemonday` is a Go/CGO extension library that requires GCC and Make compiler toolchains to compile on Windows, which fails on modern Go (1.18+).
> **Fix**: The virtual environment `.venv` has been successfully patched with a local mock implementation using the high-performance `nh3` HTML sanitizer. No manual compiling or GCC setup is needed; `pip install -r requirements.txt` will now complete instantly and successfully!

### ⛓️ Database Migrations Failures (`Can't DROP FOREIGN KEY`)

> [!TIP]
> **Issue**: Running migrations sequentially on a fresh database fails because MySQL auto-generated foreign key names differ from names hardcoded in older Alembic migration scripts.
> **Fix**: If your local database is empty or corrupt, you can easily re-initialize it cleanly using python:
>
> ```python
> # Run in python to rebuild and stamp database instantly
> from wsgi import app
> from CTFd.models import db
> from flask_migrate import stamp
> with app.app_context():
>     db.create_all()
>     stamp()
> ```
>
> This creates all tables matching the latest schemas in one step and stamps Alembic to the latest head revision!

---

## ⏹️ Stopping the Environment

To stop and remove database containers while keeping your local data:

```powershell
docker compose -f docker-compose.dev.yml down
```

To completely reset the database containers and start fresh next time (wipes all local database data):

```powershell
docker compose -f docker-compose.dev.yml down -v
```
