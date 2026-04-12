from flask import render_template, request, url_for
from sqlalchemy.sql import not_

from CTFd.admin import admin
from CTFd.models import Challenges, Teams, Tracking, Users
from CTFd.utils import get_config
from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.modes import TEAMS_MODE


@admin.route("/admin/users")
@admin_or_jury
def users_listing():
    q = request.args.get("q")
    field = request.args.get("field")
    page = abs(request.args.get("page", 1, type=int))

    # Filter params
    role_filter = request.args.get("role", "")
    verified_filter = request.args.get("verified", "")
    hidden_filter = request.args.get("hidden", "")
    banned_filter = request.args.get("banned", "")

    filters = []

    if q:
        # The field exists as an exposed column
        if Users.__mapper__.has_property(field):
            filters.append(getattr(Users, field).like("%{}%".format(q)))

    # Apply dropdown filters
    if role_filter == "admin":
        filters.append(Users.type == "admin")
    elif role_filter == "user":
        filters.append(Users.type == "user")
    elif role_filter == "challenge_writer":
        filters.append(Users.type == "challenge_writer")
    elif role_filter == "jury":
        filters.append(Users.type == "jury")

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

    if q and field == "ip":
        users = (
            Users.query.join(Tracking, Users.id == Tracking.user_id)
            .filter(Tracking.ip.like("%{}%".format(q)))
            .filter(*filters[1:] if filters else [])
            .order_by(Users.id.asc())
            .paginate(page=page, per_page=50, error_out=False)
        )
    else:
        users = (
            Users.query.filter(*filters)
            .order_by(Users.id.asc())
            .paginate(page=page, per_page=50, error_out=False)
        )

    args = dict(request.args)
    args.pop("page", 1)

    return render_template(
        "admin/users/users.html",
        users=users,
        prev_page=url_for(request.endpoint, page=users.prev_num, **args),
        next_page=url_for(request.endpoint, page=users.next_num, **args),
        q=q,
        field=field,
        role_filter=role_filter,
        verified_filter=verified_filter,
        hidden_filter=hidden_filter,
        banned_filter=banned_filter,
    )


@admin.route("/admin/users/new")
@admins_only
def users_new():
    return render_template("admin/users/new.html")


@admin.route("/admin/users/<int:user_id>")
@admin_or_jury
def users_detail(user_id):
    user = Users.query.filter_by(id=user_id).first_or_404()

    solves = user.get_solves(admin=True)

    # Get challenges that the user is missing
    if get_config("user_mode") == TEAMS_MODE:
        if user.team:
            all_solves = user.team.get_solves(admin=True)
        else:
            all_solves = user.get_solves(admin=True)
    else:
        all_solves = user.get_solves(admin=True)

    solve_ids = [s.challenge_id for s in all_solves]
    missing = Challenges.query.filter(not_(Challenges.id.in_(solve_ids))).all()

    # Get IP addresses that the User has used
    addrs = (
        Tracking.query.filter_by(user_id=user_id).order_by(Tracking.date.desc()).all()
    )

    # Get Fails
    fails = user.get_fails(admin=True)

    # Get Awards
    awards = user.get_awards(admin=True)

    # Check if the user has an account (team or user)
    # so that we don't throw an error if they dont
    if user.account:
        score = user.account.get_score(admin=True)
        place = user.account.get_place(admin=True)
    else:
        score = None
        place = None

    is_detail = True 

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
        is_detail=is_detail,
    )
