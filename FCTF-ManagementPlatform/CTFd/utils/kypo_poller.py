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

from CTFd.constants.envvars import get_redis_client_kwargs

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
    from CTFd.utils.kypo_config import get_kypo_config
    base_url   = get_kypo_config("kypo_base_url")
    client_id  = get_kypo_config("kypo_client_id")
    username   = get_kypo_config("kypo_username")
    password   = get_kypo_config("kypo_password")
    resp = requests.post(
        f"{base_url}/keycloak/realms/CRCZP/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id":  client_id,
            "username":   username,
            "password":   password,
        },
        timeout=15,
        verify=False,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


# ── KYPO API ───────────────────────────────────────────────────────────────────

def _service_base(instance_type: str) -> str:
    from CTFd.utils.kypo_config import get_kypo_config
    base_url = get_kypo_config("kypo_base_url")
    if instance_type == "adaptive":
        return f"{base_url}/adaptive-training/api/v1"
    return f"{base_url}/training/api/v1"


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

def _get_level_score(level: dict) -> int:
    """
    Lấy score của 1 level từ events[].actual_score_in_level của LevelCompleted.

    Ưu tiên LevelCompleted event (kể cả khi state=RUNNING do team resume sau
    khi đã hoàn thành — TrainingRunResumed đặt score=0 và state=RUNNING,
    che mất điểm thực sự).
    """
    # Thử field score trực tiếp (format mock/cũ)
    direct = level.get("score")
    if direct is not None:
        return int(direct or 0)

    events = level.get("events") or []

    # Tìm LevelCompleted event cuối cùng TRƯỚC KHI check state.
    # Trường hợp resume: state=RUNNING nhưng đã có LevelCompleted với điểm thật.
    completed = [e for e in events if "LevelCompleted" in (e.get("type") or "")]
    if completed:
        return int(completed[-1].get("actual_score_in_level") or 0)

    # Không có LevelCompleted → level thực sự chưa hoàn thành
    return 0


def _level_is_completed(level: dict) -> bool:
    """
    Trả về True nếu level đã có LevelCompleted event hoặc state=FINISHED.
    Handles trường hợp team resume sau khi đã complete → state=RUNNING nhưng
    thực tế đã xong.
    """
    if (level.get("state") or "").upper() == "FINISHED":
        return True
    events = level.get("events") or []
    return any("LevelCompleted" in (e.get("type") or "") for e in events)


def _calc_status_and_score(levels: list) -> tuple[str, int]:
    """
    Trả về (status, total_score).
    status: 'FINISHED' | 'IN_PROGRESS' | 'NOT_STARTED'
    """
    if not levels:
        return "NOT_STARTED", 0

    total = sum(_get_level_score(lv) for lv in levels)
    states = {(lv.get("state") or "").upper() for lv in levels}

    # Coi level là FINISHED nếu có LevelCompleted event (kể cả khi resumed)
    if all(_level_is_completed(lv) for lv in levels):
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

def _clear_scoreboard_cache():
    """Xóa cache scoreboard sau khi ghi Solve mới."""
    try:
        from CTFd.cache import cache
        from CTFd.utils.scores import get_standings, get_user_standings, get_team_standings
        cache.delete_memoized(get_standings)
        cache.delete_memoized(get_user_standings)
        cache.delete_memoized(get_team_standings)
        # Xóa cache endpoint scoreboard list
        cache.clear()
        log.info("[KYPO Poller] Scoreboard cache cleared.")
    except Exception as exc:
        log.warning("[KYPO Poller] Failed to clear cache: %s", exc)


