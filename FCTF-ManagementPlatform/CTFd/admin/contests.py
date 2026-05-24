import csv
import datetime
import re
from io import BytesIO, StringIO

import json

from flask import Response, abort, current_app, flash, redirect, render_template, request, send_file, session, stream_with_context, url_for
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from CTFd.admin import admin
from CTFd.models import ChallengeStartTracking, ChallengeVersion, Challenges, Contests, DeployedChallenge, Flags, Solves, Teams, Users, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.utils.dates import ctftime
from CTFd.utils.decorators import admins_only


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
    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    state_filter = request.args.get("state", "")
    user_mode_filter = request.args.get("user_mode", "")
    sort_by = request.args.get("sort_by", "id")
    sort_dir = request.args.get("sort_dir", "asc")
    page = abs(request.args.get("page", 1, type=int))

    filters = []

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


@admin.route("/admin/contests/<int:contest_id>/settings")
@admins_only
def contest_settings(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/contest.html",
        contest=contest,
        is_detail=is_detail,
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


@admin.route("/admin/contests/<int:contest_id>/scoreboard")
@admins_only
def contest_scoreboard(contest_id):
    from sqlalchemy.sql.expression import union_all
    from CTFd.models import AwardBadges, Achievements, Awards, Brackets, Challenges, Solves, Teams, Users, UserTeamMember
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
        .filter(Teams.contest_id == contest_id)
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
            .join(UserTeamMember, Users.id == UserTeamMember.user_id)
            .join(Teams, UserTeamMember.team_id == Teams.id)
            .filter(Teams.contest_id == contest_id)
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
        from CTFd.models import Awards, Brackets, Challenges, Solves, Teams, Users, UserTeamMember

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
            .filter(Teams.contest_id == contest_id)
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
            .join(UserTeamMember, Users.id == UserTeamMember.user_id)
            .join(Teams, UserTeamMember.team_id == Teams.id)
            .filter(Teams.contest_id == contest_id)
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
            .filter(Challenges.contest_id == contest_id, Teams.contest_id == contest_id)
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


@admin.route("/admin/contests/<int:contest_id>/import_users", methods=["POST"])
@admins_only
def contest_import_users(contest_id):
    """
    Upsert users into a contest:
    - If a user with the given email does NOT exist → create user
    - If a user already exists → reuse
    - Assign user to team by team_name (CSV column):
        * If team_name provided → find or create that team in this contest
        * Otherwise → create solo team (team name = user name)
    """
    from CTFd.models import Teams, UserTeamMember
    from CTFd.utils.crypto import hash_password

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    req = request.get_json(force=True) or {}

    email     = (req.get("email") or "").strip()
    name      = (req.get("name") or "").strip()
    password  = (req.get("password") or "").strip()
    utype     = req.get("type", "user")
    verified  = req.get("verified", True)
    hidden    = req.get("hidden", False)
    team_name = (req.get("team") or "").strip()

    if not email or not name:
        return {"success": False, "errors": {"name": ["Name and email are required."]}}, 400

    # ── 1. Find or create the User ─────────────────────────────────────────
    user = Users.query.filter_by(email=email).first()
    if user is None:
        if not password:
            return {"success": False, "errors": {"password": ["Password is required for new users."]}}, 400
        user = Users(
            name=name,
            email=email,
            password=hash_password(password),
            type=utype,
            verified=verified,
            hidden=hidden,
        )
        db.session.add(user)
        db.session.flush()
        created = True
    else:
        created = False

    # ── 2. Determine target team name ──────────────────────────────────────
    resolved_team_name = team_name if team_name else user.name

    # ── 3. Check if user is already in a team with this name in the contest ─
    already_in_team = (
        db.session.query(UserTeamMember)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(
            Teams.contest_id == contest_id,
            UserTeamMember.user_id == user.id,
            Teams.name == resolved_team_name,
        )
        .first()
    )

    if already_in_team is None:
        # ── 4. Find or create the team in this contest ─────────────────────
        team = Teams.query.filter_by(
            contest_id=contest_id,
            name=resolved_team_name
        ).first()

        if team is None:
            team = Teams(
                name=resolved_team_name,
                email=user.email if not team_name else None,
                password=hash_password(password or "changeme"),
                contest_id=contest_id,
                captain_user_id=user.id,
            )
            db.session.add(team)
            db.session.flush()

        team.members.append(user)

    db.session.commit()

    return {
        "success": True,
        "data": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "team": resolved_team_name,
            "created": created,
        }
    }, 200


@admin.route("/admin/contests/<int:contest_id>/users/<int:user_id>", methods=["GET"])
@admins_only
def contest_user_detail(contest_id, user_id):
    """View a user's detail page within the contest context (uses contest sidebar)."""
    from sqlalchemy import not_
    from CTFd.models import Challenges, Teams, UserTeamMember, Tracking
    from CTFd.utils.config import get_config
    from CTFd.utils.modes import TEAMS_MODE

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    user = Users.query.filter_by(id=user_id).first_or_404()

    solves = user.get_solves(admin=True)

    user_team = None
    if get_config("user_mode") == TEAMS_MODE:
        user_team = (
            Teams.query
            .join(UserTeamMember, UserTeamMember.team_id == Teams.id)
            .filter(UserTeamMember.user_id == user_id)
            .first()
        )
        all_solves = user_team.get_solves(admin=True) if user_team else user.get_solves(admin=True)
    else:
        all_solves = user.get_solves(admin=True)

    user.team = user_team
    user.team_id = user_team.id if user_team else None

    solve_ids = [s.challenge_id for s in all_solves]
    missing = (
        Challenges.query.filter(not_(Challenges.id.in_(solve_ids))).all()
        if solve_ids else Challenges.query.all()
    )

    addrs = Tracking.query.filter_by(user_id=user_id).order_by(Tracking.date.desc()).all()
    fails = user.get_fails(admin=True)
    awards = user.get_awards(admin=True)

    if user.account:
        score = user.account.get_score(admin=True)
        place = user.account.get_place(admin=True)
    else:
        score = None
        place = None

    return render_template(
        "admin/users/user.html",
        solves=solves,
        user=user,
        addrs=addrs,
        score=score,
        missing=missing,
        place=place,
        fails=fails,
        awards=awards,
        is_detail=True,
        contest=contest,
    )


