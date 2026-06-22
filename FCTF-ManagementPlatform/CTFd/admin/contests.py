import csv
import datetime
import re
from io import BytesIO, StringIO

import json

from flask import Response, abort, current_app, flash, redirect, render_template, request, send_file, session, stream_with_context, url_for
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from CTFd.admin import admin
from CTFd.models import ChallengeStartTracking, ChallengeVersion, Challenges, ContestParticipant, Contests, DeployedChallenge, Flags, Solves, Teams, Users, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.utils.dates import ctftime
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury as admins_only


# ─── Jury / Challenge-Writer per-contest scope enforcement ───────────────────

@admin.before_request
def enforce_jury_cw_contest_scope():
    """
    Jury and challenge_writer users may only access contests they are assigned
    to via ContestParticipant.  Admin bypasses all checks.
    """
    from CTFd.utils.user import authed, is_admin, is_jury, is_challenge_writer, get_current_user_attrs

    if not authed():
        return
    if is_admin():
        return

    if not (is_jury() or is_challenge_writer()):
        return

    m = re.match(r'^/admin/contests/(\d+)(?:/|$)', request.path)
    if not m:
        return

    contest_id = int(m.group(1))
    user_attrs = get_current_user_attrs()
    if user_attrs is None:
        abort(403)

    participant = ContestParticipant.query.filter(
        ContestParticipant.user_id == user_attrs.id,
        ContestParticipant.contest_id == contest_id,
        ContestParticipant.role.in_(["jury", "challenge_writer"]),
    ).first()
    if not participant:
        abort(403)


# ─── Contest access-password enforcement ─────────────────────────────────────

@admin.before_request
def enforce_contest_access_password():
    """
    Trước mỗi request vào admin contest sub-route (trừ verify-access),
    kiểm tra nếu contest có access_password → yêu cầu admin nhập đúng password
    trước khi vào. Kết quả được lưu vào session để không hỏi lại.
    """
    from CTFd.utils.user import authed, is_admin

    # Chỉ xử lý khi đã đăng nhập (admin); nếu chưa thì để @admins_only lo
    if not authed():
        return

    # Match: /admin/contests/<số>  hoặc  /admin/contests/<số>/bất-kỳ
    m = re.match(r'^/admin/contests/(\d+)(?:/|$)', request.path)
    if not m:
        return

    contest_id = int(m.group(1))

    # Không chặn chính trang verify-access (tránh vòng lặp redirect)
    verify_path = f'/admin/contests/{contest_id}/verify-access'
    if request.path.rstrip('/') == verify_path.rstrip('/'):
        return

    contest = Contests.query.filter_by(id=contest_id).first()
    if contest is None or not contest.access_password:
        return  # Không có password → tự do vào

    # Kiểm tra session xem đã verify contest này chưa
    verified_ids = session.get('verified_contest_ids', [])
    if contest_id in verified_ids:
        return  # Đã xác thực trong session này

    # Chuyển đến trang nhập password; lưu URL hiện tại để redirect về sau
    return redirect(url_for(
        'admin.contest_verify_access',
        contest_id=contest_id,
        next=request.path,
    ))


# ─── helpers cho contest instances ───────────────────────────────────────────

def _ci_parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _ci_escape_like(value):
    if not value:
        return value
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ci_parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError:
        return None


def _ci_local_to_utc(dt, timezone_offset):
    offset_minutes = _ci_parse_int(timezone_offset) or 0
    return dt + datetime.timedelta(minutes=offset_minutes)


def _ci_parse_quick_range(value):
    if not value:
        return None
    match = re.match(r"^(\d+)(m|h)$", value.strip())
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        return None
    return datetime.timedelta(minutes=amount) if unit == "m" else datetime.timedelta(hours=amount)


def _ci_base_query(contest_id):
    return (
        db.session.query(
            ChallengeStartTracking,
            Teams.id.label("team_id"),
            Teams.name.label("team_name"),
            Challenges.id.label("challenge_id"),
            Challenges.name.label("challenge_name"),
        )
        .outerjoin(Teams, ChallengeStartTracking.team_id == Teams.id)
        .join(Challenges, ChallengeStartTracking.challenge_id == Challenges.id)
        .filter(Challenges.contest_id == contest_id)
        .order_by(ChallengeStartTracking.started_at.desc())
    )


def _ci_apply_filters(query, team_filter, challenge_filter, start_date, end_date):
    team_id = _ci_parse_int(team_filter)
    if team_filter:
        if team_id is not None:
            query = query.filter(Teams.id == team_id)
        else:
            query = query.filter(Teams.name.ilike(f"%{_ci_escape_like(team_filter)}%", escape="\\"))

    challenge_id = _ci_parse_int(challenge_filter)
    if challenge_filter:
        if challenge_id is not None:
            query = query.filter(Challenges.id == challenge_id)
        else:
            query = query.filter(Challenges.name.ilike(f"%{_ci_escape_like(challenge_filter)}%", escape="\\"))

    if start_date:
        query = query.filter(ChallengeStartTracking.started_at >= start_date)
    if end_date:
        query = query.filter(ChallengeStartTracking.started_at <= end_date)

    return query


# ─────────────────────────────────────────────────────────────────────────────
# Contest listing
# ─────────────────────────────────────────────────────────────────────────────

@admin.route("/admin/contests")
@admins_only
def contests_listing():
    from CTFd.utils.user import is_admin, get_current_user_attrs

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    state_filter = request.args.get("state", "")
    user_mode_filter = request.args.get("user_mode", "")
    sort_by = request.args.get("sort_by", "id")
    sort_dir = request.args.get("sort_dir", "asc")
    page = abs(request.args.get("page", 1, type=int))

    filters = []

    # Non-admin: only show contests where they have jury/challenge_writer role
    if not is_admin():
        user_attrs = get_current_user_attrs()
        if user_attrs:
            allowed_ids = (
                db.session.query(ContestParticipant.contest_id)
                .filter(
                    ContestParticipant.user_id == user_attrs.id,
                    ContestParticipant.role.in_(["jury", "challenge_writer"]),
                )
                .scalar_subquery()
            )
            filters.append(Contests.id.in_(allowed_ids))

    if q:
        allowed_fields = {"name", "slug", "description"}
        if field in allowed_fields and hasattr(Contests, field):
            filters.append(getattr(Contests, field).ilike(f"%{q}%"))

    if state_filter:
        filters.append(Contests.state == state_filter)

    if user_mode_filter:
        filters.append(Contests.user_mode == user_mode_filter)

    # Sorting
    sort_col = getattr(Contests, sort_by, Contests.id)
    if sort_dir == "desc":
        sort_col = sort_col.desc()
    else:
        sort_col = sort_col.asc()

    contests = (
        Contests.query.filter(*filters)
        .order_by(sort_col)
        .paginate(page=page, per_page=20, error_out=False)
    )

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/contests/contests.html",
        contests=contests,
        prev_page=url_for(request.endpoint, page=contests.prev_num, **args),
        next_page=url_for(request.endpoint, page=contests.next_num, **args),
        q=q,
        field=field,
        state_filter=state_filter,
        user_mode_filter=user_mode_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


# ─────────────────────────────────────────────────────────────────────────────
# New contest form
# ─────────────────────────────────────────────────────────────────────────────

@admin.route("/admin/contests/new")
@admins_only
def contests_new():
    return render_template("admin/contests/new.html")


# ─────────────────────────────────────────────────────────────────────────────
# Contest detail / management hub
# ─────────────────────────────────────────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>")
@admins_only
def contests_detail(contest_id):
    from flask import redirect
    return redirect(url_for("admin.contest_dashboard", contest_id=contest_id))