def _insert_solve(challenge_id: int, team_id: int, score: int):
    """
    UPSERT solve dùng raw SQL với ON DUPLICATE KEY UPDATE để tránh race condition
    khi nhiều poll cycle chạy đồng thời.
    """
    from CTFd.models import db, Teams

    try:
        team = Teams.query.get(team_id)
        user_id = None
        if team:
            user_id = getattr(team, 'captain_id', None)
            if not user_id and hasattr(team, 'members') and team.members:
                user_id = team.members[0].id

        # Kiểm tra solve đã tồn tại chưa
        result = db.session.execute(
            db.text("SELECT id, value FROM solves WHERE challenge_id=:cid AND team_id=:tid"),
            {"cid": challenge_id, "tid": team_id}
        ).fetchone()

        if result:
            existing_id, existing_value = result[0], result[1]
            if existing_value != score:
                db.session.execute(
                    db.text("UPDATE solves SET value=:score WHERE id=:sid"),
                    {"score": score, "sid": existing_id}
                )
                db.session.commit()
                log.info("[KYPO Poller] Updated score challenge=%s team=%s → %s",
                         challenge_id, team_id, score)
                _clear_scoreboard_cache()
            return

        # INSERT submissions + solves, bắt duplicate key để tránh race condition
        db.session.execute(
            db.text("""INSERT INTO submissions
                       (challenge_id, user_id, team_id, ip, provided, type, date)
                       VALUES (:cid, :uid, :tid, '', '(kypo)', 'correct', NOW())"""),
            {"cid": challenge_id, "uid": user_id, "tid": team_id}
        )
        sub_id = db.session.execute(db.text("SELECT LAST_INSERT_ID()")).scalar()

        db.session.execute(
            db.text("""INSERT INTO solves (id, challenge_id, user_id, team_id, value)
                       VALUES (:id, :cid, :uid, :tid, :val)
                       ON DUPLICATE KEY UPDATE value=:val"""),
            {"id": sub_id, "cid": challenge_id, "uid": user_id, "tid": team_id, "val": score}
        )
        db.session.commit()
        log.info("[KYPO Poller] Inserted solve challenge=%s team=%s score=%s",
                 challenge_id, team_id, score)
        _clear_scoreboard_cache()

        # Ghi ActionLog SUBMIT_CHALLENGE (type=6) cho từng thành viên team
        try:
            from CTFd.models import ActionLogs, Teams, Challenges
            from CTFd.utils.action_logs import get_topic_name
            import datetime as _dt

            team = Teams.query.get(team_id)
            challenge = Challenges.query.get(challenge_id)
            topic_name = get_topic_name(challenge_id)
            detail = f"Submitted KYPO sandbox challenge: {challenge.name if challenge else challenge_id} (score={score})"

            if team and hasattr(team, 'members'):
                members = team.members
            elif team:
                from CTFd.models import UserTeamMember
                members = db.session.query(UserTeamMember).filter_by(team_id=team_id).all()
            else:
                members = []

            user_ids = [m.user_id for m in members] if members else []
            if not user_ids and team and getattr(team, 'captain_id', None):
                user_ids = [team.captain_id]

            for uid in user_ids:
                action_log = ActionLogs(
                    user_id=uid,
                    date=_dt.datetime.utcnow(),
                    type=6,  # SUBMIT_CHALLENGE
                    detail=detail,
                    topic_name=topic_name,
                )
                db.session.add(action_log)
            db.session.commit()
            log.info("[KYPO Poller] ActionLog written for challenge=%s team=%s", challenge_id, team_id)
        except Exception as exc:
            db.session.rollback()
            log.warning("[KYPO Poller] Failed to write ActionLog: %s", exc)

    except Exception as exc:
        db.session.rollback()
        # 1020 "Record has changed" — xảy ra khi 2 cycle chạy đồng thời,
        # retry 1 lần với fresh SELECT là đủ.
        if "1020" in str(exc) or "Record has changed" in str(exc):
            try:
                result = db.session.execute(
                    db.text("SELECT id, value FROM solves WHERE challenge_id=:cid AND team_id=:tid"),
                    {"cid": challenge_id, "tid": team_id}
                ).fetchone()
                if result and result[1] != score:
                    db.session.execute(
                        db.text("UPDATE solves SET value=:score WHERE id=:sid"),
                        {"score": score, "sid": result[0]}
                    )
                    db.session.commit()
                    log.info("[KYPO Poller] Retry OK challenge=%s team=%s score=%s",
                             challenge_id, team_id, score)
                    _clear_scoreboard_cache()
            except Exception:
                db.session.rollback()
        else:
            log.error("[KYPO Poller] DB error challenge=%s team=%s: %s",
                      challenge_id, team_id, exc)


