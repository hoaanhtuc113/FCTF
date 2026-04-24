"""
Contest management API.

Endpoints:
  GET/POST  /api/v1/contests
  GET/PATCH/DELETE  /api/v1/contests/<id>
  GET/POST  /api/v1/contests/<id>/challenges
  PATCH/DELETE  /api/v1/contests/<id>/challenges/<cc_id>
  GET  /api/v1/contests/<id>/participants
  POST /api/v1/contests/<id>/participants/import   (Excel upload)
"""

import datetime
import io
import secrets
import string

from flask import request
from flask_restx import Namespace, Resource

from CTFd.models import (
    Challenges,
    ContestParticipants,
    Contests,
    ContestsChallenges,
    Semester,
    Users,
    db,
)
from CTFd.utils.crypto import hash_password
from CTFd.utils.decorators import admins_or_teachers
from CTFd.utils.user import get_current_user, is_admin

contests_namespace = Namespace("contests", description="Contest management endpoints")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _contest_or_404(contest_id: int) -> Contests:
    c = Contests.query.get(contest_id)
    if c is None:
        contests_namespace.abort(404, "Contest not found")
    return c


def _random_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _serialize_contest(c: Contests) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "slug": c.slug,
        "owner_id": c.owner_id,
        "semester_name": c.semester_name,
        "state": c.state,
        "user_mode": c.user_mode,
        "start_time": c.start_time.isoformat() if c.start_time else None,
        "end_time": c.end_time.isoformat() if c.end_time else None,
        "freeze_scoreboard_at": c.freeze_scoreboard_at.isoformat() if c.freeze_scoreboard_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _serialize_cc(cc: ContestsChallenges) -> dict:
    bank = cc.bank_challenge
    return {
        "id": cc.id,
        "contest_id": cc.contest_id,
        "bank_id": cc.bank_id,
        "name": cc.name or (bank.name if bank else None),
        "category": bank.category if bank else None,
        "type": bank.type if bank else None,
        "state": cc.state,
        "value": cc.value,
        "max_attempts": cc.max_attempts,
        "time_limit": cc.time_limit,
        "cooldown": cc.cooldown,
        "require_deploy": cc.require_deploy,
        "deploy_status": cc.deploy_status,
        "connection_protocol": cc.connection_protocol,
        "max_deploy_count": cc.max_deploy_count,
    }


def _serialize_participant(p: ContestParticipants) -> dict:
    return {
        "id": p.id,
        "contest_id": p.contest_id,
        "user_id": p.user_id,
        "team_id": p.team_id,
        "role": p.role,
        "score": p.score,
        "joined_at": p.joined_at.isoformat() if p.joined_at else None,
        "last_solve_at": p.last_solve_at.isoformat() if p.last_solve_at else None,
        "email": p.user.email if p.user else None,
        "name": p.user.name if p.user else None,
    }


# ---------------------------------------------------------------------------
# Contest list / create
# ---------------------------------------------------------------------------

def _check_contest_access(contest: Contests) -> None:
    """Kiểm tra quyền truy cập: admin thấy tất cả, teacher chỉ thấy contest của mình."""
    if is_admin():
        return
    user = get_current_user()
    if user is None or contest.owner_id != user.id:
        contests_namespace.abort(403, "You do not have permission to access this contest")


