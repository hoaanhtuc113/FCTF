import datetime

from flask import flash, redirect, render_template, request, url_for
from sqlalchemy import or_

from CTFd.admin import admin
from CTFd.models import Contests, Users, db
from CTFd.utils.decorators import admins_only


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
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    owner = Users.query.filter_by(id=contest.owner_id).first() if contest.owner_id else None
    is_detail = True
    return render_template(
        "admin/contests/contest.html",
        contest=contest,
        owner=owner,
        is_detail=is_detail,
    )


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

@admin.route("/admin/contests/<int:contest_id>/submissions")
@admins_only
def contest_submissions(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/submissions.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/scoreboard")
@admins_only
def contest_scoreboard(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/scoreboard.html",
        contest=contest,
        is_detail=is_detail,
    )


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
        team = Teams(
            name=resolved_team_name,
            email=user.email if not team_name else None,
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


@admin.route("/admin/contests/<int:contest_id>/users")
@admins_only
def contest_users(contest_id):
    from sqlalchemy import func, or_
    from CTFd.models import ContestChallenge, Submissions, Teams, Users, Contests, UserTeamMember

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
    
    # In team mode, users belong to a contest if they are members of a team in that contest
    team_users_subquery = db.session.query(UserTeamMember.user_id)\
        .join(Teams, Teams.id == UserTeamMember.team_id)\
        .filter(Teams.contest_id == contest_id).subquery()
        
    contest_or_submitted = [Users.id.in_(team_users_subquery)]
    
    if cc_ids:
        participant_ids = [r[0] for r in db.session.query(Submissions.user_id.distinct())
                          .filter(Submissions.contest_challenge_id.in_(cc_ids),
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
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/action_logs.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/tickets")
@admins_only
def contest_tickets(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/tickets.html",
        contest=contest,
        is_detail=is_detail,
    )


@admin.route("/admin/contests/<int:contest_id>/instances")
@admins_only
def contest_instances(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    is_detail = True
    return render_template(
        "admin/contests/sections/instances.html",
        contest=contest,
        is_detail=is_detail,
    )


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