# ── Core sync per instance ─────────────────────────────────────────────────────

def _sync_instance(cfg, token: str, rc, username_to_team: dict, safe_first_name_to_team: dict, now_iso: str):
    """
    Xử lý 1 KypoChallengeConfig:
      - Lấy danh sách teams liên quan (có KypoTeamAccount)
      - Đếm team chưa solve → skip nếu 0
      - Gọi KYPO Progress API → parse → cache → ghi Solve nếu FINISHED
    """
    from CTFd.models import db

    log.debug(
        "[KYPO Poller] challenge=%s instance=%s — polling...",
        cfg.challenge_id, cfg.kypo_instance_id,
    )

    # ── Gọi KYPO ──────────────────────────────────────────────────────────────
    base = _service_base(cfg.kypo_instance_type or "linear")
    try:
        data = _fetch_progress(token, base, cfg.kypo_instance_id)
    except Exception as exc:
        log.warning(
            "[KYPO Poller] Fetch failed instance=%s: %s", cfg.kypo_instance_id, exc
        )
        return

    participants = data.get("progress", [])
    log.info(
        "[KYPO Poller] instance=%s trả về %d participant(s).",
        cfg.kypo_instance_id, len(participants),
    )

    # ── Xử lý từng participant ─────────────────────────────────────────────────
    for participant in participants:
        kypo_username = participant.get("name", "")
        training_run_id = participant.get("training_run_id")
        levels = participant.get("levels", [])

        # Format 1 & 2: map trực tiếp (exact + lowercase)
        team_id = username_to_team.get(kypo_username)
        if team_id is None:
            team_id = username_to_team.get(kypo_username.lower())

        # Format 3 fallback: KYPO trả về "{firstName} FCTF Team"
        # nhưng tên team trong DB đã thay đổi → dùng safe_name từ kypo_username
        if team_id is None and kypo_username.lower().endswith(" fctf team"):
            first_name = kypo_username[: -len(" FCTF Team")].strip()
            safe_first = "".join(
                c if c.isalnum() else "_" for c in first_name.lower()
            )[:20]
            team_id = safe_first_name_to_team.get(safe_first)
            if team_id is not None:
                log.info(
                    "[KYPO Poller] instance=%s — '%s' mapped via safe_name fallback → team_id=%s.",
                    cfg.kypo_instance_id, kypo_username, team_id,
                )

        if team_id is None:
            log.warning(
                "[KYPO Poller] instance=%s — không map được participant '%s'. "
                "Kiểm tra KypoTeamAccount hoặc tên Keycloak (firstName) có khớp với tên team FCTF không.",
                cfg.kypo_instance_id, kypo_username,
            )
            continue

        status, score = _calc_status_and_score(levels)
        log.info(
            "[KYPO Poller] instance=%s participant='%s' team_id=%s → status=%s score=%s",
            cfg.kypo_instance_id, kypo_username, team_id, status, score,
        )

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

        # Ghi Solve khi có điểm > 0 (kể cả IN_PROGRESS để lấy điểm partial)
        if score > 0:
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
        # Reset session + dispose pool để force fresh connection, tránh
        # MySQL REPEATABLE READ giữ snapshot cũ không thấy team mới tạo.
        from CTFd.models import db
        try:
            db.session.close()
        except Exception:
            pass
        db.session.remove()
        try:
            # Expire tất cả objects trong identity map
            db.session.expire_all()
        except Exception:
            pass

        configs = KypoChallengeConfig.query.all()
        if not configs:
            return

        # Build username → team_id index
        # KYPO trả về `name` = "firstName lastName" = "{team_name} FCTF Team"
        # kypo_username = "fctf_{safe_name}_{team_id}" (safe_name = tên lúc tạo account)
        from CTFd.models import Teams
        accounts = KypoTeamAccount.query.all()
        username_to_team: dict[str, int] = {}
        # safe_first_name → team_id: dùng để fallback khi tên team trong DB thay đổi
        safe_first_name_to_team: dict[str, int] = {}

        for acc in accounts:
            # Format 1: kypo_username chính xác (vd: fctf_team23_3)
            username_to_team[acc.kypo_username] = acc.team_id
            username_to_team[acc.kypo_username.lower()] = acc.team_id

            # Format 2: display name dùng tên team HIỆN TẠI trong DB
            team = Teams.query.get(acc.team_id)
            if team:
                display_name = f"{team.name} FCTF Team"
                username_to_team[display_name] = acc.team_id
                username_to_team[display_name.lower()] = acc.team_id
            else:
                log.warning(
                    "[KYPO Poller] KypoTeamAccount team_id=%s không tồn tại trong DB.",
                    acc.team_id,
                )

            # Format 3 (fallback): trích safe_name từ kypo_username
            # kypo_username = "fctf_{safe_name}_{team_id}" → lấy phần giữa
            parts = acc.kypo_username.split("_")
            if len(parts) >= 3 and parts[0] == "fctf":
                safe_first = "_".join(parts[1:-1])
                safe_first_name_to_team[safe_first] = acc.team_id

        if not username_to_team:
            log.warning("[KYPO Poller] Không có KypoTeamAccount nào — bỏ qua cycle.")
            return

        log.info(
            "[KYPO Poller] Mapping: %d KypoTeamAccount(s) → %d unique team(s).",
            len(accounts),
            len({v for v in username_to_team.values()}),
        )

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
                _sync_instance(cfg, token, rc, username_to_team, safe_first_name_to_team, now_iso)
            except Exception as exc:
                log.error(
                    "[KYPO Poller] Unhandled error challenge=%s: %s",
                    cfg.challenge_id, exc, exc_info=True,
                )

        log.info("[KYPO Poller] Cycle done. %d config(s).", len(configs))
        # Luôn xóa cache sau mỗi cycle để scoreboard hiện team mới ngay
        _clear_scoreboard_cache()


