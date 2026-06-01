"""
KYPO Score Poller
-----------------
Daemon thread khởi động cùng Flask app, chạy vòng lặp mỗi POLL_INTERVAL giây.

Flow mỗi cycle:
  1. Load tất cả KypoChallengeConfig
  2. Với mỗi config:
       - Đếm team chưa solve challenge → nếu 0 thì skip
       - Gọi KYPO Progress API
       - Map kypo_username → team_id
       - Nếu participant FINISHED + chưa có Solve → INSERT Solve(value=total_score)
  3. Cache kết quả vào Redis để API đọc nhanh

Env:
  KYPO_POLL_INTERVAL  – giây giữa 2 lần poll (mặc định 10)
"""

import datetime
import json
import logging
import os
import threading

import requests
import urllib3

from CTFd.constants.envvars import (
    KYPO_BASE_URL,
    KYPO_CLIENT_ID,
    KYPO_PASSWORD,
    KYPO_USERNAME,
    get_redis_client_kwargs,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import redis as _redis_lib

log = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("KYPO_POLL_INTERVAL", 10))
_REDIS_KEY_PREFIX = "kypo_progress"
_REDIS_TTL = 7200  # 2 giờ

_stop_event = threading.Event()
_thread: threading.Thread | None = None


# ── Keycloak auth ──────────────────────────────────────────────────────────────

def _get_admin_token() -> str:
    resp = requests.post(
        f"{KYPO_BASE_URL}/keycloak/realms/CRCZP/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": KYPO_CLIENT_ID,
            "username": KYPO_USERNAME,
            "password": KYPO_PASSWORD,
        },
        timeout=15,
        verify=False,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


# ── KYPO API ───────────────────────────────────────────────────────────────────

def _service_base(instance_type: str) -> str:
    if instance_type == "adaptive":
        return f"{KYPO_BASE_URL}/adaptive-training/api/v1"
    return f"{KYPO_BASE_URL}/training/api/v1"


def _fetch_progress(token: str, base: str, instance_id: int) -> dict:
    url = f"{base}/visualizations/training-instances/{instance_id}/progress"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
        verify=False,
    )
    resp.raise_for_status()
    return resp.json()


# ── Score / status ─────────────────────────────────────────────────────────────

def _calc_status_and_score(levels: list) -> tuple[str, int]:
    """
    Trả về (status, total_score).
    status: 'FINISHED' | 'IN_PROGRESS' | 'NOT_STARTED'
    """
    if not levels:
        return "NOT_STARTED", 0

    total = sum(int(lv.get("score") or 0) for lv in levels)
    states = {(lv.get("state") or "").upper() for lv in levels}

    if all(s == "FINISHED" for s in states):
        return "FINISHED", total
    if any(s in ("RUNNING", "FINISHED") for s in states):
        return "IN_PROGRESS", total
    return "NOT_STARTED", total


# ── Redis helpers ──────────────────────────────────────────────────────────────

def _redis_key(challenge_id: int, team_id: int) -> str:
    return f"{_REDIS_KEY_PREFIX}_{challenge_id}_{team_id}"


def _cache(rc, challenge_id: int, team_id: int, payload: dict):
    rc.setex(_redis_key(challenge_id, team_id), _REDIS_TTL, json.dumps(payload))


def get_cached_progress(challenge_id: int, team_id: int) -> dict | None:
    """Đọc cache cho 1 cặp (challenge, team). Trả None nếu chưa có."""
    try:
        rc = _redis_lib.StrictRedis(**get_redis_client_kwargs())
        raw = rc.get(_redis_key(challenge_id, team_id))
        return json.loads(raw) if raw else None
    except Exception as exc:
        log.warning("[KYPO Poller] Redis read error: %s", exc)
        return None


def get_all_cached_progress(challenge_id: int) -> list[dict]:
    """Scan Redis để lấy toàn bộ entries của 1 challenge (tất cả teams)."""
    try:
        rc = _redis_lib.StrictRedis(**get_redis_client_kwargs())
        pattern = f"{_REDIS_KEY_PREFIX}_{challenge_id}_*"
        results = []
        cursor = 0
        while True:
            cursor, keys = rc.scan(cursor=cursor, match=pattern, count=100)
            for k in keys:
                raw = rc.get(k)
                if raw:
                    try:
                        results.append(json.loads(raw))
                    except Exception:
                        pass
            if cursor == 0:
                break
        return results
    except Exception as exc:
        log.warning("[KYPO Poller] Redis scan error: %s", exc)
        return []


# ── DB: đếm team chưa solve ────────────────────────────────────────────────────

def _count_unsolved_teams(challenge_id: int, all_team_ids: list[int]) -> int:
    """
    Trả về số team trong all_team_ids chưa có Solves row cho challenge_id.
    """
    from CTFd.models import Solves

    if not all_team_ids:
        return 0

    solved_team_ids = {
        row.team_id
        for row in Solves.query.filter(
            Solves.challenge_id == challenge_id,
            Solves.team_id.in_(all_team_ids),
        ).all()
    }
    return len(set(all_team_ids) - solved_team_ids)


# ── DB: ghi Solve ──────────────────────────────────────────────────────────────

