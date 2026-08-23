"""
Contest activity log
====================
Writes rows to ``action_logs`` — the record of what happened *inside one
contest*. Admin operations on a challenge live here rather than in the global
``admin_audit_logs`` table: they belong to the contest whose challenge they
touched, and the contest view is where an organiser goes looking for them.
``admin_audit_logs`` keeps the platform-wide actions that have no contest to
belong to — contest CRUD itself, users, registration, custom fields, settings.

Types 1-7 are written by ContestantBE for contestant activity. 8 and up are the
admin-side operations recorded from here; keep the two ranges distinct, since
one table serves both and the reader tells them apart by number alone.
"""

import logging

from flask import session

action_logger = logging.getLogger("action")
action_logger.setLevel(logging.INFO)

# ── Contestant activity (written by ContestantBE) ────────────────────────────
ACCESS_CHALLENGE = 1
START_CHALLENGE = 2
CORRECT_FLAG = 3
INCORRECT_FLAG = 4
UNLOCK_HINT = 5
SUBMIT_CHALLENGE = 6
STOP_CHALLENGE = 7

# ── Admin operations on a contest's challenges (written from here) ───────────
CREATE_CHALLENGE = 8
UPDATE_CHALLENGE = 9
DELETE_CHALLENGE = 10
ROLLBACK_CHALLENGE = 11
CREATE_FLAG = 12
UPDATE_FLAG = 13
DELETE_FLAG = 14
CREATE_HINT = 15
UPDATE_HINT = 16
DELETE_HINT = 17
CREATE_TAG = 18
UPDATE_TAG = 19
DELETE_TAG = 20
UPLOAD_FILE = 21
DELETE_FILE = 22
CREATE_TOPIC = 23
DELETE_TOPIC = 24
CONTEST_PAUSE_TOGGLE = 25
CONTEST_REMOVE_USER = 26
CONTEST_UPDATE_USER_ROLE = 27
CONTEST_ADD_USER = 28
CONTEST_CREATE_USER = 29
CONTEST_IMPORT_USERS = 30
CREATE_TEAM = 31
DELETE_TEAM = 32
ADD_TEAM_MEMBER = 33
REMOVE_TEAM_MEMBER = 34
DELETE_TICKETS = 35
RESYNC_DYNAMIC_VALUES = 36
UPDATE_CHALLENGE_VISIBILITY = 37
UPDATE_CHALLENGE_DEPLOY_STATUS = 38
CREATE_TEAM_KYPO = 39
NOTIFICATION_CREATE = 40