# ── Public: manual trigger (dùng cho API endpoint) ────────────────────────────

def run_poll_cycle_now(app):
    """Trigger 1 cycle ngay lập tức (dùng từ API endpoint /kypo/sync)."""
    _run_poll_cycle(app)


# ── Thread loop ────────────────────────────────────────────────────────────────

def _loop(app):
    # Dùng time.sleep thật từ stdlib gốc, tránh gevent patch
    try:
        from gevent.monkey import get_original
        _sleep = get_original("time", "sleep")
    except Exception:
        import time as _t
        _sleep = _t.sleep

    log.info("[KYPO Poller] Started. Interval=%ds", POLL_INTERVAL)
    while not _stop_event.is_set():
        try:
            _run_poll_cycle(app)
        except Exception as exc:
            log.error("[KYPO Poller] Loop error: %s", exc, exc_info=True)
        _sleep(POLL_INTERVAL)
    log.info("[KYPO Poller] Stopped.")


def start_poller(app):
    """Khởi động daemon thread. Gọi 1 lần duy nhất khi app start.

    Dùng OS thread thật (bypass gevent monkey-patch) để poller chạy
    độc lập, không phụ thuộc vào gevent hub của Flask server.
    """
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()

    # Lấy threading.Thread gốc trước khi gevent patch, tránh greenlet
    try:
        from gevent.monkey import get_original
        RealThread = get_original("threading", "Thread")
    except Exception:
        RealThread = threading.Thread

    _thread = RealThread(
        target=_loop,
        args=(app,),
        name="kypo-poller",
        daemon=True,
    )
    _thread.start()
    import logging
    logging.getLogger(__name__).info(
        "[KYPO Poller] Thread started (type=%s)", type(_thread).__name__
    )


def stop_poller():
    _stop_event.set()
