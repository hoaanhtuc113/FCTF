from flask import render_template, request, url_for
from sqlalchemy import func
from sqlalchemy.orm import joinedload
from sqlalchemy.sql import not_

from CTFd.admin import admin
from CTFd.models import Challenges, Teams, Tracking, Users, db
from CTFd.utils.decorators import admin_or_jury, admins_only


@admin.route("/admin/teams")
@admin_or_jury
def teams_listing():
    q = request.args.get("q")
    field = request.args.get("field")
    hidden = request.args.get("hidden") in ("1", "true", "on", "yes")
    banned = request.args.get("banned") in ("1", "true", "on", "yes")
    page = abs(request.args.get("page", 1, type=int))
    filters = []

    if q:
        # The field exists as an exposed column
        if Teams.__mapper__.has_property(field):
            filters.append(getattr(Teams, field).like("%{}%".format(q)))

    if hidden:
        filters.append(Teams.hidden.is_(True))
    if banned:
        filters.append(Teams.banned.is_(True))

    teams = (
        Teams.query.options(joinedload(Teams.captain))
        .filter(*filters)
        .order_by(Teams.id.asc())
        .paginate(page=page, per_page=10, error_out=False)
    )

    member_counts = {
        team_id: count
        for team_id, count in db.session.query(Users.team_id, func.count(Users.id))
        .filter(Users.team_id.isnot(None))
        .group_by(Users.team_id)
        .all()
    }

    args = dict(request.args)
    args.pop("page", 1)

    return render_template(
        "admin/teams/teams.html",
        teams=teams,
        prev_page=url_for(request.endpoint, page=teams.prev_num, **args),
        next_page=url_for(request.endpoint, page=teams.next_num, **args),
        q=q,
        field=field,
        hidden=hidden,
        banned=banned,
        member_counts=member_counts,
    )


@admin.route("/admin/teams/new")
@admins_only
def teams_new():
    return render_template("admin/teams/new.html")


@admin.route("/admin/teams/<int:team_id>")
@admin_or_jury
def teams_detail(team_id):
    team = Teams.query.filter_by(id=team_id).first_or_404()

    # Get members
    members = team.members
    member_ids = [member.id for member in members]

    # Get Solves for all members
    solves = team.get_solves(admin=True)
    fails = team.get_fails(admin=True)
    awards = team.get_awards(admin=True)
    score = team.get_score(admin=True)
    place = team.get_place(admin=True)

    # Get missing Challenges for all members
    # TODO: How do you mark a missing challenge for a team?
    solve_ids = [s.challenge_id for s in solves]
    missing = Challenges.query.filter(not_(Challenges.id.in_(solve_ids))).all()

    # Get addresses for all members
    addrs = (
        Tracking.query.filter(Tracking.user_id.in_(member_ids))
        .order_by(Tracking.date.desc())
        .all()
    )

    is_detail = True

    return render_template(
        "admin/teams/team.html",
        team=team,
        members=members,
        score=score,
        place=place,
        solves=solves,
        fails=fails,
        missing=missing,
        awards=awards,
        addrs=addrs,
        is_detail=is_detail,
    )