# ─────────────────────────────────────────────────────────────────────────────
# Contest sub-section stubs (sidebar items when inside a contest)
# ─────────────────────────────────────────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/dashboard")
@admins_only
def contest_dashboard(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/dashboard.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/pause-toggle", methods=["POST"])
@admins_only
def contest_pause_toggle(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    if contest.state == "paused":
        contest.state = "visible"
    elif contest.state == "visible":
        contest.state = "paused"
    db.session.commit()
    return redirect(url_for("admin.contest_dashboard", contest_id=contest_id))


@admin.route("/admin/contests/<int:contest_id>/settings")
@admins_only
def contest_settings(contest_id):
    from CTFd.models import Brackets, Teams
    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    brackets = (
        Brackets.query
        .filter_by(contest_id=contest_id, type="teams")
        .order_by(Brackets.id.asc())
        .all()
    )
    bracket_ids = [b.id for b in brackets]
    team_counts = {}
    if bracket_ids:
        rows = (
            db.session.query(Teams.bracket_id, db.func.count(Teams.id))
            .filter(Teams.bracket_id.in_(bracket_ids))
            .group_by(Teams.bracket_id)
            .all()
        )
        team_counts = {bid: cnt for bid, cnt in rows}
    brackets_data = [
        {
            "id": b.id,
            "name": b.name,
            "description": b.description or "",
            "type": "teams",
            "member_count": team_counts.get(b.id, 0),
        }
        for b in brackets
    ]

    return render_template(
        "admin/contests/contest.html",
        contest=contest,
        brackets=brackets_data,
        is_detail=True,
    )

@admin.route("/admin/contests/<int:contest_id>/submissions")
@admins_only
def contest_submissions(contest_id):
    return _contest_submissions_view(contest_id, submission_type=None)


@admin.route("/admin/contests/<int:contest_id>/submissions/correct")
@admins_only
def contest_submissions_correct(contest_id):
    return _contest_submissions_view(contest_id, submission_type="correct")


@admin.route("/admin/contests/<int:contest_id>/submissions/incorrect")
@admins_only
def contest_submissions_incorrect(contest_id):
    return _contest_submissions_view(contest_id, submission_type="incorrect")


def _contest_submissions_view(contest_id, submission_type):
    from CTFd.models import Submissions, Challenges, Teams, Users
    from CTFd.utils.modes import get_model

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Get challenge ids for this contest
    challenge_ids = [r[0] for r in db.session.query(Challenges.id)
                     .filter(Challenges.contest_id == contest_id).all()]

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "provided")
    team_filter = request.args.get("team_id", "").strip()
    user_filter = request.args.get("user_id", "").strip()
    challenge_filter = request.args.get("challenge_id", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    timezone_offset = request.args.get("timezone_offset", "").strip()
    page = abs(request.args.get("page", 1, type=int))

    filters = []
    if challenge_ids:
        filters.append(Submissions.challenge_id.in_(challenge_ids))
    else:
        filters.append(Submissions.id == -1)

    if submission_type == "correct":
        filters.append(Submissions.type == "correct")
    elif submission_type == "incorrect":
        filters.append(Submissions.type == "incorrect")

    if team_filter:
        try:
            filters.append(Submissions.team_id == int(team_filter))
        except ValueError:
            pass
    if user_filter:
        try:
            filters.append(Submissions.user_id == int(user_filter))
        except ValueError:
            pass
    if challenge_filter:
        try:
            cid = int(challenge_filter)
            if cid in challenge_ids:
                filters.append(Submissions.challenge_id == cid)
            else:
                filters.append(Submissions.id == -1)
        except ValueError:
            pass
    if q and Submissions.__mapper__.has_property(field):
        filters.append(getattr(Submissions, field).ilike(f"%{q}%"))

    import datetime as dt
    if date_from:
        try:
            df = dt.datetime.strptime(date_from, "%Y-%m-%d")
            filters.append(Submissions.date >= df)
        except ValueError:
            pass
    if date_to:
        try:
            dt2 = dt.datetime.strptime(date_to, "%Y-%m-%d") + dt.timedelta(days=1)
            filters.append(Submissions.date < dt2)
        except ValueError:
            pass

    submissions = (
        Submissions.query.filter(*filters)
        .order_by(Submissions.date.desc())
        .paginate(page=page, per_page=50, error_out=False)
    )

    # Dropdowns — only teams/users/challenges in this contest
    all_teams = []
    all_users = []
    all_challenges = []
    if challenge_ids:
        team_ids = [r[0] for r in db.session.query(Submissions.team_id.distinct())
                    .filter(Submissions.challenge_id.in_(challenge_ids),
                            Submissions.team_id.isnot(None)).all()]
        user_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                    .filter(Submissions.challenge_id.in_(challenge_ids),
                            Submissions.user_id.isnot(None)).all()]
        if team_ids:
            all_teams = Teams.query.filter(Teams.id.in_(team_ids)).order_by(Teams.name).all()
        if user_ids:
            all_users = Users.query.filter(Users.id.in_(user_ids)).order_by(Users.name).all()
        all_challenges = (
            Challenges.query
            .filter(Challenges.contest_id == contest_id)
            .order_by(Challenges.name).all()
        )

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/submissions.html",
        contest=contest,
        submissions=submissions,
        submission_type=submission_type,
        prev_page=url_for(request.endpoint, contest_id=contest_id, page=submissions.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id, page=submissions.next_num, **args),
        q=q,
        field=field,
        all_teams=all_teams,
        all_users=all_users,
        all_challenges=all_challenges,
        team_filter=team_filter,
        user_filter=user_filter,
        challenge_filter=challenge_filter,
        date_from=date_from,
        date_to=date_to,
        timezone_offset=timezone_offset,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/brackets")
@admins_only
def contest_brackets(contest_id):
    from CTFd.models import Brackets, Teams
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    brackets = (
        Brackets.query
        .filter_by(contest_id=contest_id, type="teams")
        .order_by(Brackets.id.asc())
        .all()
    )

    # Count teams per bracket
    bracket_ids = [b.id for b in brackets]
    team_counts = {}
    if bracket_ids:
        rows = (
            db.session.query(Teams.bracket_id, db.func.count(Teams.id))
            .filter(Teams.bracket_id.in_(bracket_ids))
            .group_by(Teams.bracket_id)
            .all()
        )
        team_counts = {bid: cnt for bid, cnt in rows}

    brackets_data = [
        {
            "id": b.id,
            "name": b.name,
            "description": b.description or "",
            "type": "teams",
            "member_count": team_counts.get(b.id, 0),
        }
        for b in brackets
    ]

    return render_template(
        "admin/contests/brackets.html",
        contest=contest,
        brackets=brackets_data,
        is_detail=True,
    )


@admin.route("/admin/contests/<int:contest_id>/scoreboard")
@admins_only
def contest_scoreboard(contest_id):
    from sqlalchemy.sql.expression import union_all
    from CTFd.models import AwardBadges, Achievements, Awards, Brackets, Challenges, Solves, Teams, Users
    from CTFd.utils.config import is_teams_mode

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    bracket_id = request.args.get("bracket_id", type=int)
    brackets = Brackets.query.filter_by(contest_id=contest_id).all()

    # Team standings: Solves → Challenges (challenge_id), filter by contest_id
    # Challenges.value holds the point value for this challenge in this contest
    team_scores = (
        db.session.query(
            Solves.team_id.label("account_id"),
            db.func.sum(Challenges.value).label("score"),
            db.func.max(Solves.id).label("id"),
            db.func.max(Solves.date).label("date"),
        )
        .join(Challenges, Solves.challenge_id == Challenges.id)
        .filter(Challenges.contest_id == contest_id)
        .filter(Challenges.value != 0)
        .filter(Solves.team_id != None)
        .group_by(Solves.team_id)
    )
    team_awards = (
        db.session.query(
            Awards.team_id.label("account_id"),
            db.func.sum(Awards.value).label("score"),
            db.func.max(Awards.id).label("id"),
            db.func.max(Awards.date).label("date"),
        )
        .filter(Awards.contest_id == contest_id)
        .filter(Awards.value != 0)
        .filter(Awards.team_id != None)
        .group_by(Awards.team_id)
    )
    sumscores = union_all(team_scores, team_awards).alias("sumscores")

    standings_query = (
        db.session.query(
            Teams.id.label("account_id"),
            Teams.oauth_id.label("oauth_id"),
            Teams.name.label("name"),
            Teams.hidden.label("hidden"),
            db.func.sum(sumscores.columns.score).label("score"),
        )
        .join(sumscores, Teams.id == sumscores.columns.account_id)
        .filter(Teams.banned == False)
        .group_by(Teams.id)
        .order_by(
            db.func.sum(sumscores.columns.score).desc(),
            db.func.max(sumscores.columns.date).asc(),
            db.func.max(sumscores.columns.id).asc(),
        )
    )
    if bracket_id is not None:
        standings_query = standings_query.filter(Teams.bracket_id == bracket_id)
    standings = standings_query.all()

    # User standings (teams mode only)
    user_standings = None
    if is_teams_mode():
        u_scores = (
            db.session.query(
                Solves.user_id.label("user_id"),
                db.func.sum(Challenges.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .filter(Challenges.contest_id == contest_id)
            .filter(Challenges.value != 0)
            .filter(Solves.user_id != None)
            .group_by(Solves.user_id)
        )
        u_awards = (
            db.session.query(
                Awards.user_id.label("user_id"),
                db.func.sum(Awards.value).label("score"),
                db.func.max(Awards.id).label("id"),
                db.func.max(Awards.date).label("date"),
            )
            .filter(Awards.contest_id == contest_id)
            .filter(Awards.value != 0)
            .filter(Awards.user_id != None)
            .group_by(Awards.user_id)
        )
        u_sumscores = union_all(u_scores, u_awards).alias("u_sumscores")
        user_standings_query = (
            db.session.query(
                Users.id.label("user_id"),
                Users.oauth_id.label("oauth_id"),
                Users.name.label("name"),
                Users.hidden.label("hidden"),
                db.func.sum(u_sumscores.columns.score).label("score"),
            )
            .join(u_sumscores, Users.id == u_sumscores.columns.user_id)
            .filter(Users.banned == False, Users.hidden == False)
            .group_by(Users.id)
            .order_by(
                db.func.sum(u_sumscores.columns.score).desc(),
                db.func.max(u_sumscores.columns.date).asc(),
                db.func.max(u_sumscores.columns.id).asc(),
            )
        )
        if bracket_id is not None:
            user_standings_query = user_standings_query.filter(Users.bracket_id == bracket_id)
        user_standings = user_standings_query.all()

    # First bloods: Achievements → AwardBadges → Challenges, filtered to this contest's challenges
    contest_challenge_ids = [
        r[0] for r in db.session.query(Challenges.id)
        .filter(Challenges.contest_id == contest_id).all()
    ]
    first_bloods_data = []
    if contest_challenge_ids:
        fb_rows = (
            db.session.query(
                Challenges.name.label("challenge"),
                Teams.name.label("team_name"),
            )
            .select_from(Achievements)
            .join(AwardBadges, Achievements.award_badge_id == AwardBadges.id)
            .join(Challenges, AwardBadges.challenge_id == Challenges.id)
            .join(Teams, Achievements.team_id == Teams.id)
            .filter(AwardBadges.name == "First Blood")
            .filter(AwardBadges.challenge_id.in_(contest_challenge_ids))
            .all()
        )
        first_bloods_data = [
            {"challenge": row.challenge, "team_name": row.team_name, "user_name": "—"}
            for row in fb_rows
        ]

    return render_template(
        "admin/contests/sections/scoreboard.html",
        contest=contest,
        is_detail=True,
        standings=standings,
        user_standings=user_standings,
        brackets=brackets,
        selected_bracket_id=bracket_id,
        first_bloods=first_bloods_data,
        challenge_masters=[],
        top_submission=[],
        top_solves=[],
        top_solves_with_topics={},
    )


@admin.route("/admin/contests/<int:contest_id>/scoreboard/export")
@admins_only
def contest_scoreboard_export(contest_id):
    try:
        import pandas as pd
    except ImportError:
        return {"success": False, "error": "pandas library not installed"}, 500

    try:
        import traceback
        from sqlalchemy.sql.expression import union_all
        from CTFd.models import Awards, Brackets, Challenges, Solves, Teams, Users

        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        bracket_id = request.args.get("bracket_id", type=int)

        bracket_map = {b.id: b.name for b in Brackets.query.filter_by(contest_id=contest_id).all()}

        # ── Sheet 1: Teams Standings ──────────────────────────────────────────
        team_scores = (
            db.session.query(
                Solves.team_id.label("account_id"),
                db.func.sum(Challenges.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .filter(Challenges.contest_id == contest_id, Challenges.value != 0)
            .filter(Solves.team_id != None)
            .group_by(Solves.team_id)
        )
        team_awards = (
            db.session.query(
                Awards.team_id.label("account_id"),
                db.func.sum(Awards.value).label("score"),
                db.func.max(Awards.id).label("id"),
                db.func.max(Awards.date).label("date"),
            )
            .filter(Awards.contest_id == contest_id, Awards.value != 0)
            .filter(Awards.team_id != None)
            .group_by(Awards.team_id)
        )
        sumscores = union_all(team_scores, team_awards).alias("sumscores")
        team_q = (
            db.session.query(
                Teams.id.label("account_id"),
                Teams.oauth_id.label("oauth_id"),
                Teams.name.label("name"),
                Teams.bracket_id.label("bracket_id"),
                Teams.hidden.label("hidden"),
                Teams.banned.label("banned"),
                db.func.sum(sumscores.columns.score).label("score"),
                db.func.max(sumscores.columns.date).label("last_date"),
                db.func.max(sumscores.columns.id).label("last_id"),
            )
            .join(sumscores, Teams.id == sumscores.columns.account_id)
            .group_by(
                Teams.id, Teams.oauth_id, Teams.name,
                Teams.bracket_id, Teams.hidden, Teams.banned,
            )
            .order_by(
                db.func.sum(sumscores.columns.score).desc(),
                db.func.max(sumscores.columns.date).asc(),
                db.func.max(sumscores.columns.id).asc(),
            )
        )
        if bracket_id is not None:
            team_q = team_q.filter(Teams.bracket_id == bracket_id)

        standings_data = [
            {
                "Rank": i + 1,
                "account_id": r.account_id,
                "oauth_id": r.oauth_id,
                "name": r.name,
                "bracket_id": r.bracket_id,
                "bracket_name": bracket_map.get(r.bracket_id, ""),
                "hidden": r.hidden,
                "banned": r.banned,
                "score": r.score or 0,
            }
            for i, r in enumerate(team_q.all())
        ]

        # ── Sheet 2: Submit Standings (solve log) ─────────────────────────────
        submit_q = (
            db.session.query(
                Solves.team_id.label("team_id"),
                Teams.name.label("team_name"),
                Challenges.id.label("challenge_id"),
                Challenges.name.label("challenge_name"),
                Solves.date.label("submission_time"),
                Teams.country.label("country"),
            )
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .join(Teams, Solves.team_id == Teams.id)
            .filter(Challenges.contest_id == contest_id)
            .filter(Teams.hidden == False, Teams.banned == False)
            .order_by(Solves.date.asc())
        )
        if bracket_id is not None:
            submit_q = submit_q.filter(Teams.bracket_id == bracket_id)

        submit_data = [
            {
                "team_id": r.team_id,
                "team_name": r.team_name,
                "challenge_id": r.challenge_id,
                "challenge_name": r.challenge_name,
                "submission_time": r.submission_time.strftime("%Y-%m-%d %H:%M:%S") if r.submission_time else "",
                "country": r.country,
            }
            for r in submit_q.all()
        ]

        # ── Sheet 3: Users Standings ──────────────────────────────────────────
        u_scores = (
            db.session.query(
                Solves.user_id.label("user_id"),
                db.func.sum(Challenges.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .filter(Challenges.contest_id == contest_id, Challenges.value != 0)
            .filter(Solves.user_id != None)
            .group_by(Solves.user_id)
        )
        u_awards = (
            db.session.query(
                Awards.user_id.label("user_id"),
                db.func.sum(Awards.value).label("score"),
                db.func.max(Awards.id).label("id"),
                db.func.max(Awards.date).label("date"),
            )
            .filter(Awards.contest_id == contest_id, Awards.value != 0)
            .filter(Awards.user_id != None)
            .group_by(Awards.user_id)
        )
        u_sumscores = union_all(u_scores, u_awards).alias("u_sumscores")
        user_q = (
            db.session.query(
                Users.id.label("user_id"),
                Users.oauth_id.label("oauth_id"),
                Users.name.label("name"),
                Users.hidden.label("hidden"),
                Users.banned.label("banned"),
                db.func.sum(u_sumscores.columns.score).label("score"),
            )
            .join(u_sumscores, Users.id == u_sumscores.columns.user_id)
            .filter(Users.banned == False, Users.hidden == False)
            .group_by(Users.id, Users.oauth_id, Users.name, Users.hidden, Users.banned)
            .order_by(
                db.func.sum(u_sumscores.columns.score).desc(),
                db.func.max(u_sumscores.columns.date).asc(),
                db.func.max(u_sumscores.columns.id).asc(),
            )
        )
        if bracket_id is not None:
            user_q = user_q.filter(Users.bracket_id == bracket_id)

        user_data = [
            {
                "Rank": i + 1,
                "user_id": r.user_id,
                "oauth_id": r.oauth_id,
                "name": r.name,
                "hidden": r.hidden,
                "banned": r.banned,
                "score": r.score or 0,
            }
            for i, r in enumerate(user_q.all())
        ]

        # ── Sheet 4: Top Teams Solved Most Challenges ─────────────────────────
        top_q = (
            db.session.query(
                Teams.id.label("team_id"),
                Teams.name.label("team_name"),
                db.func.count(Solves.id).label("solved_challenges_count"),
                Teams.hidden.label("hidden"),
                Teams.banned.label("banned"),
            )
            .join(Solves, Solves.team_id == Teams.id)
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .filter(Challenges.contest_id == contest_id)
            .group_by(Teams.id, Teams.name, Teams.hidden, Teams.banned)
            .order_by(db.func.count(Solves.id).desc())
        )

        top_data = [
            {
                "team_id": r.team_id,
                "team_name": r.team_name,
                "solved_challenges_count": r.solved_challenges_count,
                "hidden": r.hidden,
                "banned": r.banned,
            }
            for r in top_q.all()
        ]

        # ── Build Excel ───────────────────────────────────────────────────────
        output = BytesIO()
        with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
            pd.DataFrame(standings_data).to_excel(writer, sheet_name="Standings", index=False)
            pd.DataFrame(submit_data).to_excel(writer, sheet_name="Submit Standings", index=False)
            pd.DataFrame(user_data).to_excel(writer, sheet_name="Users Standings", index=False)
            pd.DataFrame(top_data).to_excel(writer, sheet_name="Top Teams Solved Most Chal", index=False)
        output.seek(0)

        safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in contest.name).strip()
        return send_file(
            output,
            as_attachment=True,
            download_name=f"scoreboard_{safe_name}.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}, 500


@admin.route("/admin/contests/<int:contest_id>/challenges")
@admins_only
def contest_challenges(contest_id):
    from CTFd.models import Challenges, Tags

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    category = request.args.get("category", "")
    type_ = request.args.get("type", "")
    difficulty = request.args.get("difficulty", "")
    state_filter = request.args.get("state", "")
    tags_q = request.args.get("tags", "")
    tag_terms = [t.strip() for t in tags_q.split(",") if t.strip()] if tags_q else []
    page = abs(request.args.get("page", 1, type=int))

    query = Challenges.query.filter(Challenges.contest_id == contest_id)

    if tag_terms:
        for term in tag_terms:
            exists_filter = (
                db.session.query(Tags.id)
                .filter(
                    Tags.challenge_id == Challenges.id,
                    db.func.lower(Tags.value) == term.lower(),
                )
                .exists()
            )
            query = query.filter(exists_filter)

    if q:
        if field == "id":
            try:
                query = query.filter(Challenges.id == int(q))
            except ValueError:
                pass
        elif field in {"name", "category"} and hasattr(Challenges, field):
            query = query.filter(getattr(Challenges, field).ilike(f"%{q}%"))

    if category:
        query = query.filter(Challenges.category == category)
    if type_:
        query = query.filter(Challenges.type == type_)
    if difficulty:
        try:
            query = query.filter(Challenges.difficulty == int(difficulty))
        except ValueError:
            pass
    if state_filter:
        query = query.filter(Challenges.state == state_filter)

    contest_challenges_paged = query.order_by(Challenges.id.asc()).paginate(
        page=page, per_page=50, error_out=False
    )

    for ch in contest_challenges_paged.items:
        creator_id = getattr(ch, "created_by", None)
        user = Users.query.filter_by(id=creator_id).first() if creator_id else None
        ch.creator = user.name if user else "Unknown"

    raw_categories = (
        Challenges.query.with_entities(Challenges.category)
        .filter(Challenges.contest_id == contest_id)
        .filter(Challenges.category.isnot(None))
        .distinct().all()
    )
    raw_types = (
        Challenges.query.with_entities(Challenges.type)
        .filter(Challenges.contest_id == contest_id)
        .filter(Challenges.type.isnot(None))
        .distinct().all()
    )

    categories = [c[0] for c in raw_categories if c and c[0]]
    types = [t[0] for t in raw_types if t and t[0]]

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/challenges.html",
        contest=contest,
        contest_challenges=contest_challenges_paged,
        prev_page=url_for(request.endpoint, contest_id=contest_id,
                          page=contest_challenges_paged.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id,
                          page=contest_challenges_paged.next_num, **args),
        q=q,
        field=field,
        category=category,
        type=type_,
        difficulty=difficulty,
        state_filter=state_filter,
        tag_terms=tag_terms,
        categories=categories,
        types=types,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/challenges/import_challenges")
@admins_only
def contest_import_challenges(contest_id):
    from CTFd.models import Challenges

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    categories = [
        r[0]
        for r in Challenges.query.with_entities(Challenges.category)
        .filter(Challenges.category.isnot(None))
        .distinct()
        .order_by(Challenges.category.asc())
        .all()
        if r[0]
    ]
    types = [
        r[0]
        for r in Challenges.query.with_entities(Challenges.type)
        .filter(Challenges.type.isnot(None))
        .distinct()
        .order_by(Challenges.type.asc())
        .all()
        if r[0]
    ]

    return render_template(
        "admin/contests/sections/import_challenges.html",
        contest=contest,
        categories=categories,
        types=types,
        is_detail=True,
    )


@admin.route("/admin/contests/<int:contest_id>/challenges/new")
@admins_only
def contest_challenges_new(contest_id):
    from itsdangerous import URLSafeTimedSerializer
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    s = URLSafeTimedSerializer(current_app.secret_key)
    contest_token = s.dumps({"contest_id": contest_id}, salt="create-challenge")
    types = CHALLENGE_CLASSES.keys()
    return render_template(
        "admin/contests/challenges_new.html",
        contest=contest,
        types=types,
        contest_token=contest_token,
        is_detail=True,
    )


@admin.route("/admin/contests/<int:contest_id>/challenges/<int:challenge_id>")
@admins_only
def contest_challenge_detail(contest_id, challenge_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    challenge = Challenges.query.filter_by(id=challenge_id, contest_id=contest_id).first_or_404()

    deploys = DeployedChallenge.query.filter_by(challenge_id=challenge.id).order_by(DeployedChallenge.id.desc()).all()
    _last_status = (deploys[0].deploy_status or "").upper() if deploys else ""
    _chal_status = (challenge.deploy_status or "").lower()
    isDeploySuccess = bool(
        _last_status in ("DEPLOY_SUCCESS", "SUCCEEDED", "SUCCESS") or
        _chal_status in ("success", "deploy_success", "succeeded")
    )

    expose_port = ""
    image_link_name = ""
    image_link_display = ""
    if challenge.image_link:
        obj = json.loads(challenge.image_link)
        expose_port = obj.get("exposedPort", "")
        image_link_name = obj.get("imageLink", "")
        image_link_display = image_link_name

    try:
        challenge_class = get_chal_class(challenge.type)
    except KeyError:
        abort(500, f"Challenge type ({challenge.type}) is not installed.")

    ctf_is_active = ctftime()
    update_j2 = render_template(
        challenge_class.templates["update"].lstrip("/"),
        challenge=challenge,
        ctf_is_active=ctf_is_active,
    )
    update_script = url_for("views.static_html", route=challenge_class.scripts["update"].lstrip("/"))

    solves = Solves.query.filter_by(challenge_id=challenge.id).order_by(Solves.date.asc()).all()
    flags = Flags.query.filter_by(challenge_id=challenge.id).all()
    all_challenges = db.session.query(Challenges.id, Challenges.name, Challenges.description).all()

    versions = (
        ChallengeVersion.query
        .filter_by(challenge_id=challenge.id)
        .order_by(ChallengeVersion.version_number.desc())
        .all()
    )

    return render_template(
        "admin/contests/challenge_detail.html",
        contest=contest,
        challenge=challenge,
        update_template=update_j2,
        update_script=update_script,
        expose_port=expose_port,
        image_link_name=image_link_name,
        image_link_display=image_link_display,
        challenges=all_challenges,
        solves=solves,
        flags=flags,
        deploys=len(deploys),
        isDeploySuccess=isDeploySuccess,
        is_detail=True,
        ctf_is_active=ctf_is_active,
        versions=versions,
    )


@admin.route("/admin/contests/<int:contest_id>/participants")
@admins_only
def contest_participants(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/participants.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/users/<int:user_id>", methods=["GET"])
@admins_only
def contest_user_detail(contest_id, user_id):
    """View a user's detail page within the contest context (uses contest sidebar)."""
    from sqlalchemy import not_
    from CTFd.models import Challenges, Solves, Fails, Awards, Teams, UserTeamMember, Tracking
    from CTFd.utils.config import get_config
    from CTFd.utils.modes import TEAMS_MODE

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    user = Users.query.filter_by(id=user_id).first_or_404()

    # Team in THIS contest only
    user_team = (
        Teams.query
        .join(UserTeamMember, UserTeamMember.team_id == Teams.id)
        .filter(UserTeamMember.user_id == user_id, Teams.contest_id == contest_id)
        .first()
    )
    user.team = user_team
    user.team_id = user_team.id if user_team else None

    # Contest-level role
    cp = ContestParticipant.query.filter_by(contest_id=contest_id, user_id=user_id).first()
    contest_role = cp.role if cp else "contestant"

    # Solves scoped to this contest's challenges
    solves = (
        Solves.query
        .join(Challenges, Challenges.id == Solves.challenge_id)
        .filter(Solves.user_id == user_id, Challenges.contest_id == contest_id)
        .order_by(Solves.date.desc())
        .all()
    )

    # Fails scoped to this contest's challenges
    fails = (
        Fails.query
        .join(Challenges, Challenges.id == Fails.challenge_id)
        .filter(Fails.user_id == user_id, Challenges.contest_id == contest_id)
        .order_by(Fails.date.desc())
        .all()
    )

    # Awards scoped to this contest
    awards = (
        Awards.query
        .filter_by(user_id=user_id, contest_id=contest_id)
        .order_by(Awards.date.desc())
        .all()
    )

    # Missing challenges in this contest that user hasn't solved
    solve_ids = [s.challenge_id for s in solves]
    missing_q = Challenges.query.filter(Challenges.contest_id == contest_id)
    if solve_ids:
        missing_q = missing_q.filter(not_(Challenges.id.in_(solve_ids)))
    missing = missing_q.all()

    addrs = Tracking.query.filter_by(user_id=user_id).order_by(Tracking.date.desc()).all()

    score = sum(s.challenge.value for s in solves if s.challenge) if solves else 0
    place = None  # Per-contest place calculation is complex; skip for now

    return render_template(
        "admin/contests/sections/user_detail.html",
        solves=solves,
        user=user,
        addrs=addrs,
        score=score,
        missing=missing,
        place=place,
        fails=fails,
        awards=awards,
        contest_role=contest_role,
        is_detail=True,
        contest=contest,
    )


@admin.route("/admin/contests/<int:contest_id>/users/<int:user_id>", methods=["DELETE"])
@admins_only
def contest_remove_user(contest_id, user_id):
    """
    Remove a user from a contest by deleting their UserTeamMember entries
    for teams in this contest and their ContestParticipant record.
    If a team becomes empty, delete it too.
    Does NOT delete the global user account.
    """
    from CTFd.models import Teams, UserTeamMember

    Contests.query.filter_by(id=contest_id).first_or_404()
    Users.query.filter_by(id=user_id).first_or_404()

    memberships = (
        db.session.query(UserTeamMember)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(
            Teams.contest_id == contest_id,
            UserTeamMember.user_id == user_id,
        )
        .all()
    )

    cp = ContestParticipant.query.filter_by(
        contest_id=contest_id, user_id=user_id
    ).first()

    if not memberships and not cp:
        return {"success": False, "errors": {"user": ["User is not in this contest."]}}, 404

    for membership in memberships:
        team_id = membership.team_id
        db.session.delete(membership)
        db.session.flush()

        remaining = UserTeamMember.query.filter_by(team_id=team_id).count()
        if remaining == 0:
            team = Teams.query.get(team_id)
            if team:
                db.session.delete(team)

    if cp:
        db.session.delete(cp)

    db.session.commit()
    return {"success": True, "data": {"user_id": user_id}}, 200


@admin.route("/admin/contests/<int:contest_id>/users/<int:user_id>/role", methods=["PATCH"])
@admins_only
def contest_update_user_role(contest_id, user_id):
    """Upsert a user's contest-level role in contest_participants."""
    Contests.query.filter_by(id=contest_id).first_or_404()
    Users.query.filter_by(id=user_id).first_or_404()

    data = request.get_json(force=True) or {}
    role = (data.get("role") or "").strip()

    if role not in ("contestant", "jury", "challenge_writer"):
        return {
            "success": False,
            "errors": {"role": ["Role must be one of: contestant, jury, challenge_writer"]},
        }, 400

    cp = ContestParticipant.query.filter_by(
        contest_id=contest_id, user_id=user_id
    ).first()
    if cp is None:
        cp = ContestParticipant(contest_id=contest_id, user_id=user_id, role=role)
        db.session.add(cp)
    else:
        cp.role = role

    db.session.commit()
    return {"success": True, "data": {"user_id": user_id, "role": role}}, 200


@admin.route("/admin/contests/<int:contest_id>/add_existing_user", methods=["POST"])
@admins_only
def contest_add_existing_user(contest_id):
    """
    Add an existing user from the system into a contest.

    user_mode == "users": auto-creates a solo team for the user (1 user = 1 team).
    user_mode == "teams": creates a ContestParticipant; optionally assigns to an
                          existing team (team=<name>, create_team=false) or creates
                          a new team (team=<name>, create_team=true).
    """
    from CTFd.models import Teams, UserTeamMember, Users
    from CTFd.utils.crypto import hash_password
    from sqlalchemy import or_

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    req = request.get_json(force=True) or {}

    username_or_email = (req.get("username") or "").strip()
    team_name         = (req.get("team") or "").strip()
    create_team       = bool(req.get("create_team", False))
    role              = (req.get("role") or "contestant").strip()
    if role not in ("contestant", "jury", "challenge_writer"):
        role = "contestant"

    if not username_or_email:
        return {"success": False, "errors": {"username": ["Username or email is required."]}}, 400

    # 1. Find the existing user
    user = Users.query.filter(
        or_(
            Users.name == username_or_email,
            Users.email == username_or_email
        )
    ).first()

    if user is None:
        return {"success": False, "errors": {"username": ["User not found in system."]}}, 404

    resolved_team_name = None

    if contest.user_mode == "users":
        # --- user mode ---
        # Only contestants get a solo team; jury/challenge_writer are added as participants only.

        # 2a. Check if user is already a participant in this contest
        existing_cp = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user.id
        ).first()
        if existing_cp:
            return {"success": False, "errors": {"username": ["User is already in this contest."]}}, 400

        if role == "contestant":
            # Auto-create a solo team named after the user
            resolved_team_name = user.name

            # 4a. Find or create the solo team
            team = Teams.query.filter_by(
                contest_id=contest_id,
                name=resolved_team_name,
            ).first()

            if team is None:
                team = Teams(
                    name=resolved_team_name,
                    email=user.email,
                    password=hash_password("changeme"),
                    contest_id=contest_id,
                    captain_user_id=user.id,
                )
                db.session.add(team)
                db.session.flush()

            team.members.append(user)

    else:
        # --- team mode: register participant, optionally assign to a team ---

        # 2b. Check if user is already a participant in this contest
        existing_cp = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=user.id
        ).first()
        if existing_cp:
            return {"success": False, "errors": {"username": ["User is already in this contest."]}}, 400

        # 3b. Optional team assignment
        if team_name:
            if create_team:
                if Teams.query.filter_by(contest_id=contest_id, name=team_name).first():
                    return {"success": False, "errors": {"team": ["A team with this name already exists in this contest."]}}, 400
                team = Teams(
                    name=team_name,
                    email=user.email,
                    password=hash_password("changeme"),
                    contest_id=contest_id,
                    captain_user_id=user.id,
                )
                db.session.add(team)
                db.session.flush()
            else:
                team = Teams.query.filter_by(contest_id=contest_id, name=team_name).first()
                if not team:
                    return {"success": False, "errors": {"team": ["Team not found in this contest."]}}, 404
                # Check if team already has this user (safety check)
                already = (
                    db.session.query(UserTeamMember)
                    .filter_by(user_id=user.id, team_id=team.id)
                    .first()
                )
                if already:
                    return {"success": False, "errors": {"team": ["User is already in this team."]}}, 400

                # Enforce team_size limit when joining an existing team
                if contest.team_size:
                    current_count = (
                        db.session.query(db.func.count(UserTeamMember.id))
                        .filter_by(team_id=team.id)
                        .scalar()
                    )
                    if current_count >= contest.team_size:
                        return (
                            {
                                "success": False,
                                "errors": {
                                    "team": [
                                        "Team '{}' is full. Teams are limited to {} member{}.".format(
                                            team_name,
                                            contest.team_size,
                                            "" if contest.team_size == 1 else "s",
                                        )
                                    ]
                                },
                            },
                            400,
                        )

            team.members.append(user)
            resolved_team_name = team_name

    # Upsert ContestParticipant record with the chosen contest role
    cp = ContestParticipant.query.filter_by(
        contest_id=contest_id, user_id=user.id
    ).first()
    if cp is None:
        cp = ContestParticipant(contest_id=contest_id, user_id=user.id, role=role)
        db.session.add(cp)
    else:
        cp.role = role

    db.session.commit()

    return {
        "success": True,
        "data": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "team": resolved_team_name,
            "role": role,
        }
    }, 200


@admin.route("/admin/contests/<int:contest_id>/create_user", methods=["POST"])
@admins_only
def contest_create_user(contest_id):
    """
    Create a brand-new platform user and immediately add them to this contest.

    Inserts:
      1. users          — new platform account
      2. contest_participants — contest membership with chosen role
      3. user_team_members / teams (optional) — only for contestants:
           user_mode:  auto-creates a solo team named after the user
           team_mode:  assigns to an existing team OR creates a new one
    """
    from CTFd.models import Teams, UserTeamMember, Users
    from CTFd.utils.crypto import hash_password
    from sqlalchemy import or_

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    req = request.get_json(force=True) or {}

    name     = (req.get("name") or "").strip()
    email    = (req.get("email") or "").strip()
    password = (req.get("password") or "").strip()
    role     = (req.get("role") or "contestant").strip()
    team_name   = (req.get("team") or "").strip()
    create_team = bool(req.get("create_team", False))

    if role not in ("contestant", "jury", "challenge_writer"):
        role = "contestant"

    # ── Validate required fields ──────────────────────────────────────────────
    errors = {}
    if not name:
        errors["name"] = ["Username is required."]
    if not email:
        errors["email"] = ["Email is required."]
    if not password:
        errors["password"] = ["Password is required."]
    if errors:
        return {"success": False, "errors": errors}, 400

    # ── Check uniqueness ──────────────────────────────────────────────────────
    if Users.query.filter_by(name=name).first():
        return {"success": False, "errors": {"name": ["Username already taken."]}}, 400
    if Users.query.filter_by(email=email).first():
        return {"success": False, "errors": {"email": ["Email already registered."]}}, 400

    # ── 1. Create the platform user ───────────────────────────────────────────
    user = Users(
        name=name,
        email=email,
        password=password,   # auto-hashed by @validates
        type="user",
        verified=True,       # admin-created accounts are pre-verified
    )
    db.session.add(user)
    db.session.flush()       # get user.id before further inserts

    resolved_team_name = None

    # ── 2. Contest-mode-specific team logic ───────────────────────────────────
    if contest.user_mode == "users":
        if role == "contestant":
            # Auto-create solo team named after the user
            resolved_team_name = user.name
            team = Teams.query.filter_by(
                contest_id=contest_id, name=resolved_team_name
            ).first()
            if team is None:
                team = Teams(
                    name=resolved_team_name,
                    email=user.email,
                    password=hash_password("changeme"),
                    contest_id=contest_id,
                    captain_user_id=user.id,
                )
                db.session.add(team)
                db.session.flush()
            team.members.append(user)
    else:
        # team mode — optional team assignment for contestants
        if team_name and role == "contestant":
            if create_team:
                if Teams.query.filter_by(contest_id=contest_id, name=team_name).first():
                    db.session.rollback()
                    return {"success": False, "errors": {"team": ["A team with this name already exists."]}}, 400
                team = Teams(
                    name=team_name,
                    email=user.email,
                    password=hash_password("changeme"),
                    contest_id=contest_id,
                    captain_user_id=user.id,
                )
                db.session.add(team)
                db.session.flush()
            else:
                team = Teams.query.filter_by(contest_id=contest_id, name=team_name).first()
                if not team:
                    db.session.rollback()
                    return {"success": False, "errors": {"team": ["Team not found in this contest."]}}, 404

                # Enforce team_size limit
                if contest.team_size:
                    current_count = (
                        db.session.query(db.func.count(UserTeamMember.id))
                        .filter_by(team_id=team.id)
                        .scalar()
                    )
                    if current_count >= contest.team_size:
                        db.session.rollback()
                        return (
                            {
                                "success": False,
                                "errors": {
                                    "team": [
                                        "Team '{}' is full. Teams are limited to {} member{}.".format(
                                            team_name,
                                            contest.team_size,
                                            "" if contest.team_size == 1 else "s",
                                        )
                                    ]
                                },
                            },
                            400,
                        )
            team.members.append(user)
            resolved_team_name = team_name

    # ── 3. Insert ContestParticipant ──────────────────────────────────────────
    cp = ContestParticipant(contest_id=contest_id, user_id=user.id, role=role)
    db.session.add(cp)

    db.session.commit()

    return {
        "success": True,
        "data": {
            "id":   user.id,
            "name": user.name,
            "email": user.email,
            "team": resolved_team_name,
            "role": role,
        }
    }, 201


@admin.route("/admin/contests/<int:contest_id>/teams_search", methods=["GET"])
@admins_only
def contest_teams_search(contest_id):
    from CTFd.models import Teams
    q = request.args.get("q", "").strip()
    if not q:
        return {"success": True, "data": []}
    
    teams = Teams.query.filter(
        Teams.contest_id == contest_id,
        Teams.name.ilike(f"%{q}%")
    ).limit(10).all()
    
    return {
        "success": True,
        "data": [{"id": t.id, "name": t.name} for t in teams]
    }


@admin.route("/admin/contests/<int:contest_id>/users_search", methods=["GET"])
@admins_only
def contest_users_search(contest_id):
    from CTFd.models import Teams, UserTeamMember, Users
    from sqlalchemy import or_, union

    q = request.args.get("q", "").strip()
    if not q:
        return {"success": True, "data": []}

    # A user is "in the contest" if they have a team membership OR a ContestParticipant
    # record. We use UNION so both modes (users / teams) are handled correctly.
    team_member_ids = (
        db.session.query(UserTeamMember.user_id)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(Teams.contest_id == contest_id)
    )
    cp_user_ids = (
        db.session.query(ContestParticipant.user_id)
        .filter(ContestParticipant.contest_id == contest_id)
    )
    users_in_contest = team_member_ids.union(cp_user_ids)

    users = (
        Users.query
        .filter(
            ~Users.id.in_(users_in_contest),
            or_(
                Users.name.ilike(f"%{q}%"),
                Users.email.ilike(f"%{q}%"),
            ),
        )
        .order_by(Users.name.asc())
        .limit(10)
        .all()
    )

    return {
        "success": True,
        "data": [
            {"id": user.id, "name": user.name, "email": user.email}
            for user in users
        ],
    }


@admin.route("/admin/contests/<int:contest_id>/users/new")
@admins_only
def contest_users_new(contest_id):
    from CTFd.models import Contests
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/contests/users_new.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/users/export/csv")
@admins_only
def contest_users_export_csv(contest_id):
    import csv, io, secrets, concurrent.futures
    from CTFd.models import Contests, Teams, Users, UserTeamMember
    from CTFd.models import ContestParticipant

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    include_passwords = request.args.get("include_passwords") == "1"

    team_users_subq = db.session.query(UserTeamMember.user_id)\
        .join(Teams, Teams.id == UserTeamMember.team_id)\
        .filter(Teams.contest_id == contest_id).subquery()
    cp_users_subq = db.session.query(ContestParticipant.user_id)\
        .filter(ContestParticipant.contest_id == contest_id).subquery()

    rows = (
        db.session.query(Users, Teams, ContestParticipant)
        .outerjoin(UserTeamMember, UserTeamMember.user_id == Users.id)
        .outerjoin(Teams, (Teams.id == UserTeamMember.team_id) & (Teams.contest_id == contest_id))
        .outerjoin(ContestParticipant, (ContestParticipant.user_id == Users.id) & (ContestParticipant.contest_id == contest_id))
        .filter(
            Users.type == "user",
            db.or_(Users.id.in_(team_users_subq), Users.id.in_(cp_users_subq))
        )
        .distinct(Users.id)
        .order_by(Users.id)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)

    if include_passwords:
        from passlib.hash import bcrypt_sha256
        writer.writerow(["name", "email", "team_name", "contest_role", "password_plain"])
        charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

        def hash_row(item):
            user, team, cp = item
            new_pass = "".join(secrets.choice(charset) for _ in range(12))
            hashed = bcrypt_sha256.using(rounds=4).hash(str(new_pass))
            if isinstance(hashed, bytes):
                hashed = hashed.decode("utf-8")
            return (user.id, hashed, user.name, user.email,
                    team.name if team else "", cp.role if cp else "contestant", new_pass)

        results = []
        with concurrent.futures.ThreadPoolExecutor() as executor:
            for res in executor.map(hash_row, rows):
                results.append(res)

        for user_id, hashed, name, email, team_name, role, new_pass in results:
            db.session.execute(
                db.text("UPDATE users SET password = :pw WHERE id = :uid"),
                {"pw": hashed, "uid": user_id}
            )
            writer.writerow([name, email, team_name, role, new_pass])
        db.session.commit()

        from CTFd.utils.logging.audit_logger import log_audit
        log_audit(action="bulk_password_reset", data={"contest_id": contest_id, "count": len(results)})
    else:
        writer.writerow(["name", "email", "team_name", "contest_role", "verified", "banned"])
        for user, team, cp in rows:
            writer.writerow([
                user.name, user.email,
                team.name if team else "",
                cp.role if cp else "contestant",
                str(user.verified).lower(),
                str(user.banned).lower(),
            ])

    output.seek(0)
    safe_slug = contest.slug.replace(" ", "_")[:40]
    fname = f"{safe_slug}-users{'-with-passwords' if include_passwords else ''}.csv"
    return send_file(
        io.BytesIO(output.getvalue().encode("utf-8")),
        as_attachment=True,
        max_age=-1,
        download_name=fname,
    )


@admin.route("/admin/contests/<int:contest_id>/users")
@admins_only
def contest_users(contest_id):
    from sqlalchemy import func, or_
    from CTFd.models import Submissions, Teams, Users, Contests, UserTeamMember

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Get challenge ids for this contest
    challenge_ids = [r[0] for r in db.session.query(Challenges.id)
                     .filter(Challenges.contest_id == contest_id).all()]

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    role_filter    = request.args.get("role", "")
    verified_filter = request.args.get("verified", "")
    hidden_filter  = request.args.get("hidden", "")
    banned_filter  = request.args.get("banned", "")
    page = abs(request.args.get("page", 1, type=int))

    filters = [Users.type == "user"]

    # Users "in" a contest: team member OR ContestParticipant (covers teams mode
    # where a user was added but not yet assigned to any team).
    team_users_subquery = db.session.query(UserTeamMember.user_id)\
        .join(Teams, Teams.id == UserTeamMember.team_id)\
        .filter(Teams.contest_id == contest_id).subquery()

    cp_users_subquery = db.session.query(ContestParticipant.user_id)\
        .filter(ContestParticipant.contest_id == contest_id).subquery()

    contest_or_submitted = [
        Users.id.in_(team_users_subquery),
        Users.id.in_(cp_users_subquery),
    ]

    if challenge_ids:
        participant_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                          .filter(Submissions.challenge_id.in_(challenge_ids),
                                  Submissions.user_id.isnot(None)).all()]
        if participant_ids:
            contest_or_submitted.append(Users.id.in_(participant_ids))

    filters.append(or_(*contest_or_submitted))

    if q and Users.__mapper__.has_property(field):
        filters.append(getattr(Users, field).ilike(f"%{q}%"))

    # Filter by contest role (from ContestParticipant), not platform type
    if role_filter and role_filter in ("contestant", "jury", "challenge_writer"):
        cp_role_subquery = db.session.query(ContestParticipant.user_id).filter(
            ContestParticipant.contest_id == contest_id,
            ContestParticipant.role == role_filter,
        ).subquery()
        filters.append(Users.id.in_(cp_role_subquery))

    if verified_filter == "true":
        filters.append(Users.verified == True)
    elif verified_filter == "false":
        filters.append(Users.verified == False)
    if hidden_filter == "true":
        filters.append(Users.hidden == True)
    elif hidden_filter == "false":
        filters.append(Users.hidden == False)
    if banned_filter == "true":
        filters.append(Users.banned == True)
    elif banned_filter == "false":
        filters.append(Users.banned == False)

    users = (Users.query.filter(*filters)
             .order_by(Users.id.asc())
             .paginate(page=page, per_page=50, error_out=False))

    user_ids = [u.id for u in users.items]
    teams_map = {}
    if user_ids:
        team_memberships = db.session.query(Teams, UserTeamMember.user_id)\
            .join(UserTeamMember, UserTeamMember.team_id == Teams.id)\
            .filter(Teams.contest_id == contest_id, UserTeamMember.user_id.in_(user_ids))\
            .all()
        for team, uid in team_memberships:
            teams_map[uid] = team

    # Build contest-role map from ContestParticipant records
    contest_roles_map = {}
    if user_ids:
        cp_records = ContestParticipant.query.filter(
            ContestParticipant.contest_id == contest_id,
            ContestParticipant.user_id.in_(user_ids),
        ).all()
        for cp in cp_records:
            contest_roles_map[cp.user_id] = cp.role

    for u in users.items:
        u.contest_team = teams_map.get(u.id)
        u.contest_role = contest_roles_map.get(u.id, "contestant")  # default: contestant

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/users.html",
        contest=contest,
        users=users,
        prev_page=url_for(request.endpoint, contest_id=contest_id, page=users.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id, page=users.next_num, **args),
        q=q,
        field=field,
        role_filter=role_filter,
        verified_filter=verified_filter,
        hidden_filter=hidden_filter,
        banned_filter=banned_filter,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/teams")
@admins_only
def contest_teams(contest_id):
    from sqlalchemy import func
    from CTFd.models import Submissions, Teams, Brackets, UserTeamMember

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Teams belonging to this contest directly
    filters = [Teams.contest_id == contest_id]

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    hidden = request.args.get("hidden") in ("1", "true", "on", "yes")
    banned = request.args.get("banned") in ("1", "true", "on", "yes")
    bracket_id = request.args.get("bracket_id", type=int)
    page = abs(request.args.get("page", 1, type=int))

    if q and Teams.__mapper__.has_property(field):
        filters.append(getattr(Teams, field).ilike(f"%{q}%"))

    if hidden:
        filters.append(Teams.hidden.is_(True))
    if banned:
        filters.append(Teams.banned.is_(True))
    if bracket_id:
        filters.append(Teams.bracket_id == bracket_id)

    brackets = Brackets.query.order_by(Brackets.id.asc()).all()

    teams = (
        Teams.query.options(joinedload(Teams.captain))
        .filter(*filters)
        .order_by(Teams.id.asc())
        .paginate(page=page, per_page=50, error_out=False)
    )

    member_counts = {
        team_id: count
        for team_id, count in db.session.query(
            UserTeamMember.team_id, func.count(UserTeamMember.user_id)
        ).group_by(UserTeamMember.team_id).all()
    }

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/teams.html",
        contest=contest,
        teams=teams,
        prev_page=url_for(request.endpoint, contest_id=contest_id, page=teams.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id, page=teams.next_num, **args),
        q=q,
        field=field,
        hidden=hidden,
        banned=banned,
        member_counts=member_counts,
        brackets=brackets,
        bracket_id=bracket_id,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/teams/new", methods=["GET"])
@admins_only
def contest_new_team_page(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/teams/new.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/teams/new", methods=["POST"])
@admins_only
def contest_create_team(contest_id):
    import logging
    from CTFd.models import KypoTeamAccount
    from CTFd.utils.crypto import hash_password
    from CTFd.utils.keycloak_service import create_kypo_user

    logger = logging.getLogger(__name__)

    Contests.query.filter_by(id=contest_id).first_or_404()
    req = request.get_json(force=True) or {}

    name = (req.get("name") or "").strip()
    password = (req.get("password") or "").strip()
    email = (req.get("email") or "").strip() or None
    hidden = bool(req.get("hidden", False))
    banned = bool(req.get("banned", False))

    if not name:
        return {"success": False, "errors": {"name": ["Name is required."]}}, 400
    if not password:
        return {"success": False, "errors": {"password": ["Password is required."]}}, 400

    if Teams.query.filter_by(contest_id=contest_id, name=name).first():
        return {"success": False, "errors": {"name": ["A team with this name already exists in this contest."]}}, 400

    team = Teams(
        name=name,
        email=email,
        password=hash_password(password),
        contest_id=contest_id,
        hidden=hidden,
        banned=banned,
    )
    db.session.add(team)
    db.session.commit()

    kypo_error = None
    try:
        kypo_creds = create_kypo_user(team.id, team.name, contest_id=contest_id)
        kypo_account = KypoTeamAccount(
            team_id=team.id,
            kypo_user_id=kypo_creds["kypo_user_id"],
            kypo_username=kypo_creds["kypo_username"],
            kypo_password=kypo_creds["kypo_password"],
        )
        db.session.add(kypo_account)
        db.session.commit()
        logger.info("Created KYPO account for team %s (id=%s)", team.name, team.id)
    except Exception as exc:
        kypo_error = str(exc)
        logger.error("Failed to create KYPO account for team %s: %s", team.id, exc, exc_info=True)

    result = {"success": True, "data": {"id": team.id, "name": team.name}}
    if kypo_error:
        result["kypo_warning"] = f"Team created but KYPO account creation failed: {kypo_error}"
    return result, 201


@admin.route("/admin/contests/<int:contest_id>/teams/<int:team_id>")
@admins_only
def contest_team_detail(contest_id, team_id):
    from sqlalchemy import not_
    from CTFd.models import Challenges, Tracking, Solves, Fails, Awards, UserTeamMember, KypoTeamAccount

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    team = Teams.query.filter_by(id=team_id).first_or_404()

    members = team.members
    member_ids = [member.id for member in members]

    # Scope all queries to challenges belonging to this contest
    challenge_ids_subq = db.session.query(Challenges.id).filter(
        Challenges.contest_id == contest_id
    ).subquery()

    solves = (
        Solves.query
        .filter(Solves.user_id.in_(member_ids), Solves.challenge_id.in_(challenge_ids_subq))
        .order_by(Solves.date.desc())
        .all()
    )
    fails = (
        Fails.query
        .filter(Fails.user_id.in_(member_ids), Fails.challenge_id.in_(challenge_ids_subq))
        .all()
    )
    awards = (
        Awards.query
        .filter(Awards.user_id.in_(member_ids), Awards.contest_id == contest_id)
        .all()
    ) if member_ids else []

    # Score = sum of UserTeamMember.score (updated on every correct solve)
    score = db.session.query(db.func.sum(UserTeamMember.score)).filter(
        UserTeamMember.team_id == team_id
    ).scalar() or 0

    # Per-member scores from UserTeamMember
    member_scores = {
        utm.user_id: utm.score
        for utm in UserTeamMember.query.filter_by(team_id=team_id).all()
    }

    # Place: rank this team among all teams in the same contest by score
    team_scores = db.session.query(
        UserTeamMember.team_id,
        db.func.sum(UserTeamMember.score).label("total")
    ).join(Teams, Teams.id == UserTeamMember.team_id).filter(
        Teams.contest_id == contest_id
    ).group_by(UserTeamMember.team_id).order_by(db.desc("total")).all()

    place = None
    for rank, (tid, _) in enumerate(team_scores, start=1):
        if tid == team_id:
            suffixes = {1: "st", 2: "nd", 3: "rd"}
            place = str(rank) + suffixes.get(rank if rank <= 3 else 0, "th")
            break

    solve_ids = [s.challenge_id for s in solves]
    missing_q = Challenges.query.filter(Challenges.contest_id == contest_id)
    if solve_ids:
        missing_q = missing_q.filter(not_(Challenges.id.in_(solve_ids)))
    missing = missing_q.all()

    addrs = (
        Tracking.query.filter(Tracking.user_id.in_(member_ids))
        .order_by(Tracking.date.desc())
        .all()
    )

    kypo_account = KypoTeamAccount.query.filter_by(team_id=team_id).first()

    return render_template(
        "admin/teams/team.html",
        contest=contest,
        team=team,
        members=members,
        score=score,
        place=place,
        solves=solves,
        fails=fails,
        missing=missing,
        awards=awards,
        addrs=addrs,
        member_scores=member_scores,
        kypo_account=kypo_account,
        is_detail=True,
    )


@admin.route("/admin/contests/<int:contest_id>/member_ids", methods=["GET"])
@admins_only
def contest_member_ids(contest_id):
    """Return a list of user IDs that are already members of any team in this contest."""
    from CTFd.models import Teams, UserTeamMember
    from flask import jsonify

    member_ids = (
        db.session.query(UserTeamMember.user_id)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(Teams.contest_id == contest_id)
        .all()
    )
    return jsonify({"success": True, "data": [row[0] for row in member_ids]})


@admin.route("/admin/contests/<int:contest_id>/teams/<int:team_id>/delete", methods=["POST"])
@admins_only
def contest_delete_team(contest_id, team_id):
    import logging
    from CTFd.models import KypoTeamAccount
    from CTFd.utils.keycloak_service import delete_kypo_user

    logger = logging.getLogger(__name__)
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    team = Teams.query.filter_by(id=team_id, contest_id=contest_id).first_or_404()

    kypo_account = KypoTeamAccount.query.filter_by(team_id=team.id).first()
    if kypo_account:
        try:
            delete_kypo_user(kypo_account.kypo_user_id)
        except Exception as exc:
            logger.error("Failed to delete Keycloak user for team %s: %s", team.id, exc)

    if contest.user_mode == "users":
        # In user mode each team represents exactly one user, so deleting the
        # team also removes those users from the contest entirely.
        member_ids = [m.id for m in team.members]
        db.session.delete(team)
        db.session.flush()
        if member_ids:
            ContestParticipant.query.filter(
                ContestParticipant.contest_id == contest_id,
                ContestParticipant.user_id.in_(member_ids),
            ).delete(synchronize_session=False)
    else:
        # In team mode, just disband the team; the members keep their
        # ContestParticipant records and can be assigned to another team later.
        db.session.delete(team)

    db.session.commit()
    return {"success": True}, 200


@admin.route("/admin/contests/<int:contest_id>/teams/<int:team_id>/add_member", methods=["POST"])
@admins_only
def contest_add_team_member(contest_id, team_id):
    """Add a user to a contest team directly (bypasses global team-mode restriction)."""
    from CTFd.models import Teams, UserTeamMember, Users
    from flask import jsonify

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    team = Teams.query.filter_by(id=team_id, contest_id=contest_id).first_or_404()

    data = request.get_json(force=True) or {}
    user_id = data.get("user_id")
    if not user_id:
        return {"success": False, "errors": {"user_id": ["user_id is required"]}}, 400

    user = Users.query.filter_by(id=user_id).first_or_404()

    if not user.verified:
        return (
            {"success": False, "errors": {"user_id": ["User must be verified before adding to a team"]}},
            400,
        )

    cp = ContestParticipant.query.filter_by(contest_id=contest_id, user_id=user_id).first()
    if cp is None:
        return (
            {"success": False, "errors": {"user_id": ["User must be added to the contest before being added to a team"]}},
            400,
        )

    existing = (
        db.session.query(UserTeamMember)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(
            UserTeamMember.user_id == user_id,
            Teams.contest_id == contest_id,
        )
        .first()
    )
    if existing:
        return (
            {"success": False, "errors": {"user_id": ["User is already in a team in this contest"]}},
            400,
        )

    # Enforce team_size limit from contest settings
    if contest.team_size:
        current_count = (
            db.session.query(db.func.count(UserTeamMember.id))
            .filter_by(team_id=team.id)
            .scalar()
        )
        if current_count >= contest.team_size:
            return (
                {
                    "success": False,
                    "errors": {
                        "user_id": [
                            "This team is full. Teams are limited to {} member{}.".format(
                                contest.team_size,
                                "" if contest.team_size == 1 else "s",
                            )
                        ]
                    },
                },
                400,
            )

    team.members.append(user)

    db.session.commit()
    return {"success": True, "data": {"user_id": user_id}}, 200


@admin.route("/admin/contests/<int:contest_id>/available_members_search", methods=["GET"])
@admins_only
def contest_available_members_search(contest_id):
    """Search contest participants not yet assigned to any team in this contest."""
    from CTFd.models import Teams, UserTeamMember, Users
    from sqlalchemy import or_
    from flask import jsonify

    Contests.query.filter_by(id=contest_id).first_or_404()
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"success": True, "data": []})

    # Subquery: user IDs already assigned to any team in this contest
    users_in_team = (
        db.session.query(UserTeamMember.user_id)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(Teams.contest_id == contest_id)
    )

    # Only search among users who are already contest participants (ContestParticipant),
    # excluding those already in a team.
    contest_participant_ids = (
        db.session.query(ContestParticipant.user_id)
        .filter(ContestParticipant.contest_id == contest_id)
    )

    users = (
        db.session.query(Users)
        .filter(
            Users.type == "user",
            Users.id.in_(contest_participant_ids),
            ~Users.id.in_(users_in_team),
            or_(
                Users.name.ilike(f"%{q}%"),
                Users.email.ilike(f"%{q}%"),
            ),
        )
        .order_by(Users.name.asc())
        .limit(10)
        .all()
    )

    return jsonify({
        "success": True,
        "data": [
            {"id": u.id, "name": u.name, "email": u.email, "verified": u.verified}
            for u in users
        ],
    })


@admin.route("/admin/contests/<int:contest_id>/action_logs")
@admins_only
def contest_action_logs(contest_id):
    from CTFd.models import ActionLogs, Users

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 50, type=int)
    per_page = max(1, min(per_page, 200))

    # Filter params
    q_search   = request.args.get("q", "").strip()
    field      = request.args.get("field", "detail")
    user_filter = request.args.get("user_id", "").strip()
    type_filter = request.args.get("type", "").strip()
    date_from   = request.args.get("date_from", "").strip()
    date_to     = request.args.get("date_to", "").strip()

    import datetime as dt
    filters = [ActionLogs.contest_id == contest_id]

    if user_filter:
        try:
            filters.append(ActionLogs.user_id == int(user_filter))
        except ValueError:
            pass

    if type_filter:
        try:
            filters.append(ActionLogs.type == int(type_filter))
        except ValueError:
            pass

    if q_search and hasattr(ActionLogs, field):
        filters.append(getattr(ActionLogs, field).ilike(f"%{q_search}%"))

    if date_from:
        try:
            filters.append(ActionLogs.date >= dt.datetime.strptime(date_from, "%Y-%m-%d"))
        except ValueError:
            pass
    if date_to:
        try:
            filters.append(ActionLogs.date < dt.datetime.strptime(date_to, "%Y-%m-%d") + dt.timedelta(days=1))
        except ValueError:
            pass

    logs = (
        ActionLogs.query.filter(*filters)
        .order_by(ActionLogs.date.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )

    # Distinct users in this contest's logs for filter dropdown
    user_ids_in_logs = [
        r[0] for r in db.session.query(ActionLogs.user_id.distinct())
        .filter(ActionLogs.contest_id == contest_id, ActionLogs.user_id.isnot(None)).all()
    ]
    users_in_contest = (
        Users.query.filter(Users.id.in_(user_ids_in_logs)).order_by(Users.name).all()
        if user_ids_in_logs else []
    )

    # Distinct action types
    action_types = [
        r[0] for r in db.session.query(ActionLogs.type.distinct())
        .filter(ActionLogs.contest_id == contest_id).all()
    ]

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/action_logs.html",
        contest=contest,
        logs=logs,
        prev_page=url_for(request.endpoint, contest_id=contest_id, page=logs.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id, page=logs.next_num, **args),
        per_page=per_page,
        q=q_search,
        field=field,
        user_filter=user_filter,
        type_filter=type_filter,
        date_from=date_from,
        date_to=date_to,
        users_in_contest=users_in_contest,
        action_types=action_types,
        is_detail=is_detail,
    )

@admin.route("/admin/contests/<int:contest_id>/action_logs/export/csv")
@admins_only
def contest_action_logs_export_csv(contest_id):
    import json
    from CTFd.models import ActionLogs

    q = ActionLogs.query.filter(
        ActionLogs.contest_id == contest_id
    ).order_by(ActionLogs.date.desc())

    def generate():
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(["id", "timestamp", "user_id", "type", "detail", "topic_name", "contest_id"])
        yield sio.getvalue(); sio.seek(0); sio.truncate(0)
        for log in q.yield_per(1000):
            writer.writerow([
                log.id,
                log.date.isoformat() if log.date else "",
                log.user_id or "",
                log.type,
                log.detail or "",
                log.topic_name or "",
                log.contest_id or "",
            ])
            yield sio.getvalue(); sio.seek(0); sio.truncate(0)

    return Response(
        stream_with_context(generate()),
        headers={
            "Content-Disposition": f'attachment; filename="contest_{contest_id}_action_logs.csv"',
            "Content-Type": "text/csv; charset=utf-8",
        }
    )


@admin.route("/admin/contests/<int:contest_id>/tickets")
@admins_only
def contest_tickets(contest_id):
    from CTFd.SendTicket import get_all_tickets

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 50, type=int), 1), 100)
    status = request.args.get("status", type=str)
    type_ = request.args.get("type", type=str)
    search = request.args.get("search", type=str)

    try:
        response, status_code = get_all_tickets(
            status=status, type_=type_, search=search,
            page=page, per_page=per_page,
            contest_id=contest_id,
        )
        if not isinstance(response, dict):
            response = {}
        tickets = response.get("tickets", []) if status_code == 200 else []
        total = response.get("total", 0) if status_code == 200 else 0
    except Exception:
        tickets, total = [], 0

    is_detail = True
    return render_template(
        "admin/contests/sections/tickets.html",
        contest=contest,
        tickets=tickets or [],
        total=total or 0,
        page=page,
        per_page=per_page,
        status_options=["Open", "Closed"],
        type_options=["Question", "Error"],
        selected_status=status,
        selected_type=type_,
        search=search,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/tickets/delete", methods=["POST"])
@admins_only
def contest_delete_tickets(contest_id):
    from CTFd.models import Tickets
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    ticket_ids = request.form.getlist("ticket_ids[]")

    if not ticket_ids:
        flash("No tickets selected for deletion", "warning")
        return redirect(url_for("admin.contest_tickets", contest_id=contest_id))

    deleted_count = 0
    for tid in ticket_ids:
        ticket = Tickets.query.filter_by(id=int(tid), contest_id=contest_id).first()
        if ticket:
            db.session.delete(ticket)
            deleted_count += 1

    db.session.commit()

    if deleted_count > 0:
        flash(f"Successfully deleted {deleted_count} ticket(s)", "success")
    else:
        flash("No tickets were deleted", "warning")

    return redirect(url_for("admin.contest_tickets", contest_id=contest_id))


@admin.route("/admin/contests/<int:contest_id>/tickets/<int:ticket_id>", methods=["GET"])
@admins_only
def contest_ticket_detail(contest_id, ticket_id):
    from CTFd.SendTicket import get_ticket_by_id
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    current_user_id = None
    try:
        from CTFd.utils.user import get_current_user
        u = get_current_user()
        if u:
            current_user_id = u.id
    except Exception:
        pass

    response, status_code = get_ticket_by_id(ticket_id=ticket_id)
    ticket_data = response.get("ticket") if status_code == 200 else None

    return render_template(
        "admin/contests/sections/ticket_detail.html",
        contest=contest,
        is_detail=True,
        ticket_data=ticket_data,
        userId=current_user_id,
    )


@admin.route("/admin/contests/<int:contest_id>/tickets/respond", methods=["POST"])
@admins_only
def contest_send_ticket_response(contest_id):
    from CTFd.SendTicket import send_ticket_from_relier
    from CTFd.utils.user import get_current_user
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    current_user = get_current_user()
    if not current_user:
        flash("You must be logged in to reply to tickets", "danger")
        return redirect(url_for("admin.contest_tickets", contest_id=contest_id))

    ticket_id = request.form.get("ticket_id")
    response_content = request.form.get("response")

    if not ticket_id or not response_content:
        flash("All fields are required", "danger")
        return redirect(url_for("admin.contest_ticket_detail", contest_id=contest_id, ticket_id=ticket_id))

    data = {
        "ticket_id": ticket_id,
        "replier_id": current_user.id,
        "replier_message": response_content,
    }

    _, status_code = send_ticket_from_relier(ticket_id, data)

    if status_code == 200:
        flash("Message sent successfully", "success")
    else:
        flash("Failed to submit the response. Please try again", "danger")

    return redirect(url_for("admin.contest_tickets", contest_id=contest_id))


@admin.route("/admin/contests/<int:contest_id>/instances")
@admins_only
def contest_instances(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 50, type=int)
    per_page = max(1, min(per_page, 200))

    team_filter = (request.args.get("team") or "").strip()
    challenge_filter = (request.args.get("challenge") or "").strip()
    start_filter = (request.args.get("start") or "").strip()
    end_filter = (request.args.get("end") or "").strip()
    quick_filter = (request.args.get("quick") or "").strip()
    timezone_offset = (request.args.get("timezone_offset") or "").strip()

    start_date = _ci_parse_datetime(start_filter)
    end_date = _ci_parse_datetime(end_filter)
    quick_range = _ci_parse_quick_range(quick_filter)
    if quick_range:
        end_date = datetime.datetime.utcnow()
        start_date = end_date - quick_range
    else:
        if start_date:
            start_date = _ci_local_to_utc(start_date, timezone_offset)
        if end_date:
            end_date = _ci_local_to_utc(end_date, timezone_offset)

    query = _ci_base_query(contest_id)
    query = _ci_apply_filters(query, team_filter, challenge_filter, start_date, end_date)

    logs = query.paginate(page=page, per_page=per_page, error_out=False)

    args = dict(request.args)
    args.pop("page", None)
    is_detail = True

    return render_template(
        "admin/contests/sections/instances.html",
        contest=contest,
        is_detail=is_detail,
        logs=logs,
        prev_page=url_for(request.endpoint, contest_id=contest_id, page=logs.prev_num, **args),
        next_page=url_for(request.endpoint, contest_id=contest_id, page=logs.next_num, **args),
        team_filter=team_filter,
        challenge_filter=challenge_filter,
        start_filter=start_filter,
        end_filter=end_filter,
        quick_filter=quick_filter,
        timezone_offset=timezone_offset,
        per_page=per_page,
    )


@admin.route("/admin/contests/<int:contest_id>/instances/export/csv")
@admins_only
def contest_instances_export_csv(contest_id):
    Contests.query.filter_by(id=contest_id).first_or_404()

    team_filter = (request.args.get("team") or "").strip()
    challenge_filter = (request.args.get("challenge") or "").strip()
    start_filter = (request.args.get("start") or "").strip()
    end_filter = (request.args.get("end") or "").strip()
    quick_filter = (request.args.get("quick") or "").strip()
    timezone_offset = (request.args.get("timezone_offset") or "").strip()

    start_date = _ci_parse_datetime(start_filter)
    end_date = _ci_parse_datetime(end_filter)
    quick_range = _ci_parse_quick_range(quick_filter)
    if quick_range:
        end_date = datetime.datetime.utcnow()
        start_date = end_date - quick_range
    else:
        if start_date:
            start_date = _ci_local_to_utc(start_date, timezone_offset)
        if end_date:
            end_date = _ci_local_to_utc(end_date, timezone_offset)

    query = _ci_base_query(contest_id)
    query = _ci_apply_filters(query, team_filter, challenge_filter, start_date, end_date)

    def generate():
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(["id", "started_at", "stopped_at", "label", "challenge_id", "challenge_name", "team_id", "team_name"])
        yield sio.getvalue()
        sio.seek(0)
        sio.truncate(0)

        for row in query.yield_per(1000):
            tracking = row.ChallengeStartTracking
            writer.writerow([
                tracking.id,
                tracking.started_at.isoformat() if tracking.started_at else "",
                tracking.stopped_at.isoformat() if tracking.stopped_at else "",
                tracking.label or "",
                row.challenge_id,
                row.challenge_name or "",
                row.team_id or "",
                row.team_name or "",
            ])
            yield sio.getvalue()
            sio.seek(0)
            sio.truncate(0)

    headers = {
        "Content-Disposition": f'attachment; filename="instances_{contest_id}.csv"',
        "Content-Type": "text/csv; charset=utf-8",
    }
    return Response(stream_with_context(generate()), headers=headers)


@admin.route("/admin/contests/<int:contest_id>/bracket")
@admins_only
def contest_bracket(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/bracket.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/monitoring")
@admins_only
def contest_monitoring(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template(
        "admin/contests/sections/monitoring.html",
        contest=contest,
        is_detail=True,
    )



@admin.route("/admin/contests/<int:contest_id>/dynamic_reward")
@admins_only
def contest_dynamic_reward(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/dynamic_reward.html",
        contest=contest,
        is_detail=is_detail,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Contest access-password verify page
# ─────────────────────────────────────────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/verify-access", methods=["GET", "POST"])
@admins_only
def contest_verify_access(contest_id):
    """
    Hiển thị form nhập access_password của contest.
    Sau khi nhập đúng, lưu contest_id vào session và redirect về trang đích.
    """
    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Nếu contest không có password thì vào thẳng
    if not contest.access_password:
        return redirect(url_for("admin.contest_dashboard", contest_id=contest_id))

    # Nếu đã verify rồi (ví dụ user back lại) → vào thẳng
    verified_ids = session.get("verified_contest_ids", [])
    if contest_id in verified_ids:
        next_url = request.args.get("next") or url_for("admin.contest_dashboard", contest_id=contest_id)
        return redirect(next_url)

    error = None
    next_url = request.args.get("next") or url_for("admin.contest_dashboard", contest_id=contest_id)

    if request.method == "POST":
        entered = (request.form.get("access_password") or "").strip()
        if entered == contest.access_password:
            if contest_id not in verified_ids:
                verified_ids.append(contest_id)
                session["verified_contest_ids"] = verified_ids
                session.modified = True
            return redirect(next_url)
        else:
            error = "Mật khẩu không đúng. Vui lòng thử lại."

    return render_template(
        "admin/contests/verify_access.html",
        contest=contest,
        next_url=next_url,
        error=error,
    )
