"""
Admin Audit Trail
=================
Routes for browsing, filtering and exporting the persisted ``admin_audit_logs``
table that records every privileged mutation performed by admins, jury members,
and challenge writers.

Accessible at  /admin/admin_audit

Filter dimensions
-----------------
* Actor (user id or partial name)
* Actor role  (admin / jury / challenge_writer)
* Action keyword  (e.g. challenge_update)
* Target type  (user / team / challenge / config / submission)
* Date range  (YYYY-MM-DD)
"""

import csv
import json
from datetime import datetime, timedelta
from io import StringIO

from flask import Response, render_template, request, stream_with_context, url_for

from CTFd.admin import admin
from CTFd.models import AdminAuditLog, Users, db
from CTFd.utils.decorators import admin_or_jury

# ── Constants ────────────────────────────────────────────────────────────────

ALL_ACTIONS = [
    "challenge_create",
    "challenge_update",
    "challenge_delete",
    "user_create",
    "user_update",
    "user_delete",
    "team_create",
    "team_update",
    "team_delete",
    "submission_create",
    "submission_update",
    "submission_delete",
    "config_create",
    "config_update",
    "config_delete",
    "config_bulk_update",
    "hint_create",
    "hint_update",
    "hint_delete",
    "flag_create",
    "flag_update",
    "flag_delete",
    "tag_create",
    "tag_update",
    "tag_delete",
    "award_create",
    "award_delete",
    "page_create",
    "page_update",
    "page_delete",
    "file_create",
    "file_delete",
    "comment_create",
    "comment_delete",
    "bracket_create",
    "bracket_update",
    "bracket_delete",
    "bulk_password_reset",
    "ctf_reset",
]

TARGET_TYPES = [
    "challenge", "user", "team", "submission", "config",
    "hint", "flag", "tag", "award",
    "page", "file", "comment", "bracket",
    "system",
]

ACTOR_ROLES = ["admin", "jury", "challenge_writer"]

