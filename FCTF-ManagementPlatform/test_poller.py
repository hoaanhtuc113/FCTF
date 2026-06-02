"""
Test poller nhanh — không cần KYPO thật, không cần mock server, không cần restart.
Chạy: python test_poller.py

Script này:
  1. Tạo Flask app context
  2. Patch _get_admin_token + _fetch_progress bằng dữ liệu giả
  3. Gọi thẳng _run_poll_cycle()
  4. In kết quả từ DB
"""

import os

# ── Trỏ đúng DB và Redis đang chạy ────────────────────────────────────────────
os.environ.setdefault("DATABASE_URL", "mysql+pymysql://fctf_user:fctf_password@127.0.0.1:3306/ctfd")
os.environ.setdefault("REDIS_URL",    "redis://:redis_password@127.0.0.1:6379")
os.environ.setdefault("REDIS_HOST",   "127.0.0.1")
os.environ.setdefault("REDIS_PORT",   "6379")
os.environ.setdefault("REDIS_PASS",   "redis_password")
os.environ.setdefault("REDIS_TLS",    "false")
os.environ.setdefault("KYPO_BASE_URL","http://fake")   # không quan trọng vì sẽ patch

# ── Import app ─────────────────────────────────────────────────────────────────
from CTFd import create_app
app = create_app()

# ── Đọc dữ liệu thực từ DB để biết cần điền gì ────────────────────────────────
with app.app_context():
    from CTFd.models import KypoChallengeConfig, KypoTeamAccount

    configs  = KypoChallengeConfig.query.all()
    accounts = KypoTeamAccount.query.all()

    print("\n=== KypoChallengeConfig trong DB ===")
    for c in configs:
        print(f"  challenge_id={c.challenge_id}  instance_id={c.kypo_instance_id}  type={c.kypo_instance_type}")

    print("\n=== KypoTeamAccount trong DB ===")
    for a in accounts:
        print(f"  team_id={a.team_id}  kypo_username={a.kypo_username}")

    if not configs:
        print("\n[!] Không có KypoChallengeConfig → Tạo challenge sandbox trước.")
        exit(1)
    if not accounts:
        print("\n[!] Không có KypoTeamAccount → Tạo team trước.")
        exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# CHỈNH SỬA: điền đúng kypo_username và kypo_instance_id từ output trên
# ─────────────────────────────────────────────────────────────────────────────

FAKE_PROGRESS = {
    # instance_id=33 → challenge_id=1
    33: [
        {
            "name": "fctf_team2_2",        # team_id=2
            "training_run_id": 101,
            "levels": [
                {"id": 1, "state": "FINISHED", "score": 60},
                {"id": 2, "state": "FINISHED", "score": 40},
            ],
        },
    ],
    # instance_id=34 → challenge_id=2,3,4
    34: [
        {
            "name": "fctf_team2_2",        # team_id=2
            "training_run_id": 102,
            "levels": [
                {"id": 1, "state": "FINISHED", "score": 50},
                {"id": 2, "state": "RUNNING",  "score": 20},
            ],
        },
    ],
}

# ─────────────────────────────────────────────────────────────────────────────

import CTFd.utils.kypo_poller as poller

# Patch: bỏ qua auth thật
poller._get_admin_token = lambda: "fake-token"

# Patch: trả dữ liệu giả thay vì gọi HTTP
def _fake_fetch_progress(token, base, instance_id):
    data = FAKE_PROGRESS.get(instance_id, [])
    print(f"[Fake KYPO] instance_id={instance_id} → {len(data)} participant(s)")
    return {"progress": data}

poller._fetch_progress = _fake_fetch_progress

# ── Chạy 1 cycle ──────────────────────────────────────────────────────────────
print("\n=== Chạy poll cycle ===")
poller._run_poll_cycle(app)

# ── Kiểm tra kết quả trong DB ─────────────────────────────────────────────────
print("\n=== Kết quả trong bảng solves (value IS NOT NULL) ===")
with app.app_context():
    from CTFd.models import Solves, Teams, Challenges
    solves = Solves.query.filter(Solves.value != None).all()

    if not solves:
        print("  Chưa có solve nào được ghi → team chưa FINISHED hoặc username không khớp")
    else:
        for s in solves:
            team = Teams.query.get(s.team_id)
            ch   = Challenges.query.get(s.challenge_id)
            print(f"  ✓ team={team.name if team else s.team_id}  "
                  f"challenge={ch.name if ch else s.challenge_id}  "
                  f"score={s.value}")

# ── Kiểm tra Redis cache ───────────────────────────────────────────────────────
print("\n=== Redis cache (kypo_progress_*) ===")
with app.app_context():
    from CTFd.utils.kypo_poller import get_all_cached_progress
    from CTFd.models import KypoChallengeConfig
    for cfg in KypoChallengeConfig.query.all():
        entries = get_all_cached_progress(cfg.challenge_id)
        for e in entries:
            print(f"  challenge={e['challenge_id']}  team={e['team_id']}  "
                  f"status={e['status']}  score={e['score']}")