ACTION_TYPE_LABELS = {
    ACCESS_CHALLENGE: "ACCESS_CHALLENGE",
    START_CHALLENGE: "START_CHALLENGE",
    CORRECT_FLAG: "CORRECT_FLAG",
    INCORRECT_FLAG: "INCORRECT_FLAG",
    UNLOCK_HINT: "UNLOCK_HINT",
    SUBMIT_CHALLENGE: "SUBMIT_CHALLENGE",
    STOP_CHALLENGE: "STOP_CHALLENGE",
    CREATE_CHALLENGE: "CREATE_CHALLENGE",
    UPDATE_CHALLENGE: "UPDATE_CHALLENGE",
    DELETE_CHALLENGE: "DELETE_CHALLENGE",
    ROLLBACK_CHALLENGE: "ROLLBACK_CHALLENGE",
    CREATE_FLAG: "CREATE_FLAG",
    UPDATE_FLAG: "UPDATE_FLAG",
    DELETE_FLAG: "DELETE_FLAG",
    CREATE_HINT: "CREATE_HINT",
    UPDATE_HINT: "UPDATE_HINT",
    DELETE_HINT: "DELETE_HINT",
    CREATE_TAG: "CREATE_TAG",
    UPDATE_TAG: "UPDATE_TAG",
    DELETE_TAG: "DELETE_TAG",
    UPLOAD_FILE: "UPLOAD_FILE",
    DELETE_FILE: "DELETE_FILE",
    CREATE_TOPIC: "CREATE_TOPIC",
    DELETE_TOPIC: "DELETE_TOPIC",
    CONTEST_PAUSE_TOGGLE: "CONTEST_PAUSE_TOGGLE",
    CONTEST_REMOVE_USER: "CONTEST_REMOVE_USER",
    CONTEST_UPDATE_USER_ROLE: "CONTEST_UPDATE_USER_ROLE",
    CONTEST_ADD_USER: "CONTEST_ADD_USER",
    CONTEST_CREATE_USER: "CONTEST_CREATE_USER",
    CONTEST_IMPORT_USERS: "CONTEST_IMPORT_USERS",
    CREATE_TEAM: "CREATE_TEAM",
    DELETE_TEAM: "DELETE_TEAM",
    ADD_TEAM_MEMBER: "ADD_TEAM_MEMBER",
    REMOVE_TEAM_MEMBER: "REMOVE_TEAM_MEMBER",
    DELETE_TICKETS: "DELETE_TICKETS",
    RESYNC_DYNAMIC_VALUES: "RESYNC_DYNAMIC_VALUES",
    UPDATE_CHALLENGE_VISIBILITY: "UPDATE_CHALLENGE_VISIBILITY",
    UPDATE_CHALLENGE_DEPLOY_STATUS: "UPDATE_CHALLENGE_DEPLOY_STATUS",
    CREATE_TEAM_KYPO: "CREATE_TEAM_KYPO",
    NOTIFICATION_CREATE: "NOTIFICATION_CREATE",
}

# Contestant activity is the half of this table a contestant generates about
# themselves; the admin half is what an organiser did to the contest. The
# contest view splits on this so one can be read without the other.
ADMIN_ACTION_TYPES = frozenset(range(CREATE_CHALLENGE, NOTIFICATION_CREATE + 1))

# action_logs.detail is VARCHAR(255); a longer line would be rejected outright
# by MySQL in strict mode and cost the whole entry.
_DETAIL_MAX = 255


def log_action(
    action_type: int,
    detail: str,
    challenge_id: int | None = None,
    contest_id: int | None = None,
    before=None,
    after=None,
    user_id: int | None = None,
) -> None:
    """
    Record one entry in ``action_logs``.

    ``contest_id`` and ``topic_name`` are resolved from the challenge when they
    are not passed, which matches what ContestantBE writes for the contestant
    half of this table — the contest view filters on ``contest_id``, so an
    entry without one is invisible there no matter what else it holds. Pass
    ``contest_id`` explicitly for a delete, where the challenge row is already
    gone by the time this is called.

    Never raises: a failure to log must not fail the operation being logged.
    """
    try:
        # Lazy imports prevent circular references (models → utils → models).
        from CTFd.models import ActionLogs, Challenges, db
        from sqlalchemy.orm import Session as _SASession

        if user_id is None:
            user_id = session.get("id")

        topic_name = None
        if challenge_id is not None:
            challenge = Challenges.query.filter_by(id=challenge_id).first()
            if challenge is not None:
                if contest_id is None:
                    contest_id = challenge.contest_id
                topic_name = challenge.category

        entry = ActionLogs(
            user_id=user_id,
            type=action_type,
            detail=(detail or "")[:_DETAIL_MAX],
            topic_name=topic_name,
            contest_id=contest_id,
            before_state=before,
            after_state=after,
        )

        # A dedicated session bound straight to the engine, for the same reason
        # log_audit uses one: writing the log must not commit whatever the
        # caller still has pending, and a failed log must not poison the
        # caller's transaction.
        with _SASession(db.engine) as action_session:
            with action_session.begin():
                action_session.add(entry)
    except Exception as exc:  # noqa: BLE001
        action_logger.error("Failed to persist action log to DB: %s", exc)
