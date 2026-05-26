import datetime
import re

from flask import request
from flask_restx import Namespace, Resource

from CTFd.models import ContestParticipant, Contests, Users, db
from CTFd.utils.decorators import admins_only
from CTFd.utils.logging.audit_logger import log_audit

contests_namespace = Namespace("contests", description="Endpoint to manage Contests")


def _slugify(text: str) -> str:
    """Convert a string to a URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text


def _contest_to_dict(contest: Contests) -> dict:
    return {
        "id": contest.id,
        "name": contest.name,
        "description": contest.description,
        "slug": contest.slug,
        "owner_id": contest.owner_id,
        "user_mode": contest.user_mode,
        "state": contest.state,
        "start_time": contest.start_time.isoformat() if contest.start_time else None,
        "end_time": contest.end_time.isoformat() if contest.end_time else None,
        "freeze_scoreboard_at": (
            contest.freeze_scoreboard_at.isoformat()
            if contest.freeze_scoreboard_at
            else None
        ),
        "view_after_ctf": contest.view_after_ctf,
        "score_visibility": contest.score_visibility,
        "account_visibility": contest.account_visibility,
        "registration_visibility": contest.registration_visibility,
        "team_size": contest.team_size,
        "captain_only_start_challenge": contest.captain_only_start_challenge,
        "captain_only_submit_challenge": contest.captain_only_submit_challenge,
        "team_disbanding": contest.team_disbanding,
        "allow_name_change": contest.allow_name_change,
        "challenge_difficulty_visibility": contest.challenge_difficulty_visibility,
        "limit_challenges": contest.limit_challenges,
        "incorrect_submissions_per_min": contest.incorrect_submissions_per_min,
        "created_at": contest.created_at.isoformat() if contest.created_at else None,
        "updated_at": contest.updated_at.isoformat() if contest.updated_at else None,
    }


def _parse_datetime(value):
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _validate_times(start_time, end_time, freeze_scoreboard_at):
    """
    Validate contest time constraints.
    Returns a dict of field -> [error messages], empty dict if all valid.
    """
    errors = {}

    if start_time and end_time:
        if end_time <= start_time:
            errors.setdefault("end_time", []).append(
                "End time must be after start time."
            )

    if freeze_scoreboard_at:
        if start_time and freeze_scoreboard_at < start_time:
            errors.setdefault("freeze_scoreboard_at", []).append(
                "Freeze scoreboard time must be on or after start time."
            )
        if end_time and freeze_scoreboard_at > end_time:
            errors.setdefault("freeze_scoreboard_at", []).append(
                "Freeze scoreboard time must be on or before end time."
            )

    return errors


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contests  — list + create
# ─────────────────────────────────────────────────────────────────────────────

@contests_namespace.route("")
class ContestList(Resource):
    method_decorators = [admins_only]

    def get(self):
        """List all contests with optional filtering."""
        q = request.args.get("q", "").strip()
        field = request.args.get("field", "name")
        state = request.args.get("state", "")
        user_mode = request.args.get("user_mode", "")
        page = abs(request.args.get("page", 1, type=int))
        per_page = min(abs(request.args.get("per_page", 20, type=int)), 100)

        filters = []
        if q:
            allowed = {"name", "slug", "description"}
            if field in allowed and hasattr(Contests, field):
                filters.append(getattr(Contests, field).ilike(f"%{q}%"))
        if state:
            filters.append(Contests.state == state)
        if user_mode:
            filters.append(Contests.user_mode == user_mode)

        paginated = (
            Contests.query.filter(*filters)
            .order_by(Contests.id.asc())
            .paginate(page=page, per_page=per_page, error_out=False)
        )

        return {
            "success": True,
            "data": [_contest_to_dict(c) for c in paginated.items],
            "meta": {
                "page": paginated.page,
                "pages": paginated.pages,
                "per_page": per_page,
                "total": paginated.total,
            },
        }

    def post(self):
        """Create a new contest."""
        data = request.get_json(force=True, silent=True) or {}

        name = (data.get("name") or "").strip()
        if not name:
            return {"success": False, "errors": {"name": ["Name is required"]}}, 400

        slug = (data.get("slug") or "").strip()
        if not slug:
            slug = _slugify(name)

        # Check slug uniqueness — reject instead of auto-renaming
        if Contests.query.filter_by(slug=slug).first():
            return {
                "success": False,
                "errors": {"slug": [f"Slug '{slug}' is already used by another contest."]},
            }, 400

        start_time = _parse_datetime(data.get("start_time"))
        end_time = _parse_datetime(data.get("end_time"))
        freeze_scoreboard_at = _parse_datetime(data.get("freeze_scoreboard_at"))

        time_errors = _validate_times(start_time, end_time, freeze_scoreboard_at)
        if time_errors:
            return {"success": False, "errors": time_errors}, 400

        contest = Contests(
            name=name,
            description=data.get("description") or "",
            slug=slug,
            access_password=data.get("access_password") or None,
            owner_id=data.get("owner_id") or None,
            user_mode=data.get("user_mode") or "teams",
            state=data.get("state") or "hidden",
            start_time=start_time,
            end_time=end_time,
            freeze_scoreboard_at=freeze_scoreboard_at,
            view_after_ctf=bool(data.get("view_after_ctf", False)),

            score_visibility=data.get("score_visibility") or "private",
            account_visibility=data.get("account_visibility") or "private",
            registration_visibility=data.get("registration_visibility") or "private",
            team_size=data.get("team_size") or None,
            captain_only_start_challenge=bool(data.get("captain_only_start_challenge", True)),
            captain_only_submit_challenge=bool(data.get("captain_only_submit_challenge", False)),
            team_disbanding=bool(data.get("team_disbanding", True)),
            allow_name_change=bool(data.get("allow_name_change", True)),
            challenge_difficulty_visibility=data.get("challenge_difficulty_visibility") or "disabled",
            limit_challenges=data.get("limit_challenges") or None,
            incorrect_submissions_per_min=data.get("incorrect_submissions_per_min") or None,
        )

        db.session.add(contest)
        db.session.commit()

        log_audit(action="contest_create", data={"contest_id": contest.id, "name": contest.name})

        return {"success": True, "data": _contest_to_dict(contest)}, 201


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contests/<id>  — get, update, delete
# ─────────────────────────────────────────────────────────────────────────────

@contests_namespace.route("/<int:contest_id>")
class ContestDetail(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        """Get a single contest."""
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        return {"success": True, "data": _contest_to_dict(contest)}

    def patch(self, contest_id):
        """Update a contest (partial update)."""
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        data = request.get_json(force=True, silent=True) or {}

        str_fields = [
            "name", "description", "slug", "access_password",
            "user_mode", "state",
            "score_visibility",
            "account_visibility", "registration_visibility",
        ]
        bool_fields = [
            "view_after_ctf", "captain_only_start_challenge",
            "captain_only_submit_challenge", "team_disbanding", "allow_name_change",
        ]
        str_fields += ["challenge_difficulty_visibility"]
        int_fields = ["owner_id", "team_size", "incorrect_submissions_per_min", "limit_challenges"]
        dt_fields = ["start_time", "end_time", "freeze_scoreboard_at"]

        # Validate slug uniqueness before applying changes
        if "slug" in data:
            new_slug = (data["slug"] or "").strip()
            if new_slug:
                conflict = Contests.query.filter(
                    Contests.slug == new_slug,
                    Contests.id != contest_id,
                ).first()
                if conflict:
                    return {
                        "success": False,
                        "errors": {"slug": [f"Slug '{new_slug}' is already used by another contest."]},
                    }, 400

        for f in str_fields:
            if f in data:
                setattr(contest, f, data[f] or None if f in ("access_password",) else (data[f] or ""))

        for f in bool_fields:
            if f in data:
                setattr(contest, f, bool(data[f]))

        for f in int_fields:
            if f in data:
                val = data[f]
                setattr(contest, f, int(val) if val not in (None, "", 0) else None)

        for f in dt_fields:
            if f in data:
                setattr(contest, f, _parse_datetime(data[f]))

        # Validate time constraints after applying all changes
        time_errors = _validate_times(
            contest.start_time,
            contest.end_time,
            contest.freeze_scoreboard_at,
        )
        if time_errors:
            db.session.rollback()
            return {"success": False, "errors": time_errors}, 400

        contest.updated_at = datetime.datetime.utcnow()
        db.session.commit()

        log_audit(action="contest_update", data={"contest_id": contest.id})

        return {"success": True, "data": _contest_to_dict(contest)}

    def delete(self, contest_id):
        """Delete a contest."""
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        name = contest.name
        db.session.delete(contest)
        db.session.commit()

        log_audit(action="contest_delete", data={"contest_id": contest_id, "name": name})

        return {"success": True, "data": {}}


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contests/<id>/participants  — quản lý user trong contest
# ─────────────────────────────────────────────────────────────────────────────

VALID_CONTEST_ROLES = ("contestant", "jury", "challenge_writer")


def _participant_to_dict(p: ContestParticipant) -> dict:
    return {
        "id": p.id,
        "contest_id": p.contest_id,
        "user_id": p.user_id,
        "user_name": p.user.name if p.user else None,
        "user_email": p.user.email if p.user else None,
        "role": p.role,
        "joined_at": p.joined_at.isoformat() if p.joined_at else None,
    }


@contests_namespace.route("/<int:contest_id>/participants")
class ContestParticipantList(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        """List all participants of a contest."""
        Contests.query.filter_by(id=contest_id).first_or_404()

        role = request.args.get("role", "").strip()
        query = ContestParticipant.query.filter_by(contest_id=contest_id)
        if role and role in VALID_CONTEST_ROLES:
            query = query.filter_by(role=role)

        participants = query.all()
        return {
            "success": True,
            "data": [_participant_to_dict(p) for p in participants],
        }

    def post(self, contest_id):
        """Add a user to a contest with a specific role."""
        Contests.query.filter_by(id=contest_id).first_or_404()

        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get("user_id")
        role = (data.get("role") or "contestant").strip()

        if not user_id:
            return {"success": False, "errors": {"user_id": ["user_id is required"]}}, 400

        if role not in VALID_CONTEST_ROLES:
            return {
                "success": False,
                "errors": {
                    "role": [f"role must be one of: {', '.join(VALID_CONTEST_ROLES)}"]
                },
            }, 400

        user = Users.query.filter_by(id=user_id).first()
        if not user:
            return {"success": False, "errors": {"user_id": ["User not found"]}}, 404

        # Platform admin không cần contest participant record
        if user.type == "admin":
            return {
                "success": False,
                "errors": {"user_id": ["Platform admins have access to all contests by default"]},
            }, 400

        existing = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user_id
        ).first()
        if existing:
            return {
                "success": False,
                "errors": {"user_id": ["User is already a participant in this contest"]},
            }, 409

        participant = ContestParticipant(
            contest_id=contest_id,
            user_id=user_id,
            role=role,
        )
        db.session.add(participant)
        db.session.commit()

        log_audit(
            action="contest_participant_add",
            data={"contest_id": contest_id, "user_id": user_id, "role": role},
        )

        return {"success": True, "data": _participant_to_dict(participant)}, 201


@contests_namespace.route("/<int:contest_id>/participants/<int:user_id>")
class ContestParticipantDetail(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id, user_id):
        """Get a specific participant's role in a contest."""
        p = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user_id
        ).first_or_404()
        return {"success": True, "data": _participant_to_dict(p)}

    def patch(self, contest_id, user_id):
        """Update a participant's role in a contest."""
        p = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user_id
        ).first_or_404()

        data = request.get_json(force=True, silent=True) or {}
        role = (data.get("role") or "").strip()

        if not role:
            return {"success": False, "errors": {"role": ["role is required"]}}, 400

        if role not in VALID_CONTEST_ROLES:
            return {
                "success": False,
                "errors": {
                    "role": [f"role must be one of: {', '.join(VALID_CONTEST_ROLES)}"]
                },
            }, 400

        old_role = p.role
        p.role = role
        db.session.commit()

        log_audit(
            action="contest_participant_update",
            data={
                "contest_id": contest_id,
                "user_id": user_id,
                "old_role": old_role,
                "new_role": role,
            },
        )

        return {"success": True, "data": _participant_to_dict(p)}

    def delete(self, contest_id, user_id):
        """Remove a user from a contest."""
        p = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user_id
        ).first_or_404()

        db.session.delete(p)
        db.session.commit()

        log_audit(
            action="contest_participant_remove",
            data={"contest_id": contest_id, "user_id": user_id},
        )

        return {"success": True, "data": {}}