def _insert_solve(challenge_id: int, team_id: int, score: int):
    """
    INSERT submissions + solves cho team đã FINISHED.
    Chỉ ghi nếu chưa tồn tại (unique constraint bảo vệ duplicate).
    """
    from CTFd.models import Solves, Teams, db

    existing = Solves.query.filter_by(
        challenge_id=challenge_id, team_id=team_id
    ).first()

    if existing:
        # Cập nhật score nếu thay đổi
        if existing.value != score:
            existing.value = score
            db.session.commit()
            log.info(
                "[KYPO Poller] Updated score challenge=%s team=%s → %s",
                challenge_id, team_id, score,
            )
        return

    team = Teams.query.get(team_id)
    user_id = getattr(team, "captain_id", None) if team else None

    solve = Solves(
        challenge_id=challenge_id,
        team_id=team_id,
        user_id=user_id,
        ip="",
        provided="(kypo)",
        value=score,
    )
    db.session.add(solve)
    db.session.commit()
    log.info(
        "[KYPO Poller] Inserted solve challenge=%s team=%s score=%s",
        challenge_id, team_id, score,
    )


# ── Core sync per instance ─────────────────────────────────────────────────────

def _sync_instance(cfg, token: str, rc, username_to_team: dict, now_iso: str):
    """
    Xử lý 1 KypoChallengeConfig:
      - Lấy danh sách teams liên quan (có KypoTeamAccount)
      - Đếm team chưa solve → skip nếu 0
      - Gọi KYPO Progress API → parse → cache → ghi Solve nếu FINISHED
    """
    from CTFd.models import db

    all_team_ids = list(username_to_team.values())

    # ── Skip nếu tất cả teams đã solve ────────────────────────────────────────
    unsolved = _count_unsolved_teams(cfg.challenge_id, all_team_ids)
    if unsolved == 0:
        log.debug(
            "[KYPO Poller] challenge=%s — tất cả teams đã solve, skip.",
            cfg.challenge_id,
        )
        return

    # ── Gọi KYPO ──────────────────────────────────────────────────────────────
    base = _service_base(cfg.kypo_instance_type or "linear")
    try:
        data = _fetch_progress(token, base, cfg.kypo_instance_id)
    except Exception as exc:
        log.warning(
            "[KYPO Poller] Fetch failed instance=%s: %s", cfg.kypo_instance_id, exc
        )
        return

    # ── Xử lý từng participant ─────────────────────────────────────────────────
    for participant in data.get("progress", []):
        kypo_username = participant.get("name", "")
        training_run_id = participant.get("training_run_id")
        levels = participant.get("levels", [])

        team_id = username_to_team.get(kypo_username)
        if team_id is None:
            continue  # username không map được → bỏ qua

        status, score = _calc_status_and_score(levels)

        # Cache vào Redis (luôn cập nhật kể cả IN_PROGRESS)
        _cache(rc, cfg.challenge_id, team_id, {
            "challenge_id": cfg.challenge_id,
            "team_id": team_id,
            "training_run_id": training_run_id,
            "kypo_username": kypo_username,
            "kypo_instance_id": cfg.kypo_instance_id,
            "status": status,
            "score": score,
            "levels": levels,
            "last_synced": now_iso,
        })

        # Ghi Solve chỉ khi FINISHED
        if status == "FINISHED":
            try:
                _insert_solve(cfg.challenge_id, team_id, score)
            except Exception as exc:
                db.session.rollback()
                log.error(
                    "[KYPO Poller] DB error challenge=%s team=%s: %s",
                    cfg.challenge_id, team_id, exc,
                )


# ── Poll cycle ─────────────────────────────────────────────────────────────────

def _run_poll_cycle(app):
    """1 vòng poll đầy đủ, chạy trong app context."""
    from CTFd.models import KypoChallengeConfig, KypoTeamAccount

    with app.app_context():
        configs = KypoChallengeConfig.query.all()
        if not configs:
            return

        # Build username → team_id index
        accounts = KypoTeamAccount.query.all()
        username_to_team: dict[str, int] = {
            acc.kypo_username: acc.team_id for acc in accounts
        }
        if not username_to_team:
            return

        # Lấy token một lần dùng cho tất cả instance
        try:
            token = _get_admin_token()
        except Exception as exc:
            log.error("[KYPO Poller] Keycloak auth failed: %s", exc)
            return

        try:
            rc = _redis_lib.StrictRedis(**get_redis_client_kwargs())
        except Exception as exc:
            log.error("[KYPO Poller] Redis connect failed: %s", exc)
            return

        now_iso = datetime.datetime.utcnow().isoformat()

        for cfg in configs:
            try:
                _sync_instance(cfg, token, rc, username_to_team, now_iso)
            except Exception as exc:
                log.error(
                    "[KYPO Poller] Unhandled error challenge=%s: %s",
                    cfg.challenge_id, exc, exc_info=True,
                )

        log.info("[KYPO Poller] Cycle done. %d config(s).", len(configs))


# ── Public: manual trigger (dùng cho API endpoint) ────────────────────────────

def run_poll_cycle_now(app):
    """Trigger 1 cycle ngay lập tức (dùng từ API endpoint /kypo/sync)."""
    _run_poll_cycle(app)


# ── Thread loop ────────────────────────────────────────────────────────────────

def _loop(app):
    log.info("[KYPO Poller] Started. Interval=%ds", POLL_INTERVAL)
    while not _stop_event.is_set():
        try:
            _run_poll_cycle(app)
        except Exception as exc:
            log.error("[KYPO Poller] Loop error: %s", exc, exc_info=True)
        _stop_event.wait(POLL_INTERVAL)
    log.info("[KYPO Poller] Stopped.")


def start_poller(app):
    """Khởi động daemon thread. Gọi 1 lần duy nhất khi app start."""
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(
        target=_loop,
        args=(app,),
        name="kypo-poller",
        daemon=True,
    )
    _thread.start()


def stop_poller():
    _stop_event.set()
