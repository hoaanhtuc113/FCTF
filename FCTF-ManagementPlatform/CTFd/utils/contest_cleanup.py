import datetime
import json
import re
import threading
import time

import redis

from CTFd.constants.envvars import get_redis_client_kwargs

redis_client = redis.StrictRedis(**get_redis_client_kwargs())

_scheduler_started = False
_scheduler_lock = threading.Lock()


def _get_challenge_ids_for_contest(contest_id):
    from CTFd.models import Challenges

    rows = Challenges.query.filter_by(contest_id=contest_id, require_deploy=True).all()
    return [c.id for c in rows]


def stop_contest_instances(app, contest_id):
    """
    Stop every running K8s instance that belongs to a contest.
    Called automatically by the scheduler when end_time is reached.

    Order:
        1. Find all deploy-required challenges in the contest
        2. Scan Redis for live instances of each challenge
        3. call force_stop() per instance (deployment service handles K8s + Redis cleanup)
    """
    from CTFd.utils.connector.multiservice_connector import force_stop

    with app.app_context():
        challenge_ids = _get_challenge_ids_for_contest(contest_id)
        if not challenge_ids:
            return

        total_stopped = 0
        total_failed = 0

        for challenge_id in challenge_ids:
            pattern = f"deploy_challenge_{challenge_id}_*"
            keys = list(redis_client.scan_iter(pattern))
            if not keys:
                continue

            print(f"[contest_cleanup] contest={contest_id} challenge={challenge_id}: {len(keys)} instance(s)")

            for key in keys:
                key_str = key if isinstance(key, str) else key.decode("utf-8")
                match = re.match(r"deploy_challenge_(\d+)_(-?\d+)", key_str)
                if not match:
                    continue

                team_id = int(match.group(2))

                user_id = None
                value_raw = redis_client.get(key)
                if value_raw:
                    try:
                        user_id = json.loads(value_raw).get("user_id")
                    except (json.JSONDecodeError, TypeError):
                        pass

                if user_id is None:
                    print(f"[contest_cleanup] Skipping key {key_str}: no user_id in Redis value")
                    continue

                try:
                    force_stop(user_id=user_id, challenge_id=challenge_id, team_id=team_id)
                    total_stopped += 1
                    print(f"[contest_cleanup] Stopped: challenge={challenge_id} team={team_id}")
                except Exception as exc:
                    total_failed += 1
                    print(f"[contest_cleanup] Failed to stop challenge={challenge_id} team={team_id}: {exc}")

        print(f"[contest_cleanup] contest={contest_id} done — stopped={total_stopped} failed={total_failed}")


def _check_and_cleanup_ended_contests(app):
    """
    Find contests whose end_time has passed but cleanup has not been triggered yet,
    then stop all their running instances.
    """
    from CTFd.models import Contests, db

    with app.app_context():
        now = datetime.datetime.utcnow()
        ended = Contests.query.filter(
            Contests.end_time != None,
            Contests.end_time <= now,
            Contests.cleanup_triggered_at == None,
        ).all()

        for contest in ended:
            print(f"[contest_cleanup] Contest '{contest.name}' (id={contest.id}) ended at {contest.end_time} — triggering cleanup")
            try:
                stop_contest_instances(app, contest.id)
                contest.cleanup_triggered_at = now
                db.session.commit()
                print(f"[contest_cleanup] Contest {contest.id} cleanup complete")
            except Exception as exc:
                db.session.rollback()
                print(f"[contest_cleanup] Error during cleanup for contest {contest.id}: {exc}")


def _scheduler_loop(app, interval_seconds=60):
    while True:
        try:
            _check_and_cleanup_ended_contests(app)
        except Exception as exc:
            print(f"[contest_cleanup] Scheduler tick error: {exc}")
        time.sleep(interval_seconds)


def start_contest_cleanup_scheduler(app, interval_seconds=60):
    """
    Start a daemon background thread that checks every `interval_seconds`
    whether any contest has ended and triggers K8s cleanup if so.

    Safe to call multiple times — only one thread will ever be started.
    """
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True

    thread = threading.Thread(
        target=_scheduler_loop,
        args=(app, interval_seconds),
        daemon=True,
        name="contest-cleanup-scheduler",
    )
    thread.start()
    print(f"[contest_cleanup] Scheduler started (interval={interval_seconds}s)")