@contests_namespace.route("")
class ContestList(Resource):
    # admins_or_teachers: admin thấy/quản lý tất cả; teacher tạo được contest
    method_decorators = [admins_or_teachers]

    def get(self):
        """List contests. Admin thấy tất cả; teacher chỉ thấy contest của mình."""
        user = get_current_user()
        if is_admin():
            contests = Contests.query.order_by(Contests.id.desc()).all()
        else:
            contests = Contests.query.filter_by(owner_id=user.id).order_by(Contests.id.desc()).all()
        return {"success": True, "data": [_serialize_contest(c) for c in contests]}

    def post(self):
        """Create a new contest.

        Body (JSON):
          name, slug, description?, semester_name?,
          state?, user_mode?, start_time?, end_time?, freeze_scoreboard_at?

        If semester_name is provided and the semester doesn't exist, it is
        created automatically.
        """
        data = request.get_json(silent=True) or {}

        name = data.get("name", "").strip()
        slug = data.get("slug", "").strip()
        if not name or not slug:
            contests_namespace.abort(400, "name and slug are required")

        if Contests.query.filter_by(slug=slug).first():
            contests_namespace.abort(400, f"Slug '{slug}' already exists")

        semester_name = data.get("semester_name")
        if semester_name:
            if not Semester.query.filter_by(semester_name=semester_name).first():
                db.session.add(Semester(semester_name=semester_name))
                db.session.flush()

        def _parse_dt(val):
            if not val:
                return None
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.datetime.strptime(val, fmt)
                except ValueError:
                    continue
            return None

        user = get_current_user()
        contest = Contests(
            name=name,
            slug=slug,
            description=data.get("description"),
            semester_name=semester_name,
            state=data.get("state", "draft"),
            user_mode=data.get("user_mode", "users"),
            owner_id=user.id if user else None,
            start_time=_parse_dt(data.get("start_time")),
            end_time=_parse_dt(data.get("end_time")),
            freeze_scoreboard_at=_parse_dt(data.get("freeze_scoreboard_at")),
        )
        db.session.add(contest)
        db.session.commit()
        return {"success": True, "data": _serialize_contest(contest)}, 201


# ---------------------------------------------------------------------------
# Contest detail / update / delete
# ---------------------------------------------------------------------------

@contests_namespace.route("/<int:contest_id>")
class ContestDetail(Resource):
    method_decorators = [admins_or_teachers]

    def get(self, contest_id):
        """Get a single contest."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        return {"success": True, "data": _serialize_contest(contest)}

    def patch(self, contest_id):
        """Update a contest (partial update)."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        data = request.get_json(silent=True) or {}

        for field in ("name", "description", "state", "user_mode", "semester_name"):
            if field in data:
                setattr(contest, field, data[field])

        if "slug" in data and data["slug"] != contest.slug:
            if Contests.query.filter_by(slug=data["slug"]).first():
                contests_namespace.abort(400, f"Slug '{data['slug']}' already exists")
            contest.slug = data["slug"]

        def _parse_dt(val):
            if not val:
                return None
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.datetime.strptime(val, fmt)
                except ValueError:
                    continue
            return None

        for dt_field in ("start_time", "end_time", "freeze_scoreboard_at"):
            if dt_field in data:
                setattr(contest, dt_field, _parse_dt(data[dt_field]))

        if "semester_name" in data and data["semester_name"]:
            if not Semester.query.filter_by(semester_name=data["semester_name"]).first():
                db.session.add(Semester(semester_name=data["semester_name"]))
                db.session.flush()

        contest.updated_at = datetime.datetime.utcnow()
        db.session.commit()
        return {"success": True, "data": _serialize_contest(contest)}

    def delete(self, contest_id):
        """Delete a contest — chỉ admin mới được xóa."""
        if not is_admin():
            contests_namespace.abort(403, "Only admins can delete contests")
        contest = _contest_or_404(contest_id)
        db.session.delete(contest)
        db.session.commit()
        return {"success": True}


# ---------------------------------------------------------------------------
# Contest challenges — list / import from bank
# ---------------------------------------------------------------------------

