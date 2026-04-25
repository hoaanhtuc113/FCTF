# Python Flask trong Hệ Thống FCTF

> **Tài liệu:** Giới thiệu công nghệ Python Flask  
> **Dự án:** FCTF-temp-v5 (CTF Platform)  
> **Ngày soạn:** 10/04/2026  
> **Mục tiêu:** Giúp các thành viên nhóm hiểu Python Flask là gì, tại sao dùng, và hoạt động như thế nào trong hệ thống

---

## 📌 Mục Lục

1. [Python Flask là gì?](#1-python-flask-là-gì)
2. [CTFd là gì và tại sao FCTF fork nó?](#2-ctfd-là-gì-và-tại-sao-fctf-fork-nó)
3. [Flask được dùng ở đâu trong FCTF?](#3-flask-được-dùng-ở-đâu-trong-fctf)
4. [Cấu trúc project FCTF-ManagementPlatform](#4-cấu-trúc-project-fctf-managementplatform)
5. [Các khái niệm Flask quan trọng trong dự án](#5-các-khái-niệm-flask-quan-trọng-trong-dự-án)
6. [Luồng hoạt động thực tế — Minh họa bằng code](#6-luồng-hoạt-động-thực-tế--minh-họa-bằng-code)
7. [Tích hợp với hệ thống C# như thế nào?](#7-tích-hợp-với-hệ-thống-c-như-thế-nào)
8. [Python dependencies quan trọng](#8-python-dependencies-quan-trọng)
9. [Tóm tắt vai trò Flask trong hệ thống](#9-tóm-tắt-vai-trò-flask-trong-hệ-thống)

---

## 1. Python Flask Là Gì?

**Python Flask** là một **microframework web** viết bằng Python. "Micro" không có nghĩa là nhỏ hay thiếu tính năng — mà có nghĩa là Flask giữ core đơn giản nhưng cho phép mở rộng linh hoạt thông qua extensions.

### So sánh Flask với các framework Python khác

| Framework | Đặc điểm | Khi nào dùng |
|---|---|---|
| **Flask** | Microframework, linh hoạt, ít opinionated | API nhỏ-vừa, portal admin, rapid prototype |
| **Django** | Full-stack, batteries included (ORM, admin, auth) | Ứng dụng lớn cần nhiều tính năng sẵn có |
| **FastAPI** | Modern, async, auto OpenAPI docs | API hiệu năng cao, microservices |

### Tại sao FCTF dùng Flask (thông qua CTFd)?

| Lý do | Giải thích |
|---|---|
| **CTFd là open-source Flask app** | FCTF kế thừa toàn bộ admin portal từ CTFd — tiết kiệm hàng nghìn giờ lập trình |
| **Jinja2 templating** | Flask dùng Jinja2 — render HTML trực tiếp phía server cho admin UI |
| **SQLAlchemy ORM** | ORM mạnh mẽ, tương thích tốt với MariaDB |
| **Ecosystem phong phú** | Flask extensions: Flask-Migrate, Flask-Caching, Flask-CORS, Flask-RESTx,... |
| **Rapid development** | Python rất nhanh để viết feature mới, đặc biệt cho admin tools |

---

## 2. CTFd Là Gì Và Tại Sao FCTF Fork Nó?

### CTFd là gì?

**CTFd** (Capture The Flag daemon) là một nền tảng CTF **open-source** nổi tiếng, được dùng rộng rãi trên toàn thế giới để tổ chức các cuộc thi hacking/security. Nó bao gồm sẵn:

- ✅ Quản lý challenge (tạo/sửa/xóa)
- ✅ Hệ thống đăng ký user và team
- ✅ Submit flag và tính điểm
- ✅ Bảng xếp hạng
- ✅ Admin dashboard đầy đủ
- ✅ Plugin system mở rộng

### Tại sao FCTF fork CTFd?

FCTF cần những tính năng mà CTFd tiêu chuẩn không có:

| Tính năng cần thêm | Lý do |
|---|---|
| **Dynamic challenge deployment** | Deploy Docker container per-team lên Kubernetes |
| **Trường `ImageLink`** | Lưu thông tin Docker image (registry, tag, ports) |
| **Trường `TimeLimit`, `CpuLimit`, `MemoryLimit`** | Giới hạn tài nguyên cho từng challenge |
| **Trường `UseGvisor`, `HardenContainer`** | Security sandbox cho pwn/rev challenges |
| **Quản lý instance chạy** | Xem & dừng tất cả pod đang chạy của mọi team |
| **Tích hợp Argo Workflows** | Build & push Docker image tự động |
| **API start/stop challenge cho admin** | Gọi DeploymentCenter API từ admin portal |

> **FCTF-ManagementPlatform = CTFd fork đã được tùy chỉnh** để tích hợp với hạ tầng Kubernetes của FCTF.

---

## 3. Flask Được Dùng Ở Đâu Trong FCTF?

Trong toàn bộ hệ thống FCTF, Flask chỉ được dùng ở **một nơi duy nhất**:

```
FCTF-temp-v5/
│
├── FCTF-ManagementPlatform/   ← ĐÂY — toàn bộ Python Flask
│   ├── CTFd/                  ← Core Flask application
│   ├── serve.py               ← Entry point (dev server)
│   ├── wsgi.py                ← Production WSGI entry point
│   └── requirements.txt       ← Python dependencies
│
├── ControlCenterAndChallengeHostingServer/ ← C# (4 projects)
├── ContestantPortal/                       ← React TypeScript
└── ChallengeGateway/                       ← Go
```

### Vị trí trong kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────┐
│                    BAN TỔ CHỨC (Admin)                      │
└────────────────────────┬────────────────────────────────────┘
                         │ Trình duyệt
                         ▼
┌─────────────────────────────────────────────────────────────┐
│        FCTF-ManagementPlatform (Python Flask)               │
│                    Port: 8000                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  CTFd core: challenge mgmt, user mgmt, scoreboard    │   │
│  │  FCTF extensions: deploy challenge, manage instances │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ SQL trực tiếp      │ Redis              │ HTTP → DeploymentCenter
         ▼                    ▼                    ▼
      MariaDB              Redis Cache      DeploymentCenter (C# :5020)
    (cùng DB với                           → Argo Workflows
     ContestantBE)                         → Kubernetes
```

> **Điều quan trọng:** Flask admin portal **KHÔNG** dùng API của ContestantBE — thay vào đó nó truy cập **trực tiếp vào MariaDB** (cùng database) và gọi thẳng **DeploymentCenter** khi cần deploy.

---

## 4. Cấu Trúc Project FCTF-ManagementPlatform

```
FCTF-ManagementPlatform/
├── serve.py                    ← Dev server entry point
├── wsgi.py                     ← Production WSGI (Gunicorn/Gevent)
├── manage.py                   ← CLI tool (migration, import/export)
├── requirements.txt            ← Python dependencies
├── Dockerfile                  ← Container image
├── docker-entrypoint.sh        ← Container startup script
├── migrations/                 ← Alembic database migrations
└── CTFd/                       ← Core Flask application
    ├── __init__.py             ← App factory: create_app()
    ├── auth.py                 ← Authentication (login, register, OAuth)
    ├── views.py                ← Public views (scoreboard, challenge listing)
    ├── config.py               ← App configuration
    ├── errors.py               ← Error handlers (403, 404, 500)
    │
    │   ← CÁC FILE FCTF TỰ THÊM VÀO (custom extensions):
    ├── StartChallenge.py       ← Admin API: start/stop/list challenge instances
    ├── DeployHistory.py        ← Admin API: xem lịch sử deploy image
    ├── ManageInstances.py      ← Admin API: quản lý instance đang chạy
    ├── SendTicket.py           ← (Nếu có) xử lý ticket hỗ trợ
    │
    ├── admin/                  ← Admin panel routes & views
    ├── api/                    ← RESTful API endpoints (/api/v1/...)
    ├── models/                 ← SQLAlchemy database models
    ├── plugins/                ← Plugin system
    ├── themes/                 ← Jinja2 HTML templates + CSS/JS
    │   ├── admin/              ← Admin panel theme
    │   └── core-beta/          ← Default contestant theme
    ├── utils/                  ← Utility functions
    │   ├── connector/          ← HTTP client gọi DeploymentCenter
    │   └── decorators/         ← @admins_only, @during_ctf_time_only
    └── constants/
        └── envvars.py          ← Đọc environment variables
```

---

## 5. Các Khái Niệm Flask Quan Trọng Trong Dự Án

### 5.1. Application Factory Pattern — `create_app()`

Flask dùng **Factory Pattern** để tạo app — cho phép cấu hình linh hoạt và dễ test:

```python
# CTFd/__init__.py
def create_app(config="CTFd.config.Config"):
    # Tạo Flask app instance (custom CTFdFlask extends Flask)
    app = CTFdFlask(__name__)

    with app.app_context():
        # Load cấu hình từ class Config
        app.config.from_object(config)

        # Kết nối Redis cache
        app.config["CACHE_TYPE"] = "redis"
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        app.config["CACHE_REDIS_URL"] = redis_url
        cache = Cache(app)

        # Kết nối database (MariaDB) thông qua SQLAlchemy
        url = create_database()
        app.config["SQLALCHEMY_DATABASE_URI"] = str(url)
        db.init_app(app)

        # Đăng ký Flask-Migrate (Alembic)
        migrations.init_app(app, db)

        # Đăng ký tất cả Blueprints (routes)
        from CTFd.admin import admin
        from CTFd.api import api
        from CTFd.auth import auth
        from CTFd.views import views
        from CTFd.StartChallenge import challenge      # ← FCTF custom
        from CTFd.DeployHistory import challengeHistory # ← FCTF custom
        from CTFd.ManageInstances import ManageInstance # ← FCTF custom

        app.register_blueprint(views)
        app.register_blueprint(auth)
        app.register_blueprint(api)
        app.register_blueprint(admin)
        app.register_blueprint(challenge)       # /api/challenge/*
        app.register_blueprint(challengeHistory) # /api/deploy-history/*
        app.register_blueprint(ManageInstance)  # /api/manage/*

        # Đăng ký error handler
        for code in {403, 404, 500, 502}:
            app.register_error_handler(code, render_error)

        return app
```

**Tại sao dùng Factory Pattern?**
- Dễ tạo nhiều app instance với config khác nhau (test, dev, prod)
- `app_context()` quản lý lifecycle của database connection, cache,...
- Blueprints được đăng ký sau khi app được tạo — tránh circular imports

---

### 5.2. Blueprint — Tổ Chức Routes

**Blueprint** trong Flask là cách chia nhỏ routes theo chức năng, giống Controller trong ASP.NET Core:

```python
# CTFd/StartChallenge.py — FCTF custom blueprint
from flask import Blueprint, jsonify, request, session

# Khai báo Blueprint với tên "challenge"
challenge = Blueprint("challenge", __name__)

# Route: Kiểm tra trạng thái challenge instance
@challenge.route("/api/challenge/status-check/<challenge_id>", methods=["GET"])
def check_challenge_status(challenge_id):
    if not challenge_id or challenge_id == 'undefined':
        return jsonify({"error": "ChallengeId is required"}), 400
    return start_challenge_status_checking(challenge_id, -1)

# Route: Admin stop 1 challenge cụ thể
@challenge.route("/api/challenge/stop-by-admin", methods=["POST"])
def stop_challenge_by_admin():
    data = request.get_json() or request.form.to_dict()
    team_id = data.get("team_id")
    challenge_id = data.get("challenge_id")
    user_id = session["id"]  # Lấy user ID từ Flask session
    
    # Verify user là admin
    user = Users.query.filter_by(id=user_id).first()
    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400
    
    # Kiểm tra Redis cache tồn tại
    cache_key = generate_cache_key(challenge_id, team_id)
    if not redis_client.exists(cache_key):
        return jsonify({"error": "Challenge not started"}), 400
    
    # Gọi DeploymentCenter để stop
    return force_stop(
        user_id=user_id,
        challenge_id=challenge_id,
        team_id=team_id
    )

# Route: Admin stop tất cả
@challenge.route("/api/challenge/stop-all", methods=["DELETE"])
def stop_all_challenges():
    user_id = session["id"]
    user = Users.query.filter_by(id=user_id).first()
    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400
    return force_stop_all(user_id=user_id)
```

**Các Blueprint chính trong FCTF-ManagementPlatform:**

| Blueprint | Prefix URL | Chức năng |
|---|---|---|
| `views` | `/` | Public pages (home, scoreboard) |
| `auth` | `/login`, `/logout` | Đăng nhập/đăng xuất |
| `api` | `/api/v1/` | RESTful API cho admin |
| `admin` | `/admin/` | Admin panel (tạo challenge, user,...) |
| `challenge` | `/api/challenge/` | **FCTF custom** — manage instances |
| `challengeHistory` | `/api/deploy-history/` | **FCTF custom** — deploy history |
| `ManageInstance` | `/api/manage/` | **FCTF custom** — manage instances |

---

### 5.3. SQLAlchemy — ORM Database

Flask dùng **SQLAlchemy** để tương tác database mà không cần viết SQL thủ công:

```python
# Model Challenge (CTFd/models/__init__.py — đã được FCTF mở rộng)
class Challenges(db.Model):
    __tablename__ = "challenges"
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    description = db.Column(db.Text)
    value = db.Column(db.Integer)
    category = db.Column(db.String(80))
    state = db.Column(db.String(200), nullable=False, default="visible")
    
    # ← Các trường FCTF thêm vào (CTFd gốc không có):
    require_deploy = db.Column(db.Boolean, default=False)
    image_link = db.Column(db.Text)        # JSON: Docker image config
    time_limit = db.Column(db.Integer)     # Phút
    cpu_limit = db.Column(db.Integer)      # millicores
    memory_limit = db.Column(db.Integer)   # MB
    use_gvisor = db.Column(db.Boolean)     # Sandboxing?
    harden_container = db.Column(db.Boolean)
    max_deploy_count = db.Column(db.Integer)

# Truy vấn trong StartChallenge.py
# Tìm challenge theo ID
challenge = Challenges.query.filter_by(id=challenge_id).first()

# Tìm tất cả team đang trong database
teams = Teams.query.all()

# Tìm user theo ID với điều kiện
user = Users.query.filter_by(id=user_id).first()

# Cập nhật dữ liệu
challenge.state = "visible"
db.session.commit()  # Lưu vào database
```

**Cùng database với C# (ContestantBE):**

```
MariaDB Database
    ├── challenges table ← Flask đọc/ghi (admin tạo challenge)
    ├── challenges table ← C# đọc/ghi (thí sinh xem challenge, deploy)
    ├── users table      ← Flask quản lý (ban/unban)
    ├── users table      ← C# đọc (xác thực login)
    └── submissions table← C# ghi (kết quả submit flag)
```

> **Không có API layer giữa Flask và DB** — Flask truy cập MariaDB trực tiếp thông qua SQLAlchemy. Đây là sự khác biệt lớn so với ContestantBE (C# giao tiếp qua EF Core).

---

### 5.4. Jinja2 — Template Engine

Flask dùng **Jinja2** để render HTML phía server cho admin portal. Template là file HTML với cú pháp Jinja2:

```html
{# CTFd/themes/admin/templates/challenges/challenge.html (ví dụ) #}

{# Extends (kế thừa) template cha #}
{% extends "admin/base.html" %}

{% block content %}
<div class="container">

  {# Điều kiện #}
  {% if challenge.require_deploy %}
    <span class="badge badge-warning">Requires Deployment</span>
  {% endif %}

  {# Vòng lặp — hiển thị danh sách hint #}
  {% for hint in challenge.hints %}
    <div class="hint-item">
      <p>{{ hint.content }}</p>
      <small>Cost: {{ hint.cost }} pts</small>
    </div>
  {% endfor %}

  {# URL generation #}
  <a href="{{ url_for('admin.admin_challenge', challenge_id=challenge.id) }}">
    Edit Challenge
  </a>
</div>
{% endblock %}
```

**FCTF custom Jinja2 templates:**
- Admin giao diện quản lý challenge instance đang chạy
- Form tạo/sửa challenge với các trường mới (ImageLink, TimeLimit, CpuLimit,...)
- Dashboard xem lịch sử deploy

---

### 5.5. Before Request Hooks — Middleware Flask

Flask dùng `@app.before_request` để thực hiện logic trước MỌI request (tương đương middleware trong ASP.NET Core):

```python
# CTFd/__init__.py — Middleware bảo vệ toàn bộ admin portal

@app.before_request
def _restrict_non_staff_access():
    """
    FCTF-ManagementPlatform CHỈ dành cho ban tổ chức.
    Thí sinh có portal riêng (ContestantPortal + ContestantBE).
    → Block tất cả non-staff access để giảm attack surface.
    """
    from CTFd.utils.user import authed, is_challenge_writer, is_jury
    
    path = request.path or ""
    
    # Luôn cho phép static assets
    if (path.startswith("/themes/") or
        path.startswith("/static/") or
        path == "/healthcheck"):
        return  # None = tiếp tục xử lý request
    
    # Cho phép trang login để admin có thể đăng nhập
    if path.startswith("/login") or path.startswith("/logout"):
        return
    
    # Cho phép trang setup ban đầu
    if path.startswith("/setup"):
        return
    
    # Mọi route khác: yêu cầu phải là admin/staff
    if is_admin() or is_challenge_writer() or is_jury():
        return  # OK, có quyền truy cập
    
    # Non-staff đã đăng nhập → 403 Forbidden
    if authed():
        abort(403)
    
    # Chưa đăng nhập: API request → 403, browser → redirect login
    if path.startswith("/api") or request.content_type == "application/json":
        abort(403)
    
    return redirect(url_for("auth.login", next=request.full_path))
```

---

### 5.6. Flask Session & Redis Cache

Flask dùng **server-side session** được lưu trong Redis:

```python
# Đọc user ID từ session (sau khi đăng nhập)
user_id = session["id"]

# Check quyền admin
from CTFd.utils.user import is_admin
if not is_admin():
    return jsonify({"error": "Permission denied"}), 403

# Sử dụng Flask-Caching với Redis backend
from CTFd.cache import cache

@cache.cached(timeout=30, key_prefix="scoreboard")
def get_scoreboard():
    # Chỉ query DB khi cache miss
    return db.session.query(Teams).order_by(Teams.score.desc()).all()
```

---

### 5.7. Decorators — Bảo Vệ Routes

Flask dùng **decorators** để bảo vệ routes (tương đương `[Authorize]` + `[RequireAdmin]` trong ASP.NET Core):

```python
from CTFd.utils.decorators import admins_only, during_ctf_time_only

# Chỉ admin mới được truy cập endpoint này
@admin.route("/admin/challenges/new", methods=["GET", "POST"])
@admins_only  # ← Decorator kiểm tra quyền
def new_challenge():
    # Code này chỉ chạy nếu user là admin
    ...

# Chỉ cho phép khi CTF đang diễn ra
@challenge.route("/api/challenge/start", methods=["POST"])
@during_ctf_time_only  # ← Kiểm tra CTF đã bắt đầu chưa
def start_challenge():
    ...
```

---

## 6. Luồng Hoạt Động Thực Tế — Minh Họa Bằng Code

### Luồng 1: Admin Xem Tất Cả Challenge Instances Đang Chạy

```python
# CTFd/StartChallenge.py
@challenge.route("/api/challenge/get-all-instance", methods=["POST", "GET"])
def get_all_instance():
    # 1. Kiểm tra quyền admin
    user = get_current_user()
    if not is_admin():
        return jsonify({"error": "Permission denied"}), 403
    
    # 2. Lấy filter params từ query string
    team_filter = request.args.get("team_name", "").strip().lower()
    challenge_search = request.args.get("challenge_name", "").strip().lower()
    status_filter = request.args.get("status", "").strip().lower()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 25, type=int)
    
    # 3. Scan Redis để tìm tất cả key: deploy_challenge_*_*
    pattern = "deploy_challenge_*_*"
    cursor = 0
    matching_keys = []
    while True:
        cursor, keys = redis_client.scan(
            cursor=cursor, match=pattern, count=100
        )
        matching_keys.extend(keys)
        if cursor == 0:  # Scan hoàn tất
            break
    
    # 4. Với mỗi key → parse dữ liệu và join với DB
    all_data = []
    for key in matching_keys:
        value_raw = redis_client.get(key)
        value = json.loads(value_raw)
        
        # Parse challenge_id và team_id từ key
        match = re.match(r"deploy_challenge_(\d+)_(-?\d+)", key)
        challenge_id_key = int(match.group(1))
        team_id = int(match.group(2))
        
        # Join với MariaDB để lấy tên challenge, team, user
        challenge = Challenges.query.filter_by(id=challenge_id_key).first()
        team = Teams.query.filter_by(id=team_id).first()
        user = Users.query.filter_by(id=value.get("user_id")).first()
        
        instance_data = {
            "challenge_id": challenge_id_key,
            "team_id": team_id,
            "challenge_name": challenge.name if challenge else "Unknown",
            "team_name": team.name if team else "Unknown Team",
            "user_name": user.name if user else "Unknown User",
            "challenge_url": value.get("challenge_url"),
            "status": value.get("status", "Unknown"),
            "time_finished": ...,  # convert timestamp
        }
        all_data.append(instance_data)
    
    # 5. Filter, sort, paginate
    if team_filter:
        all_data = [i for i in all_data
                    if team_filter in i.get("team_name", "").lower()]
    if status_filter:
        all_data = [i for i in all_data
                    if status_filter in i.get("status", "").lower()]
    
    total = len(all_data)
    start_idx = (page - 1) * per_page
    paginated = all_data[start_idx:start_idx + per_page]
    
    # 6. Trả response JSON
    return jsonify({
        "success": True,
        "data": paginated,
        "pagination": {
            "page": page,
            "total_items": total,
            "total_pages": (total + per_page - 1) // per_page
        }
    }), 200
```

---

### Luồng 2: Admin Stop Hàng Loạt Challenge Instances

```python
# CTFd/StartChallenge.py
@challenge.route("/api/challenge/stop-bulk", methods=["POST"])
def stop_challenge_bulk_by_admin():
    data = request.get_json(silent=True) or {}
    items = data.get("items")  # List: [{challenge_id, team_id}, ...]
    
    user_id = session.get("id")
    user = Users.query.filter_by(id=user_id).first()
    
    # Verify admin
    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400
    
    results = []
    stopped = 0
    failed = 0
    
    # Lặp qua từng item và stop từng cái một
    for item in items:
        challenge_id = int(item.get("challenge_id"))
        team_id = int(item.get("team_id"))
        
        # Kiểm tra Redis cache
        cache_key = generate_cache_key(challenge_id, team_id)
        if not redis_client.exists(cache_key):
            failed += 1
            results.append({
                "challenge_id": challenge_id,
                "team_id": team_id,
                "success": False,
                "error": "No active cache found"
            })
            continue
        
        # Gọi hàm force_stop → gọi HTTP POST tới DeploymentCenter
        resp = force_stop(
            user_id=user_id,
            challenge_id=challenge_id,
            team_id=team_id
        )
        
        ok = bool(resp.get("success") or resp.get("isSuccess"))
        if ok:
            stopped += 1
        else:
            failed += 1
        
        results.append({
            "challenge_id": challenge_id,
            "team_id": team_id,
            "success": ok,
        })
    
    return jsonify({
        "success": True,
        "stopped": stopped,
        "failed": failed,
        "results": results
    }), 200
```

---

### Luồng 3: Flask App Khởi Động (Production)

```python
# wsgi.py — Production entry point
import os
# Gevent monkey-patching để xử lý nhiều request đồng thời
from gevent import monkey
monkey.patch_all()

from CTFd import create_app

# Tạo app instance từ factory
app = create_app()

# Chạy với Gunicorn (WSGI server)
# Lệnh trong docker-entrypoint.sh:
# gunicorn --bind 0.0.0.0:8000 --worker-class gevent
#          --workers 4 wsgi:app
```

**serve.py — Development entry point:**

```python
# serve.py
import argparse
args = parser.parse_args()

# Cho phép gevent concurrency (giả lập async bằng green threads)
if args.disable_gevent:
    from gevent import monkey
    monkey.patch_all()

from CTFd import create_app
app = create_app()

if __name__ == "__main__":
    # Chạy Flask dev server
    app.run(host="0.0.0.0", port=8000, debug=True)
```

---

## 7. Tích Hợp Với Hệ Thống C# Như Thế Nào?

Flask không đứng độc lập — nó tích hợp với toàn bộ hệ thống FCTF thông qua:

### 7.1. Shared Database (MariaDB)

```
Flask (SQLAlchemy)          C# (Entity Framework Core)
         │                              │
         └──────────── MariaDB ─────────┘
                     (cùng DB)

- Flask WRITE: tạo/sửa challenge, user, team
- C# READ:     thí sinh xem challenge, submit flag
- C# WRITE:    ghi submission, solve, actionlog
```

### 7.2. Shared Redis Cache

```
Flask                        C# (ContestantBE + DeploymentListener)
  redis_client.scan(...)      _redisHelper.GetAsync(...)
  redis_client.get(key)       _redisHelper.SetAsync(key, value)
         │                              │
         └──────────── Redis ───────────┘
                     (cùng instance)

Key pattern dùng chung:
  deploy_challenge_{id}_{teamId}  ← Flask READ (xem trạng thái)
                                  ← C# READ/WRITE (cập nhật, xóa)
```

### 7.3. HTTP API tới DeploymentCenter (C#)

Flask gọi HTTP API tới DeploymentCenter để start/stop challenge:

```python
# CTFd/utils/connector/multiservice_connector.py

API_URL_CONTROLSERVER = os.getenv("API_URL_CONTROLSERVER")  # http://deploy-center:5020

def force_stop(user_id, challenge_id, team_id):
    """Flask gọi DeploymentCenter API để stop một challenge"""
    
    # Tạo SecretKey HMAC (giống ContestantBE làm)
    secret_key = create_secret_key(user_id, challenge_id, team_id)
    
    payload = {
        "userId": str(user_id),
        "challengeId": challenge_id,
        "teamId": team_id,
        "secretKey": secret_key,
        "isAdmin": True,  # ← Admin có thể stop ngay lập tức
    }
    
    # HTTP POST tới DeploymentCenter
    response = requests.post(
        f"{API_URL_CONTROLSERVER}/api/challenge/stop",
        json=payload,
        timeout=30
    )
    
    return response.json()

def challenge_start(user_id, challenge_id, team_id):
    """Flask gọi DeploymentCenter để start challenge (preview mode cho admin)"""
    secret_key = create_secret_key(user_id, challenge_id, team_id)
    
    payload = {
        "userId": str(user_id),
        "challengeId": challenge_id,
        "teamId": -1,  # -1 = preview mode (không phải team thật)
        "secretKey": secret_key,
    }
    
    response = requests.post(
        f"{API_URL_CONTROLSERVER}/api/challenge/start",
        json=payload,
        timeout=30
    )
    return response.json()
```

### 7.4. Bảng Tích Hợp Tổng Quan

| Giao tiếp | Flask → ... | Mục đích |
|---|---|---|
| **MariaDB** (trực tiếp qua SQLAlchemy) | Challenges, Users, Teams | Tạo/sửa/xóa challenge, quản lý user |
| **Redis** (trực tiếp qua redis-py) | deploy_challenge_*_* keys | Đọc trạng thái instance đang chạy |
| **DeploymentCenter** (HTTP POST) | `:5020/api/challenge/start` | Admin preview challenge |
| **DeploymentCenter** (HTTP POST) | `:5020/api/challenge/stop` | Admin stop challenge |
| **DeploymentCenter** (HTTP POST) | `:5020/api/challenge/stop-all` | Admin stop tất cả |
| **Argo Workflows** (HTTP POST, qua DeployCenter) | Submit workflow | Build & push Docker image cho challenge |

---

## 8. Python Dependencies Quan Trọng

```
# requirements.txt — Các thư viện Python chính

Flask==2.2.5                # Core web framework
Flask-SQLAlchemy==2.5.1     # ORM integration với Flask
SQLAlchemy==1.4.48          # ORM engine (query builder, mapping)
Flask-Migrate==2.5.3        # Database migrations (Alembic)
Flask-Caching==2.0.2        # Cache abstraction (Redis backend)
Flask-CORS==4.0.0           # Cross-Origin Resource Sharing
Flask-RESTx==1.1.0          # REST API + auto Swagger docs
Flask-Babel==2.0.0          # Internationalization (i18n)

PyMySQL[rsa]==1.0.2         # MariaDB/MySQL driver
redis==4.5.5                # Redis client (lưu session, cache)

itsdangerous==2.1.2         # Ký và verify token/URL an toàn
Jinja2==3.1.2               # Template engine HTML
Werkzeug==2.2.3             # WSGI utilities, request/response

gevent==23.9.1              # Green threads (concurrency)
gunicorn==20.1.0            # Production WSGI server

requests==2.28.1            # HTTP client (gọi DeploymentCenter)
bcrypt==4.0.1               # Password hashing
passlib==1.7.4              # Password utilities

marshmallow==2.20.2         # Data serialization/validation
marshmallow-sqlalchemy==0.17.0 # SQLAlchemy + Marshmallow integration

boto3==1.34.39              # AWS S3 (file storage)
Pillow==10.1.0              # Image processing
pandas==3.0.0               # Data analysis (import/export)
xlsxwriter==3.2.0           # Export Excel
```

**Điểm đặc biệt — `itsdangerous`:**

Flask dùng `itsdangerous` để tạo **signed URL** và **tamper-proof tokens**. FCTF C# phải implement lại logic này tương thích:

```python
# Python (Flask/itsdangerous) — sinh signed URL cho file download
from itsdangerous import URLSafeTimedSerializer

s = URLSafeTimedSerializer(SECRET_KEY)
token = s.dumps({"file_id": 42})  # "abc.def.ghi" (signed)
# → ContestantBE C# dùng ItsDangerousCompatHelper.cs để verify token này
```

```csharp
// C# (ResourceShared/Utils/ItsDangerousCompatHelper.cs)
// Verify token từ Python itsdangerous
public static bool VerifyToken(string token, string secretKey, out string payload)
{
    // Implement lại thuật toán signing của Python itsdangerous
    // để C# có thể verify token do Flask tạo ra
}
```

---

## 9. Tóm Tắt Vai Trò Flask Trong Hệ Thống

```
┌─────────────────────────────────────────────────────────────────────┐
│               FCTF-ManagementPlatform (Python Flask)                 │
│                         Port 8000                                     │
│                                                                      │
│  NHẬN TỪNG LOẠI REQUEST:                                             │
│                                                                      │
│  1. Admin đăng nhập                                                  │
│     /login → auth.py → kiểm tra DB → cấp session                   │
│                                                                      │
│  2. Admin tạo/sửa challenge                                          │
│     /admin/challenges → admin/ blueprint                             │
│     → SQLAlchemy ghi vào MariaDB                                     │
│     (thêm image_link, time_limit, cpu_limit, use_gvisor,...)        │
│                                                                      │
│  3. Admin xem tất cả instance đang chạy                             │
│     /api/challenge/get-all-instance                                  │
│     → Scan Redis keys "deploy_challenge_*_*"                        │
│     → Join tên từ MariaDB                                           │
│     → Trả JSON (phân trang, filter, sort)                           │
│                                                                      │
│  4. Admin stop challenge                                             │
│     /api/challenge/stop-by-admin                                     │
│     → Verify admin quyền                                            │
│     → HTTP POST → DeploymentCenter :5020/api/challenge/stop         │
│     → DeploymentCenter gọi K8s xóa namespace                        │
│                                                                      │
│  5. Admin xem lịch sử deploy                                        │
│     /api/deploy-history/ → DeployHistory.py                         │
│     → Query MariaDB bảng deploy_histories                            │
│                                                                      │
│  6. Admin preview challenge                                          │
│     → HTTP POST → DeploymentCenter /start (team_id=-1)              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### So sánh Flask vs C# trong FCTF

| Tiêu chí | Flask (Python) | ASP.NET Core (C#) |
|---|---|---|
| **Người dùng** | Ban tổ chức (admin) | Thí sinh |
| **Port** | 8000 | 5010 (ContestantBE) |
| **Mục đích chính** | Quản lý nội dung, xem trạng thái | Xử lý nghiệp vụ thi đấu |
| **Database access** | Trực tiếp qua SQLAlchemy | Qua Entity Framework Core |
| **Redis access** | Đọc trạng thái instance | Đọc/ghi/lock toàn bộ |
| **Render UI** | Server-side (Jinja2 HTML) | Không render — thuần REST API |
| **Authentication** | Flask session (cookie) | JWT Bearer token |
| **Scale** | 1 instance (admin tool) | Nhiều instance (high traffic) |
| **Concurrency model** | Gevent (green threads) | Async/Await (native) |

### Một câu để nhớ về vai trò của Flask:

> **"Flask là phòng điều hành — nơi ban tổ chức ngồi điều phối toàn bộ cuộc thi: tạo challenge, quản lý người chơi, và theo dõi mọi container đang chạy trên Kubernetes."**

---

*Tài liệu được soạn dựa trên phân tích source code thực tế của FCTF-temp-v5 — 10/04/2026*
