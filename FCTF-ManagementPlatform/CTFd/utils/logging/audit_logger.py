import json
import logging
from datetime import datetime
from flask import session

audit_logger = logging.getLogger("audit")
audit_logger.setLevel(logging.INFO)

# Maps action name → canonical target_type string
_ACTION_TARGET_TYPES = {
    "user_create": "user",
    "user_update": "user",
    "user_delete": "user",
    "team_create": "team",
    "team_update": "team",
    "team_delete": "team",
    "challenge_create": "challenge",
    "challenge_update": "challenge",
    "challenge_delete": "challenge",
    "config_create": "config",
    "config_update": "config",
    "config_delete": "config",
    "config_bulk_update": "config",
    "submission_create": "submission",
    "submission_update": "submission",
    "submission_delete": "submission",
    "hint_create": "hint",
    "hint_update": "hint",
    "hint_delete": "hint",
    "flag_create": "flag",
    "flag_update": "flag",
    "flag_delete": "flag",
    "tag_create": "tag",
    "tag_update": "tag",
    "tag_delete": "tag",
    "award_create": "award",
    "award_delete": "award",
    "file_create": "file",
    "file_delete": "file",
    "comment_create": "comment",
    "comment_delete": "comment",
    "bracket_create": "bracket",
    "bracket_update": "bracket",
    "bracket_delete": "bracket",
    # Bulk / destructive admin operations
    "bulk_password_reset": "user",
    "ctf_reset": "system",
}


def _extract_target_id(action: str, data: dict | None) -> int | None:
    """Pull the primary-key integer of the affected entity from *data*."""
    if not data:
        return None
    if action.startswith("user") or action == "bulk_password_reset":
        return data.get("user_id")
    if action.startswith("team"):
        return data.get("team_id")
    if action.startswith("challenge"):
        return data.get("challenge_id")
    if action.startswith("submission"):
        return data.get("id")
    if action.startswith("hint"):
        return data.get("hint_id")
    if action.startswith("flag"):
        return data.get("flag_id")
    if action.startswith("tag"):
        return data.get("tag_id")
    if action.startswith("award"):
        return data.get("award_id")
    if action.startswith("file"):
        return data.get("file_id")
    if action.startswith("comment"):
        return data.get("comment_id")
    if action.startswith("bracket"):
        return data.get("bracket_id")
    return None


def log_audit(action: str, before=None, after=None, data=None) -> None:
    """
    Record a privileged action performed by an admin / jury / challenge_writer.

    1. Emits a structured JSON entry to the Python ``audit`` logger (stdout /
       file, depending on the logging configuration).
    2. Persists a row to the ``admin_audit_logs`` database table so that
       history is searchable and survives log rotation.
    """
    actor_id = session.get("id")

    entry = {
        "level": "Information",
        "type": "audit",
        "action": action,
        "userId": actor_id,
        "before": before,
        "after": after,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
    }
    audit_logger.info(json.dumps(entry))

    # ── Persist to DB ────────────────────────────────────────────────────────
    # IMPORTANT: Use a dedicated Session bound directly to the engine so that
    # the audit write is fully isolated from the main request's scoped session.
    # This guarantees:
    #   • log_audit() never prematurely commits the caller's pending changes.
    #   • an audit-log failure (or rollback) never corrupts the caller's
    #     in-flight transaction.
    try:
        # Lazy imports prevent circular references (models → utils → models).
        from CTFd.models import AdminAuditLog, Users, db
        from flask import request as flask_request
        from sqlalchemy.orm import Session as _SASession

        actor_name: str | None = None
        actor_type: str | None = None

        if actor_id:
            # Query through the main session (read-only – no write risk).
            user = Users.query.filter_by(id=actor_id).first()
            if user:
                actor_name = user.name
                actor_type = user.type

        ip_address: str | None = None
        try:
            ip_address = flask_request.remote_addr
        except Exception:
            pass

        log_entry = AdminAuditLog(
            actor_id=actor_id,
            actor_name=actor_name,
            actor_type=actor_type,
            action=action,
            target_type=_ACTION_TARGET_TYPES.get(action),
            target_id=_extract_target_id(action, data),
            before_state=before,
            after_state=after,
            extra_data=data,
            ip_address=ip_address,
        )

        # Open a brand-new session that shares NO state with db.session.
        # `begin()` auto-commits on clean exit and rolls back on exception,
        # both without touching the caller's session.
        with _SASession(db.engine) as audit_session:
            with audit_session.begin():
                audit_session.add(log_entry)
    except Exception as exc:  # noqa: BLE001
        # Log the failure but do NOT touch db.session — the main operation
        # must continue unaffected.
        audit_logger.error("Failed to persist audit log to DB: %s", exc)