@admin.route("/admin/contests/<int:contest_id>/users/<int:user_id>", methods=["DELETE"])
@admins_only
def contest_remove_user(contest_id, user_id):
    """
    Remove a user from a contest by deleting their UserTeamMember entries
    for teams in this contest. If a team becomes empty, delete it too.
    Does NOT delete the global user account.
    """
    from CTFd.models import Teams, UserTeamMember

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    user = Users.query.filter_by(id=user_id).first_or_404()

    # Find all team memberships for this user in this contest
    memberships = (
        db.session.query(UserTeamMember)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(
            Teams.contest_id == contest_id,
            UserTeamMember.user_id == user_id,
        )
        .all()
    )

    if not memberships:
        return {"success": False, "errors": {"user": ["User is not in this contest."]}}, 404

    for membership in memberships:
        team_id = membership.team_id
        db.session.delete(membership)
        db.session.flush()

        # If team is now empty, delete it
        remaining = UserTeamMember.query.filter_by(team_id=team_id).count()
        if remaining == 0:
            team = Teams.query.get(team_id)
            if team:
                db.session.delete(team)

    db.session.commit()
    return {"success": True, "data": {"user_id": user_id}}, 200


@admin.route("/admin/contests/<int:contest_id>/add_existing_user", methods=["POST"])
@admins_only
def contest_add_existing_user(contest_id):
    """
    Add an existing user from the system into a contest:
    - User is found by username (name) or email
    - We check if they already have a team in this contest
    - We resolve the team name (either custom team or solo team)
    - Add user to the team in this contest
    """
    from CTFd.models import Teams, UserTeamMember, Users
    from CTFd.utils.crypto import hash_password
    from sqlalchemy import or_

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    req = request.get_json(force=True) or {}

    username_or_email = (req.get("username") or "").strip()
    team_name         = (req.get("team") or "").strip()

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

    # 2. Check if user is already in this contest
    existing_team = (
        db.session.query(Teams)
        .join(UserTeamMember, UserTeamMember.team_id == Teams.id)
        .filter(
            Teams.contest_id == contest_id,
            UserTeamMember.user_id == user.id,
        )
        .first()
    )

    if existing_team:
        return {"success": False, "errors": {"username": ["User is already in this contest."]}}, 400

    # 3. Determine target team name
    resolved_team_name = team_name if team_name else user.name

    # 4. Find or create the team in this contest
    team = Teams.query.filter_by(
        contest_id=contest_id,
        name=resolved_team_name
    ).first()

    if team is None:
        if team_name:
            # If the admin explicitly provided a team name, it MUST exist
            return {"success": False, "errors": {"team": ["Team does not exist in this contest."]}}, 400
        else:
            # Otherwise, create a solo team with the user's name
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
    db.session.commit()

    return {
        "success": True,
        "data": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "team": resolved_team_name,
        }
    }, 200


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


@admin.route("/admin/contests/<int:contest_id>/users/new")
@admins_only
def contest_users_new(contest_id):
    from CTFd.models import Contests
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/contests/users_new.html", contest=contest)


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
    # In team mode, users belong to a contest if they are members of a team in that contest
    team_users_subquery = db.session.query(UserTeamMember.user_id)\
        .join(Teams, Teams.id == UserTeamMember.team_id)\
        .filter(Teams.contest_id == contest_id).subquery()

    contest_or_submitted = [Users.id.in_(team_users_subquery)]

    if challenge_ids:
        participant_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                          .filter(Submissions.challenge_id.in_(challenge_ids),
                                  Submissions.user_id.isnot(None)).all()]
        if participant_ids:
            contest_or_submitted.append(Users.id.in_(participant_ids))

    filters.append(or_(*contest_or_submitted))

    if q and Users.__mapper__.has_property(field):
        filters.append(getattr(Users, field).ilike(f"%{q}%"))

    if role_filter:
        filters.append(Users.type == role_filter)
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

    for u in users.items:
        u.contest_team = teams_map.get(u.id)

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
    from CTFd.utils.crypto import hash_password

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

    return {"success": True, "data": {"id": team.id, "name": team.name}}, 201


@admin.route("/admin/contests/<int:contest_id>/teams/<int:team_id>")
@admins_only
def contest_team_detail(contest_id, team_id):
    from sqlalchemy import not_
    from CTFd.models import Challenges, Tracking

    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    team = Teams.query.filter_by(id=team_id).first_or_404()

    members = team.members
    member_ids = [member.id for member in members]

    solves = team.get_solves(admin=True)
    fails = team.get_fails(admin=True)
    awards = team.get_awards(admin=True)
    score = team.get_score(admin=True)
    place = team.get_place(admin=True)

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
        is_detail=True,
    )


@admin.route("/admin/contests/<int:contest_id>/teams/<int:team_id>/delete", methods=["POST"])
@admins_only
def contest_delete_team(contest_id, team_id):
    Contests.query.filter_by(id=contest_id).first_or_404()
    team = Teams.query.filter_by(id=team_id, contest_id=contest_id).first_or_404()
    db.session.delete(team)
    db.session.commit()
    return {"success": True}, 200


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
