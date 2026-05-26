from flask import render_template, request, url_for
from sqlalchemy.sql import not_
from sqlalchemy import or_

from CTFd.admin import admin
from CTFd.models import db, Challenges, Tracking, UserFields, Users, Teams, UserTeamMember, ContestParticipant
from CTFd.utils import get_config
from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.modes import TEAMS_MODE


def _format_custom_field_value(value):
    if value is None:
        return ""

    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value if item is not None)

    if isinstance(value, dict):
        return ", ".join(f"{key}: {item}" for key, item in value.items())

    return str(value)


def _build_registration_custom_field_data(user_items):
    custom_field_columns = []
    custom_field_value_map = {}

    for field in UserFields.query.order_by(UserFields.id.asc()).all():
        field_name = (field.name or "").strip()
        if field_name:
            custom_field_columns.append({"id": field.id, "name": field_name})

    if not custom_field_columns:
        return custom_field_columns, custom_field_value_map

    field_ids = {column["id"] for column in custom_field_columns}

    for user in user_items:
        user_field_values = {}

        for entry in user.get_fields(admin=True):
            formatted_value = _format_custom_field_value(entry.value).strip()
            field_id = entry.field_id

            if field_id not in field_ids or not formatted_value:
                continue

            # Keep all values if a field is accidentally submitted multiple times.
            if field_id in user_field_values:
                user_field_values[field_id] = (
                    f"{user_field_values[field_id]}, {formatted_value}"
                )
            else:
                user_field_values[field_id] = formatted_value

        custom_field_value_map[user.id] = user_field_values

    return custom_field_columns, custom_field_value_map


def _coerce_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


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

    # Attach team and team_id dynamically
    if get_config("user_mode") == TEAMS_MODE:
        user_ids = [u.id for u in users.items]
        teams_map = {}
        if user_ids:
            team_memberships = db.session.query(Teams, UserTeamMember.user_id)\
                .join(UserTeamMember, UserTeamMember.team_id == Teams.id)\
                .filter(UserTeamMember.user_id.in_(user_ids))\
                .all()
            for team, uid in team_memberships:
                teams_map[uid] = team
        for u in users.items:
            u.team = teams_map.get(u.id)
            u.team_id = u.team.id if u.team else None
    else:
        for u in users.items:
            u.team = None
            u.team_id = None

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
        pending_mode=False,
        registration_custom_field_columns=[],
        registration_custom_field_values={},
        listing_title="Users",
    )


@admin.route("/admin/users/pending")
@admin.route("/admin/users/registrations")
@admin_or_jury
def users_pending_listing():
    q = request.args.get("q")
    page = abs(request.args.get("page", 1, type=int))

    base_query = Users.query.filter(Users.type == "user", Users.verified == False)

    if q:
        search = "%{}%".format(q)
        base_query = base_query.filter(
            or_(
                Users.name.like(search),
                Users.email.like(search),
            )
        )

    users = (
        base_query
        .order_by(Users.id.asc())
        .paginate(page=page, per_page=50, error_out=False)
    )

    # Attach team and team_id dynamically
    if get_config("user_mode") == TEAMS_MODE:
        user_ids = [u.id for u in users.items]
        teams_map = {}
        if user_ids:
            team_memberships = db.session.query(Teams, UserTeamMember.user_id)\
                .join(UserTeamMember, UserTeamMember.team_id == Teams.id)\
                .filter(UserTeamMember.user_id.in_(user_ids))\
                .all()
            for team, uid in team_memberships:
                teams_map[uid] = team
        for u in users.items:
            u.team = teams_map.get(u.id)
            u.team_id = u.team.id if u.team else None
    else:
        for u in users.items:
            u.team = None
            u.team_id = None

    registration_custom_field_columns, registration_custom_field_values = (
        _build_registration_custom_field_data(users.items)
    )

    args = dict(request.args)
    args.pop("page", 1)

    return render_template(
        "admin/users/users.html",
        users=users,
        prev_page=url_for(request.endpoint, page=users.prev_num, **args),
        next_page=url_for(request.endpoint, page=users.next_num, **args),
        q=q,
        field="name",
        role_filter="",
        verified_filter="",
        hidden_filter="",
        banned_filter="",
        pending_mode=True,
        registration_custom_field_columns=registration_custom_field_columns,
        registration_custom_field_values=registration_custom_field_values,
        listing_title="Registrations",
    )


@admin.route("/admin/users/new")
@admins_only
def users_new():
    return render_template("admin/users/new.html")


@admin.route("/admin/users/import_users", methods=["POST"])
@admins_only
def users_import_users():
    """
    Upsert platform users from the management hub.

    CSV/import roles are intentionally limited to platform roles only:
    user or admin. Contest-level roles are managed from each contest.
    """
    req = request.get_json(force=True) or {}

    email = (req.get("email") or "").strip()
    name = (req.get("name") or "").strip()
    password = (req.get("password") or "").strip()
    role = (req.get("role") or "user").strip().lower()
    verified = _coerce_bool(req.get("verified"), True)
    hidden = _coerce_bool(req.get("hidden"), False)
    banned = _coerce_bool(req.get("banned"), False)

    if role not in ("user", "admin"):
        return {
            "success": False,
            "errors": {"role": ["Role must be either user or admin."]},
        }, 400

    if not name or not email:
        return {
            "success": False,
            "errors": {"name": ["Name and email are required."]},
        }, 400

    existing_by_email = Users.query.filter_by(email=email).first()
    existing_by_name = Users.query.filter_by(name=name).first()

    if existing_by_email is None and existing_by_name and existing_by_name.email != email:
        return {
            "success": False,
            "errors": {"name": ["User name has already been taken."]},
        }, 400

    if existing_by_email is None:
        if not password:
            return {
                "success": False,
                "errors": {"password": ["Password is required for new users."]},
            }, 400

        user = Users(
            name=name,
            email=email,
            password=password,
            type=role,
            verified=verified,
            hidden=hidden,
            banned=banned,
        )
        db.session.add(user)
        db.session.flush()
        created = True
    else:
        user = existing_by_email
        created = False

        if existing_by_name and existing_by_name.id != user.id:
            return {
                "success": False,
                "errors": {"name": ["User name has already been taken."]},
            }, 400

        user.name = name
        user.type = role
        user.verified = verified
        user.hidden = hidden
        user.banned = banned
        if password:
            user.password = password

    db.session.commit()

    return {
        "success": True,
        "data": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.type,
            "created": created,
        },
    }, 200


@admin.route("/admin/users/<int:user_id>")
@admin_or_jury
def users_detail(user_id):
    user = Users.query.filter_by(id=user_id).first_or_404()

    # IP addresses
    addrs = (
        Tracking.query.filter_by(user_id=user_id).order_by(Tracking.date.desc()).all()
    )

    # Contest participations — list of ContestParticipant with .contest relationship eager-loaded
    contest_participations = (
        ContestParticipant.query
        .filter_by(user_id=user_id)
        .join(ContestParticipant.contest)
        .order_by(ContestParticipant.joined_at.desc())
        .all()
    )

    return render_template(
        "admin/users/user.html",
        user=user,
        addrs=addrs,
        contest_participations=contest_participations,
    )
