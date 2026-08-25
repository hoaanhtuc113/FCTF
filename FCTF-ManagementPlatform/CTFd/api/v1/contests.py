import datetime
import re
from zoneinfo import ZoneInfo

from flask import abort, request
from flask_restx import Namespace, Resource

from CTFd.models import ContestParticipant, Contests, Teams, UserTeamMember, Users, db
from CTFd.utils.decorators import admin_or_conductor_only, admins_only
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.user import get_current_user_attrs, is_admin, is_conductor

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
        "timezone": contest.timezone,
        "view_after_ctf": contest.view_after_ctf,
        "score_visibility": contest.score_visibility,
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


def _is_valid_timezone(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except Exception:
        return False


def _parse_datetime(value):
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _validate_times(start_time, end_time, freeze_scoreboard_at, require_times=False):
    """
    Validate contest time constraints.
    Returns a dict of field -> [error messages], empty dict if all valid.
    """
    errors = {}

    if require_times:
        if not start_time:
            errors.setdefault("start_time", []).append("Start time is required.")
        if not end_time:
            errors.setdefault("end_time", []).append("End time is required.")

    if start_time and end_time:
        if end_time <= start_time:
            errors.setdefault("end_time", []).append("End time must be after start time.")

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
    method_decorators = [admin_or_conductor_only]

    def get(self):
        """List all contests with optional filtering.
        Conductors only see contests they own; admins see all."""
        q = request.args.get("q", "").strip()
        field = request.args.get("field", "name")
        state = request.args.get("state", "")
        user_mode = request.args.get("user_mode", "")
        page = abs(request.args.get("page", 1, type=int))
        per_page = min(abs(request.args.get("per_page", 20, type=int)), 100)

        filters = []
        if not is_admin() and is_conductor():
            user_attrs = get_current_user_attrs()
            filters.append(Contests.owner_id == (user_attrs.id if user_attrs else -1))
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

        # Check name uniqueness — reject instead of allowing duplicate contest names
        if Contests.query.filter_by(name=name).first():
            return {
                "success": False,
                "errors": {"name": [f"A contest named '{name}' already exists."]},
            }, 400

        slug = (data.get("slug") or "").strip()
        if not slug:
            slug = _slugify(name)

        # Check slug uniqueness — reject instead of auto-renaming
        if Contests.query.filter_by(slug=slug).first():
            return {
                "success": False,
                "errors": {"slug": [f"Slug '{slug}' is already used by another contest."]},
            }, 400

        raw_start = data.get("start_time")
        raw_end = data.get("end_time")
        raw_freeze = data.get("freeze_scoreboard_at")

        parse_errors = {}
        start_time = _parse_datetime(raw_start)
        end_time = _parse_datetime(raw_end)
        freeze_scoreboard_at = _parse_datetime(raw_freeze)

        if raw_start and start_time is None:
            parse_errors.setdefault("start_time", []).append("Invalid date format.")
        if raw_end and end_time is None:
            parse_errors.setdefault("end_time", []).append("Invalid date format.")
        if raw_freeze and freeze_scoreboard_at is None:
            parse_errors.setdefault("freeze_scoreboard_at", []).append("Invalid date format.")

        timezone = (data.get("timezone") or "Asia/Ho_Chi_Minh").strip()
        if not _is_valid_timezone(timezone):
            parse_errors.setdefault("timezone", []).append("Unknown timezone.")

        if parse_errors:
            return {"success": False, "errors": parse_errors}, 400

        time_errors = _validate_times(start_time, end_time, freeze_scoreboard_at, require_times=True)
        if time_errors:
            return {"success": False, "errors": time_errors}, 400

        current_user = get_current_user_attrs()
        # Conductors always own the contests they create; admins may
        # explicitly assign an owner, defaulting to themselves otherwise.
        if is_conductor() and not is_admin():
            owner_id = current_user.id if current_user else None
        else:
            owner_id = data.get("owner_id") or (current_user.id if current_user else None)

        contest = Contests(
            name=name,
            description=data.get("description") or "",
            slug=slug,
            owner_id=owner_id,
            user_mode=data.get("user_mode") or "teams",
            state=data.get("state") or "hidden",
            start_time=start_time,
            end_time=end_time,
            freeze_scoreboard_at=freeze_scoreboard_at,
            timezone=timezone,
            view_after_ctf=bool(data.get("view_after_ctf", False)),

            score_visibility=data.get("score_visibility") or "private",
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

        created_state = _contest_to_dict(contest)
        log_audit(
            action="contest_create",
            after=created_state,
            data={"contest_id": contest.id, "name": contest.name},
        )

        return {"success": True, "data": created_state}, 201


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contests/<id>  — get, update, delete
# ─────────────────────────────────────────────────────────────────────────────

def _require_owner_or_admin(contest):
    """Conductors may only touch contests they own; admins bypass this."""
    if is_admin():
        return
    user_attrs = get_current_user_attrs()
    if user_attrs is None or contest.owner_id != user_attrs.id:
        abort(403)


@contests_namespace.route("/<int:contest_id>")
class ContestDetail(Resource):
    method_decorators = [admin_or_conductor_only]

    def get(self, contest_id):
        """Get a single contest."""
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        _require_owner_or_admin(contest)
        return {"success": True, "data": _contest_to_dict(contest)}

    def patch(self, contest_id):
        """Update a contest (partial update)."""
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        _require_owner_or_admin(contest)
        data = request.get_json(force=True, silent=True) or {}

        # Read the whole row before any field is touched. Taken later it would
        # already carry the new values, and the audit entry would record a
        # change from a state to itself.
        before_state = _contest_to_dict(contest)

        str_fields = [
            "name", "description", "slug",
            "user_mode", "state",
            "score_visibility",
        ]
        bool_fields = [
            "view_after_ctf", "captain_only_start_challenge",
            "captain_only_submit_challenge", "team_disbanding", "allow_name_change",
        ]
        str_fields += ["challenge_difficulty_visibility", "timezone"]
        int_fields = ["team_size", "incorrect_submissions_per_min", "limit_challenges"]
        if is_admin():
            # Only admins may reassign contest ownership.
            int_fields.append("owner_id")
        dt_fields = ["start_time", "end_time", "freeze_scoreboard_at"]

        if "timezone" in data:
            new_timezone = (data["timezone"] or "").strip()
            if not _is_valid_timezone(new_timezone):
                return {
                    "success": False,
                    "errors": {"timezone": ["Unknown timezone."]},
                }, 400

        # Validate name uniqueness before applying changes
        if "name" in data:
            new_name = (data["name"] or "").strip()
            if new_name:
                conflict = Contests.query.filter(
                    Contests.name == new_name,
                    Contests.id != contest_id,
                ).first()
                if conflict:
                    return {
                        "success": False,
                        "errors": {"name": [f"A contest named '{new_name}' already exists."]},
                    }, 400

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

        # Reducing team_size or switching to solo user_mode must not orphan
        # teams that already exceed the new limit.
        if "team_size" in data:
            raw_size = data["team_size"]
            new_team_size = int(raw_size) if raw_size not in (None, "", 0) else None
            if new_team_size is not None:
                oversized_team = (
                    db.session.query(Teams.id)
                    .join(UserTeamMember, UserTeamMember.team_id == Teams.id)
                    .filter(Teams.contest_id == contest_id)
                    .group_by(Teams.id)
                    .having(db.func.count(UserTeamMember.id) > new_team_size)
                    .first()
                )
                if oversized_team is not None:
                    return {
                        "success": False,
                        "errors": {
                            "team_size": [
                                "Cannot set max team size to {0}: at least one team "
                                "already has more than {0} members.".format(new_team_size)
                            ]
                        },
                    }, 400

        if data.get("user_mode") == "users" and contest.user_mode != "users":
            multi_member_team = (
                db.session.query(Teams.id)
                .join(UserTeamMember, UserTeamMember.team_id == Teams.id)
                .filter(Teams.contest_id == contest_id)
                .group_by(Teams.id)
                .having(db.func.count(UserTeamMember.id) > 1)
                .first()
            )
            if multi_member_team is not None:
                return {
                    "success": False,
                    "errors": {
                        "user_mode": [
                            "Cannot switch to user mode: one or more teams still have "
                            "more than 1 member. Remove members or disband those teams first."
                        ]
                    },
                }, 400

        for f in str_fields:
            if f in data:
                setattr(contest, f, data[f] or "")

        for f in bool_fields:
            if f in data:
                setattr(contest, f, bool(data[f]))

        for f in int_fields:
            if f in data:
                val = data[f]
                setattr(contest, f, int(val) if val not in (None, "", 0) else None)

        old_end_time = contest.end_time

        parse_errors = {}
        for f in dt_fields:
            if f in data:
                raw = data[f]
                parsed = _parse_datetime(raw)
                if raw and parsed is None:
                    parse_errors.setdefault(f, []).append("Invalid date format.")
                else:
                    setattr(contest, f, parsed)
        if parse_errors:
            return {"success": False, "errors": parse_errors}, 400

        # ContestEndCleanupService (DeploymentListener) only sweeps contests where
        # cleanup_triggered_at IS NULL. Once a contest has been through a cleanup
        # cycle for its old end_time, that flag stays set forever unless cleared
        # here - so moving end_time into the future (extending/rescheduling a
        # contest that already ended once) would otherwise leave every pod
        # deployed during this new run to expire only via each challenge's own
        # Argo timeout instead of the contest-end sweep.
        if "end_time" in data and contest.end_time != old_end_time:
            contest.cleanup_triggered_at = None

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

        after_state = _contest_to_dict(contest)
        log_audit(
            action="contest_update",
            before=before_state,
            after=after_state,
            data={"contest_id": contest.id, "name": contest.name},
        )

        return {"success": True, "data": after_state}

    def delete(self, contest_id):
        """Delete a contest and all associated data."""
        from CTFd.models import (
            Achievements,
            ActionLogs,
            AwardBadges,
            Awards,
            Brackets,
            ChallengeComments,
            ChallengeFiles,
            ChallengeStartTracking,
            ChallengeTopics,
            ChallengeVersion,
            Challenges,
            DeployedChallenge,
            DynamicFlagInstance,
            Flags,
            Hints,
            KypoChallengeConfig,
            KypoTeamAccount,
            NotificationReads,
            NotificationRecipients,
            Notifications,
            Solves,
            Submissions,
            Tags,
            TeamComments,
            TeamFieldEntries,
            Tickets,
            Tracking,
            Unlocks,
            UserComments,
        )
        from CTFd.plugins.dynamic_challenges import DynamicChallenge

        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        _require_owner_or_admin(contest)
        name = contest.name

        # Captured while the row still exists: after the delete there is nothing
        # left to describe what was removed.
        before_state = _contest_to_dict(contest)

        # ── Explicitly delete all dependent records ────────────────────────
        # The Contests model does not define ORM-level cascade on its
        # relationships, so db.session.delete(contest) alone will fail when
        # child rows have non-nullable contest_id / challenge_id FKs.
        # We delete in dependency order (leaves first) to avoid FK violations.

        # 1. Collect challenge IDs and team IDs belonging to this contest
        challenge_ids = [
            r[0]
            for r in db.session.query(Challenges.id)
            .filter(Challenges.contest_id == contest_id)
            .all()
        ]
        team_ids = [
            r[0]
            for r in db.session.query(Teams.id)
            .filter(Teams.contest_id == contest_id)
            .all()
        ]

        # 2. Delete challenge-child tables (deepest leaves first)
        if challenge_ids:
            # Solves reference Submissions, so delete Solves first
            Solves.query.filter(Solves.challenge_id.in_(challenge_ids)).delete(
                synchronize_session=False
            )
            Submissions.query.filter(
                Submissions.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)

            # DynamicFlagInstance → flags → challenges
            DynamicFlagInstance.query.filter(
                DynamicFlagInstance.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)

            # Unlocks reference both hints and challenges
            Unlocks.query.filter(
                Unlocks.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)

            Flags.query.filter(Flags.challenge_id.in_(challenge_ids)).delete(
                synchronize_session=False
            )
            Hints.query.filter(Hints.challenge_id.in_(challenge_ids)).delete(
                synchronize_session=False
            )
            Tags.query.filter(Tags.challenge_id.in_(challenge_ids)).delete(
                synchronize_session=False
            )
            ChallengeFiles.query.filter(
                ChallengeFiles.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            ChallengeTopics.query.filter(
                ChallengeTopics.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            ChallengeStartTracking.query.filter(
                ChallengeStartTracking.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            DeployedChallenge.query.filter(
                DeployedChallenge.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            ChallengeVersion.query.filter(
                ChallengeVersion.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            DynamicChallenge.query.filter(
                DynamicChallenge.id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            ChallengeComments.query.filter(
                ChallengeComments.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            KypoChallengeConfig.query.filter(
                KypoChallengeConfig.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)

            # Achievements → AwardBadges (via challenge_id)
            badge_ids = [
                r[0]
                for r in db.session.query(AwardBadges.id)
                .filter(AwardBadges.challenge_id.in_(challenge_ids))
                .all()
            ]
            if badge_ids:
                Achievements.query.filter(
                    Achievements.award_badge_id.in_(badge_ids)
                ).delete(synchronize_session=False)
                AwardBadges.query.filter(
                    AwardBadges.id.in_(badge_ids)
                ).delete(synchronize_session=False)

            # Clear self-referencing next_id before deleting challenges
            Challenges.query.filter(
                Challenges.contest_id == contest_id,
                Challenges.next_id.isnot(None),
            ).update({"next_id": None}, synchronize_session=False)

            # Delete challenges themselves
            Challenges.query.filter(
                Challenges.contest_id == contest_id
            ).delete(synchronize_session=False)

        # 3. Delete team-dependent records, then teams
        if team_ids:
            # Achievements referencing teams (those not already deleted above)
            Achievements.query.filter(
                Achievements.team_id.in_(team_ids)
            ).delete(synchronize_session=False)
            KypoTeamAccount.query.filter(
                KypoTeamAccount.team_id.in_(team_ids)
            ).delete(synchronize_session=False)
            TeamFieldEntries.query.filter(
                TeamFieldEntries.team_id.in_(team_ids)
            ).delete(synchronize_session=False)
            TeamComments.query.filter(
                TeamComments.team_id.in_(team_ids)
            ).delete(synchronize_session=False)
            UserTeamMember.query.filter(
                UserTeamMember.team_id.in_(team_ids)
            ).delete(synchronize_session=False)
            Teams.query.filter(Teams.contest_id == contest_id).delete(
                synchronize_session=False
            )

        # 4. Awards scoped to this contest
        Awards.query.filter(Awards.contest_id == contest_id).delete(
            synchronize_session=False
        )

        # 5. Delete participants, brackets
        ContestParticipant.query.filter(
            ContestParticipant.contest_id == contest_id
        ).delete(synchronize_session=False)
        Brackets.query.filter(Brackets.contest_id == contest_id).delete(
            synchronize_session=False
        )

        # 6. Delete notifications and their children
        notification_ids = [
            r[0]
            for r in db.session.query(Notifications.id)
            .filter(Notifications.contest_id == contest_id)
            .all()
        ]
        if notification_ids:
            NotificationReads.query.filter(
                NotificationReads.notification_id.in_(notification_ids)
            ).delete(synchronize_session=False)
            NotificationRecipients.query.filter(
                NotificationRecipients.notification_id.in_(notification_ids)
            ).delete(synchronize_session=False)
            Notifications.query.filter(
                Notifications.contest_id == contest_id
            ).delete(synchronize_session=False)

        # 7. UserComments scoped to this contest
        UserComments.query.filter(
            UserComments.contest_id == contest_id
        ).delete(synchronize_session=False)

        # 8. Nullify contest_id on tables that use SET NULL
        Tickets.query.filter(Tickets.contest_id == contest_id).update(
            {"contest_id": None}, synchronize_session=False
        )
        ActionLogs.query.filter(ActionLogs.contest_id == contest_id).update(
            {"contest_id": None}, synchronize_session=False
        )
        Tracking.query.filter(Tracking.contest_id == contest_id).update(
            {"contest_id": None}, synchronize_session=False
        )

        # 9. Finally delete the contest itself
        db.session.delete(contest)
        db.session.commit()

        log_audit(
            action="contest_delete",
            before=before_state,
            data={"contest_id": contest_id, "name": name},
        )

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
            after=_participant_to_dict(participant),
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
        before_state = _participant_to_dict(p)
        p.role = role
        db.session.commit()

        log_audit(
            action="contest_participant_update",
            before=before_state,
            after=_participant_to_dict(p),
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

        before_state = _participant_to_dict(p)

        db.session.delete(p)
        db.session.commit()

        log_audit(
            action="contest_participant_remove",
            before=before_state,
            data={"contest_id": contest_id, "user_id": user_id},
        )

        return {"success": True, "data": {}}