@contests_namespace.route("/<int:contest_id>/challenges")
class ContestChallengeList(Resource):
    method_decorators = [admins_or_teachers]

    def get(self, contest_id):
        """List all challenges in a contest."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        ccs = ContestsChallenges.query.filter_by(contest_id=contest_id).all()
        return {"success": True, "data": [_serialize_cc(cc) for cc in ccs]}

    def post(self, contest_id):
        """Import a bank challenge into the contest.

        Body (JSON):
          bank_id          — required, id of the bank challenge
          value?           — point value override (default: bank default or 100)
          state?           — visible | hidden (default: visible)
          max_attempts?    — 0 = unlimited
          time_limit?      — seconds, None = no limit
          cooldown?        — seconds between attempts
          require_deploy?  — bool
          max_deploy_count?
          connection_protocol?
        """
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        data = request.get_json(silent=True) or {}

        bank_id = data.get("bank_id")
        if not bank_id:
            contests_namespace.abort(400, "bank_id is required")

        bank = Challenges.query.get(bank_id)
        if bank is None:
            contests_namespace.abort(404, f"Bank challenge {bank_id} not found")

        # Prevent duplicate import of the same bank challenge into the same contest
        existing = ContestsChallenges.query.filter_by(
            contest_id=contest_id, bank_id=bank_id
        ).first()
        if existing:
            contests_namespace.abort(
                400,
                f"Bank challenge {bank_id} is already in contest {contest_id} (cc_id={existing.id})"
            )

        cc = ContestsChallenges(
            contest_id=contest_id,
            bank_id=bank_id,
            state=data.get("state", "visible"),
            value=data.get("value", 100),
            max_attempts=data.get("max_attempts", 0),
            time_limit=data.get("time_limit"),
            cooldown=data.get("cooldown", 0),
            require_deploy=bool(data.get("require_deploy", bank.image_link is not None)),
            max_deploy_count=data.get("max_deploy_count", bank.max_deploy_count or 0),
            connection_protocol=data.get("connection_protocol", bank.connection_protocol or "http"),
            deploy_status="CREATED",
        )
        db.session.add(cc)

        # Increment bank import counter
        bank.import_count = (bank.import_count or 0) + 1
        db.session.commit()

        return {"success": True, "data": _serialize_cc(cc)}, 201


# ---------------------------------------------------------------------------
# Contest challenge detail — update / remove
# ---------------------------------------------------------------------------

@contests_namespace.route("/<int:contest_id>/challenges/<int:cc_id>")
class ContestChallengeDetail(Resource):
    method_decorators = [admins_or_teachers]

    def _get_cc(self, contest_id: int, cc_id: int) -> ContestsChallenges:
        cc = ContestsChallenges.query.filter_by(id=cc_id, contest_id=contest_id).first()
        if cc is None:
            contests_namespace.abort(404, "Contest challenge not found")
        return cc

    def patch(self, contest_id, cc_id):
        """Update runtime config of a contest challenge."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        cc = self._get_cc(contest_id, cc_id)
        data = request.get_json(silent=True) or {}

        for field in (
            "name", "state", "value", "max_attempts",
            "time_limit", "cooldown", "require_deploy",
            "max_deploy_count", "connection_protocol", "connection_info",
        ):
            if field in data:
                setattr(cc, field, data[field])

        cc.last_update = datetime.datetime.utcnow()
        db.session.commit()
        return {"success": True, "data": _serialize_cc(cc)}

    def delete(self, contest_id, cc_id):
        """Remove a challenge from a contest (does not delete the bank challenge)."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        cc = self._get_cc(contest_id, cc_id)

        # Decrement bank import counter
        if cc.bank_id:
            bank = Challenges.query.get(cc.bank_id)
            if bank and bank.import_count and bank.import_count > 0:
                bank.import_count -= 1

        db.session.delete(cc)
        db.session.commit()
        return {"success": True}


# ---------------------------------------------------------------------------
# Contest participants — list
# ---------------------------------------------------------------------------

@contests_namespace.route("/<int:contest_id>/participants")
class ContestParticipantList(Resource):
    method_decorators = [admins_or_teachers]

    def get(self, contest_id):
        """List all participants of a contest."""
        contest = _contest_or_404(contest_id)
        _check_contest_access(contest)
        participants = ContestParticipants.query.filter_by(contest_id=contest_id).all()
        return {"success": True, "data": [_serialize_participant(p) for p in participants]}


# ---------------------------------------------------------------------------
# Import participants from Excel
# ---------------------------------------------------------------------------

@contests_namespace.route("/<int:contest_id>/participants/import")
class ContestParticipantImport(Resource):
    method_decorators = [admins_or_teachers]

    def post(self, contest_id):
        """Import participants from an Excel file.

        Accepts multipart/form-data with a file field named 'file'.
        The Excel file must have an 'email' column (first column or named header).

        For each email:
          - If user exists in users table → use that user
          - If not → create a new user (name=email prefix, random password)
          - Add to contest_participants if not already a participant

        Returns a summary of created / already-existing / skipped rows.
        """
        try:
            import openpyxl
        except ImportError:
            contests_namespace.abort(500, "openpyxl is not installed on this server")

        _contest_or_404(contest_id)

        if "file" not in request.files:
            contests_namespace.abort(400, "No file field in request (expected field name: 'file')")

        uploaded = request.files["file"]
        if not uploaded.filename:
            contests_namespace.abort(400, "Empty filename")

        try:
            wb = openpyxl.load_workbook(io.BytesIO(uploaded.read()), read_only=True, data_only=True)
        except Exception as exc:
            contests_namespace.abort(400, f"Cannot parse Excel file: {exc}")

        ws = wb.active

        # Detect header row: look for a cell containing "email" (case-insensitive)
        # in the first row. If found, skip that row; otherwise treat row 1 as data.
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return {"success": True, "data": {"created": [], "existing": [], "errors": []}}

        email_col_index = None
        first_row = rows[0]
        for i, cell in enumerate(first_row):
            if cell and str(cell).strip().lower() == "email":
                email_col_index = i
                break

        data_rows = rows[1:] if email_col_index is not None else rows
        if email_col_index is None:
            email_col_index = 0  # default: first column

        role = request.form.get("role", "contestant")

        created_users = []
        existing_users = []
        errors = []

        for row_idx, row in enumerate(data_rows, start=2 if email_col_index is not None else 1):
            if not row or email_col_index >= len(row):
                continue
            raw_email = row[email_col_index]
            if raw_email is None:
                continue
            email = str(raw_email).strip().lower()
            if not email:
                continue

            # Basic format check
            if "@" not in email:
                errors.append({"row": row_idx, "email": email, "error": "Invalid email format"})
                continue

            try:
                user = Users.query.filter_by(email=email).first()
                is_new = user is None

                if is_new:
                    name = email.split("@")[0]
                    plain_pw = _random_password()
                    user = Users(
                        name=name,
                        email=email,
                        password=hash_password(plain_pw),
                        type="user",
                        hidden=False,
                        banned=False,
                        verified=False,
                    )
                    db.session.add(user)
                    db.session.flush()  # obtain user.id before inserting participant

                # Admin và teacher không được tham gia contest với tư cách contestant
                if user.type in ("admin", "teacher"):
                    errors.append({
                        "row": row_idx,
                        "email": email,
                        "error": f"User '{email}' has role '{user.type}' and cannot be a contest participant",
                    })
                    continue

                existing_part = ContestParticipants.query.filter_by(
                    contest_id=contest_id, user_id=user.id
                ).first()

                if existing_part is None:
                    part = ContestParticipants(
                        contest_id=contest_id,
                        user_id=user.id,
                        role=role,
                    )
                    db.session.add(part)
                    db.session.flush()

                if is_new:
                    created_users.append({"email": email, "user_id": user.id})
                else:
                    existing_users.append({"email": email, "user_id": user.id})

            except Exception as exc:
                db.session.rollback()
                errors.append({"row": row_idx, "email": email, "error": str(exc)})

        db.session.commit()
        wb.close()

        return {
            "success": True,
            "data": {
                "created": created_users,
                "existing": existing_users,
                "errors": errors,
                "summary": {
                    "created_count": len(created_users),
                    "existing_count": len(existing_users),
                    "error_count": len(errors),
                },
            },
        }