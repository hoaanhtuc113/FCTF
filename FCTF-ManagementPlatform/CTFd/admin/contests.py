import csv
import datetime
import re
from io import BytesIO, StringIO

from flask import Response, flash, redirect, render_template, request, send_file, stream_with_context, url_for
from sqlalchemy import or_

from CTFd.admin import admin
from CTFd.models import ChallengeStartTracking, Challenges, ContestChallenge, Contests, Teams, Users, db
from CTFd.utils.decorators import admins_only


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
        .join(ContestChallenge, ChallengeStartTracking.contest_challenge_id == ContestChallenge.id)
        .join(Challenges, ContestChallenge.challenge_template_id == Challenges.id)
        .filter(ContestChallenge.contest_id == contest_id)
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
    from CTFd.models import ContestChallenge, Submissions, Challenges, Teams, Users
    from CTFd.utils.modes import get_model

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Get contest challenge ids
    cc_ids = [r[0] for r in db.session.query(ContestChallenge.id)
              .filter(ContestChallenge.contest_id == contest_id).all()]

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
    if cc_ids:
        filters.append(Submissions.contest_challenge_id.in_(cc_ids))
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
            cc_sub = [r[0] for r in db.session.query(ContestChallenge.id)
                      .filter(ContestChallenge.contest_id == contest_id,
                              ContestChallenge.challenge_template_id == cid).all()]
            if cc_sub:
                filters.append(Submissions.contest_challenge_id.in_(cc_sub))
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
    if cc_ids:
        team_ids = [r[0] for r in db.session.query(Submissions.team_id.distinct())
                    .filter(Submissions.contest_challenge_id.in_(cc_ids),
                            Submissions.team_id.isnot(None)).all()]
        user_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                    .filter(Submissions.contest_challenge_id.in_(cc_ids),
                            Submissions.user_id.isnot(None)).all()]
        if team_ids:
            all_teams = Teams.query.filter(Teams.id.in_(team_ids)).order_by(Teams.name).all()
        if user_ids:
            all_users = Users.query.filter(Users.id.in_(user_ids)).order_by(Users.name).all()
        all_challenges = (
            db.session.query(Challenges)
            .join(ContestChallenge, ContestChallenge.challenge_template_id == Challenges.id)
            .filter(ContestChallenge.contest_id == contest_id)
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
    from CTFd.models import AwardBadges, Achievements, Awards, Brackets, Challenges, ContestChallenge, Solves, Teams, Users, UserTeamMember
    from CTFd.utils.config import is_teams_mode

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    bracket_id = request.args.get("bracket_id", type=int)
    brackets = Brackets.query.filter_by(contest_id=contest_id).all()

    # Team standings: Solves → ContestChallenge (contest_challenge_id), filter by contest_id
    # ContestChallenge.value holds the point value for this challenge in this contest
    team_scores = (
        db.session.query(
            Solves.team_id.label("account_id"),
            db.func.sum(ContestChallenge.value).label("score"),
            db.func.max(Solves.id).label("id"),
            db.func.max(Solves.date).label("date"),
        )
        .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
        .filter(ContestChallenge.contest_id == contest_id)
        .filter(ContestChallenge.value != 0)
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
                db.func.sum(ContestChallenge.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id)
            .filter(ContestChallenge.value != 0)
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
    contest_challenge_tpl_ids = [
        r[0] for r in db.session.query(ContestChallenge.challenge_template_id)
        .filter(ContestChallenge.contest_id == contest_id).all()
    ]
    first_bloods_data = []
    if contest_challenge_tpl_ids:
        fb_rows = (
            db.session.query(
                Challenges.name.label("challenge"),
                Teams.name.label("team_name"),
            )
            .select_from(Achievements)
            .join(AwardBadges, Achievements.award_badge_id == AwardBadges.id)
            .join(Challenges, AwardBadges.challenge_template_id == Challenges.id)
            .join(Teams, Achievements.team_id == Teams.id)
            .filter(AwardBadges.name == "First Blood")
            .filter(AwardBadges.challenge_template_id.in_(contest_challenge_tpl_ids))
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
        from CTFd.models import Awards, Brackets, Challenges, ContestChallenge, Solves, Teams, Users, UserTeamMember

        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        bracket_id = request.args.get("bracket_id", type=int)

        # bracket lookup map (id → name) để tránh join phức tạp
        bracket_map = {b.id: b.name for b in Brackets.query.filter_by(contest_id=contest_id).all()}

        # ── Sheet 1: Teams Standings ──────────────────────────────────────────
        team_scores = (
            db.session.query(
                Solves.team_id.label("account_id"),
                db.func.sum(ContestChallenge.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id, ContestChallenge.value != 0)
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
            .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
            .join(Teams, Solves.team_id == Teams.id)
            .join(Challenges, ContestChallenge.challenge_template_id == Challenges.id)
            .filter(ContestChallenge.contest_id == contest_id)
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
                db.func.sum(ContestChallenge.value).label("score"),
                db.func.max(Solves.id).label("id"),
                db.func.max(Solves.date).label("date"),
            )
            .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id, ContestChallenge.value != 0)
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
            .join(ContestChallenge, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id, Teams.contest_id == contest_id)
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
    from CTFd.models import ContestChallenge, Challenges, Tags

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

    query = (
        ContestChallenge.query
        .filter(ContestChallenge.contest_id == contest_id)
        .join(Challenges, ContestChallenge.challenge_template_id == Challenges.id)
    )

    if tag_terms:
        for term in tag_terms:
            exists_filter = (
                db.session.query(Tags.id)
                .filter(
                    Tags.challenge_template_id == Challenges.id,
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
        query = query.filter(ContestChallenge.state == state_filter)

    contest_challenges_paged = query.order_by(ContestChallenge.id.asc()).paginate(
        page=page, per_page=50, error_out=False
    )

    for cc in contest_challenges_paged.items:
        tpl = cc.challenge_template
        creator_id = getattr(tpl, "user_id", None) or getattr(tpl, "created_by", None)
        user = Users.query.filter_by(id=creator_id).first() if creator_id else None
        tpl.creator = user.name if user else "Unknown"

    template_ids = [
        r[0] for r in db.session.query(ContestChallenge.challenge_template_id)
        .filter(ContestChallenge.contest_id == contest_id).all()
    ]
    if template_ids:
        raw_categories = (
            Challenges.query.with_entities(Challenges.category)
            .filter(Challenges.id.in_(template_ids)).distinct().all()
        )
        raw_types = (
            Challenges.query.with_entities(Challenges.type)
            .filter(Challenges.id.in_(template_ids)).distinct().all()
        )
    else:
        raw_categories, raw_types = [], []

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


@admin.route("/admin/contests/<int:contest_id>/users")
@admins_only
def contest_users(contest_id):
    from sqlalchemy import func
    from CTFd.models import ContestChallenge, Submissions, Teams

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    # Get user_ids who submitted in this contest
    cc_ids = [r[0] for r in db.session.query(ContestChallenge.id)
              .filter(ContestChallenge.contest_id == contest_id).all()]

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    role_filter    = request.args.get("role", "")
    verified_filter = request.args.get("verified", "")
    hidden_filter  = request.args.get("hidden", "")
    banned_filter  = request.args.get("banned", "")
    page = abs(request.args.get("page", 1, type=int))

    filters = [Users.type == "user"]
    if cc_ids:
        participant_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                          .filter(Submissions.contest_challenge_id.in_(cc_ids),
                                  Submissions.user_id.isnot(None)).all()]
        if participant_ids:
            filters.append(Users.id.in_(participant_ids))
        else:
            filters.append(Users.id == -1)  # no results

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
    from CTFd.models import ContestChallenge, Submissions, Teams, Brackets, UserTeamMember

    contest = Contests.query.filter_by(id=contest_id).first_or_404()

    cc_ids = [r[0] for r in db.session.query(ContestChallenge.id)
              .filter(ContestChallenge.contest_id == contest_id).all()]

    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    page = abs(request.args.get("page", 1, type=int))

    filters = []
    if cc_ids:
        team_ids = [r[0] for r in db.session.query(Submissions.team_id.distinct())
                    .filter(Submissions.contest_challenge_id.in_(cc_ids),
                            Submissions.team_id.isnot(None)).all()]
        if team_ids:
            filters.append(Teams.id.in_(team_ids))
        else:
            filters.append(Teams.id == -1)

    if q and Teams.__mapper__.has_property(field):
        filters.append(getattr(Teams, field).ilike(f"%{q}%"))

    teams = (Teams.query.filter(*filters)
             .order_by(Teams.id.asc())
             .paginate(page=page, per_page=50, error_out=False))

    member_counts = {
        team_id: count
        for team_id, count in db.session.query(
            UserTeamMember.team_id, func.count(UserTeamMember.user_id)
        ).group_by(UserTeamMember.team_id).all()
    }

    brackets = Brackets.query.order_by(Brackets.id.asc()).all()

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
        member_counts=member_counts,
        brackets=brackets,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/action_logs")
@admins_only
def contest_action_logs(contest_id):
    from CTFd.admin.admin_audit import (
        ALL_ACTIONS, TARGET_TYPES, ACTOR_ROLES, ACTION_LABELS,
        _build_query, _current_filters,
    )
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 50, type=int)
    per_page = max(1, min(per_page, 200))
    filters = _current_filters()
    q = _build_query(**filters)
    logs = q.paginate(page=page, per_page=per_page, error_out=False)
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
        all_actions=ALL_ACTIONS,
        target_types=TARGET_TYPES,
        actor_roles=ACTOR_ROLES,
        action_labels=ACTION_LABELS,
        is_detail=is_detail,
        **filters,
    )

@admin.route("/admin/contests/<int:contest_id>/action_logs/export/csv")
@admins_only
def contest_action_logs_export_csv(contest_id):
    import json
    from CTFd.admin.admin_audit import ACTION_LABELS, _build_query, _current_filters
    filters = _current_filters()
    q = _build_query(**filters)

    def generate():
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(["id","timestamp","actor_id","actor_name","actor_type","action","action_label","target_type","target_id","ip_address"])
        yield sio.getvalue(); sio.seek(0); sio.truncate(0)
        for log in q.yield_per(1000):
            writer.writerow([log.id, log.timestamp.isoformat() if log.timestamp else "",
                log.actor_id or "", log.actor_name or "", log.actor_type or "",
                log.action, ACTION_LABELS.get(log.action, log.action),
                log.target_type or "", log.target_id or "", log.ip_address or ""])
            yield sio.getvalue(); sio.seek(0); sio.truncate(0)

    return Response(stream_with_context(generate()),
        headers={"Content-Disposition": 'attachment; filename="contest_action_logs.csv"',
                 "Content-Type": "text/csv; charset=utf-8"})


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