# Human-readable labels for display
ACTION_LABELS: dict[str, str] = {
    "challenge_create": "Create Challenge",
    "challenge_update": "Update Challenge",
    "challenge_delete": "Delete Challenge",
    "user_create": "Create User",
    "user_update": "Update User",
    "user_delete": "Delete User",
    "team_create": "Create Team",
    "team_update": "Update Team",
    "team_delete": "Delete Team",
    "submission_create": "Create Submission",
    "submission_update": "Mark Correct/Incorrect",
    "submission_delete": "Delete Submission",
    "config_create": "Create Config",
    "config_update": "Update Config",
    "config_delete": "Delete Config",
    "config_bulk_update": "Bulk Update Config",
    "hint_create": "Create Hint",
    "hint_update": "Update Hint",
    "hint_delete": "Delete Hint",
    "flag_create": "Create Flag",
    "flag_update": "Update Flag",
    "flag_delete": "Delete Flag",
    "tag_create": "Create Tag",
    "tag_update": "Update Tag",
    "tag_delete": "Delete Tag",
    "award_create": "Create Award",
    "award_delete": "Delete Award",
    "page_create": "Create Page",
    "page_update": "Update Page",
    "page_delete": "Delete Page",
    "file_create": "Upload File",
    "file_delete": "Delete File",
    "comment_create": "Create Comment",
    "comment_delete": "Delete Comment",
    "bracket_create": "Create Bracket",
    "bracket_update": "Update Bracket",
    "bracket_delete": "Delete Bracket",
    "bulk_password_reset": "Bulk Password Reset",
    "ctf_reset": "CTF Reset (Wipe Data)",
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _escape_like(value: str) -> str:
    """Escape SQLAlchemy LIKE wildcards to prevent inadvertent matches."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _build_query(
    actor_filter: str,
    role_filter: str,
    action_filter: str,
    target_type_filter: str,
    target_id_filter: str,
    date_from: str,
    date_to: str,
):
    q = AdminAuditLog.query.order_by(AdminAuditLog.timestamp.desc())

    # ── Actor filter (id or name) ────────────────────────────────────────────
    if actor_filter:
        actor_int = _parse_int(actor_filter)
        if actor_int is not None:
            q = q.filter(AdminAuditLog.actor_id == actor_int)
        else:
            pattern = f"%{_escape_like(actor_filter)}%"
            q = q.filter(AdminAuditLog.actor_name.ilike(pattern, escape="\\"))

    # ── Role filter ─────────────────────────────────────────────────────────
    if role_filter:
        q = q.filter(AdminAuditLog.actor_type == role_filter)

    # ── Action filter ────────────────────────────────────────────────────────
    if action_filter:
        q = q.filter(AdminAuditLog.action == action_filter)

    # ── Target-type filter ───────────────────────────────────────────────────
    if target_type_filter:
        q = q.filter(AdminAuditLog.target_type == target_type_filter)

    # ── Target-id filter ────────────────────────────────────────────────────
    if target_id_filter:
        target_int = _parse_int(target_id_filter)
        if target_int is not None:
            q = q.filter(AdminAuditLog.target_id == target_int)

    # ── Date-range filters ───────────────────────────────────────────────────
    if date_from:
        try:
            dt_from = datetime.strptime(date_from, "%Y-%m-%d")
            q = q.filter(AdminAuditLog.timestamp >= dt_from)
        except ValueError:
            pass

    if date_to:
        try:
            dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            q = q.filter(AdminAuditLog.timestamp < dt_to)
        except ValueError:
            pass

    return q


def _current_filters() -> dict:
    return {
        "actor_filter": (request.args.get("actor") or "").strip(),
        "role_filter": (request.args.get("role") or "").strip(),
        "action_filter": (request.args.get("action") or "").strip(),
        "target_type_filter": (request.args.get("target_type") or "").strip(),
        "target_id_filter": (request.args.get("target_id") or "").strip(),
        "date_from": (request.args.get("date_from") or "").strip(),
        "date_to": (request.args.get("date_to") or "").strip(),
    }


# ── Main listing ─────────────────────────────────────────────────────────────

@admin.route("/admin/admin_audit")
@admin_or_jury
def admin_audit_listing():
    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 50, type=int)
    per_page = max(1, min(per_page, 200))

    filters = _current_filters()
    q = _build_query(**filters)
    logs = q.paginate(page=page, per_page=per_page, error_out=False)

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/admin_audit/admin_audit.html",
        logs=logs,
        prev_page=url_for(request.endpoint, page=logs.prev_num, **args),
        next_page=url_for(request.endpoint, page=logs.next_num, **args),
        per_page=per_page,
        all_actions=ALL_ACTIONS,
        target_types=TARGET_TYPES,
        actor_roles=ACTOR_ROLES,
        action_labels=ACTION_LABELS,
        **filters,
    )


# ── CSV export ────────────────────────────────────────────────────────────────

@admin.route("/admin/admin_audit/export/csv")
@admin_or_jury
def admin_audit_export_csv():
    filters = _current_filters()
    q = _build_query(**filters)

    def generate():
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(
            [
                "id",
                "timestamp",
                "actor_id",
                "actor_name",
                "actor_type",
                "action",
                "action_label",
                "target_type",
                "target_id",
                "before_state",
                "after_state",
                "extra_data",
                "ip_address",
            ]
        )
        yield sio.getvalue()
        sio.seek(0)
        sio.truncate(0)

        for log in q.yield_per(1000):
            writer.writerow(
                [
                    log.id,
                    log.timestamp.isoformat() if log.timestamp else "",
                    log.actor_id or "",
                    log.actor_name or "",
                    log.actor_type or "",
                    log.action,
                    ACTION_LABELS.get(log.action, log.action),
                    log.target_type or "",
                    log.target_id or "",
                    json.dumps(log.before_state) if log.before_state else "",
                    json.dumps(log.after_state) if log.after_state else "",
                    json.dumps(log.extra_data) if log.extra_data else "",
                    log.ip_address or "",
                ]
            )
            yield sio.getvalue()
            sio.seek(0)
            sio.truncate(0)

    headers = {
        "Content-Disposition": 'attachment; filename="admin_audit.csv"',
        "Content-Type": "text/csv; charset=utf-8",
    }
    return Response(stream_with_context(generate()), headers=headers)
