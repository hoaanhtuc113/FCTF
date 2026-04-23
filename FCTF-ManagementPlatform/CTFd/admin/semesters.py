"""
admin/semesters.py
Quản lý Semester và danh sách Contest trong mỗi semester.
"""
import datetime
import re

from flask import flash, jsonify, redirect, render_template, request, url_for

from CTFd.admin import admin
from CTFd.models import Users, db
from CTFd.models import Contest, ContestParticipant, Semester
from CTFd.utils.decorators import admins_only


# ── helpers ───────────────────────────────────────────────────────────────────

def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:100]


def _unique_slug(base: str, exclude_id: int | None = None) -> str:
    slug = _slugify(base)
    q = Contest.query.filter_by(slug=slug)
    if exclude_id:
        q = q.filter(Contest.id != exclude_id)
    if q.first():
        slug = f"{slug}-{int(datetime.datetime.utcnow().timestamp())}"
    return slug


# ── Semester CRUD ─────────────────────────────────────────────────────────────

@admin.route("/admin/semesters")
@admins_only
def semesters_listing():
    semesters = Semester.query.order_by(Semester.created.desc()).all()
    return render_template("admin/semesters/listing.html", semesters=semesters)


@admin.route("/admin/semesters/new", methods=["GET", "POST"])
@admins_only
def semester_new():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Tên kỳ học không được trống.", "danger")
            return redirect(url_for("admin.semester_new"))

        sem = Semester(
            name=name,
            code=request.form.get("code", "").strip() or None,
            academic_year=request.form.get("academic_year", "").strip() or None,
            start_date=request.form.get("start_date", "").strip() or None,
            end_date=request.form.get("end_date", "").strip() or None,
            status=request.form.get("status", "upcoming"),
            note=request.form.get("note", "").strip() or None,
        )
        db.session.add(sem)
        db.session.commit()
        flash(f"Đã tạo kỳ học '{sem.name}'.", "success")
        return redirect(url_for("admin.semester_detail", semester_id=sem.id))

    return render_template("admin/semesters/new.html")


@admin.route("/admin/semesters/<int:semester_id>")
@admins_only
def semester_detail(semester_id):
    sem = Semester.query.get_or_404(semester_id)
    contests = (
        Contest.query.filter_by(semester_id=semester_id)
        .order_by(Contest.created_at.desc())
        .all()
    )
    # Gắn thêm số lượng participants cho mỗi contest
    for c in contests:
        c.participant_count = ContestParticipant.query.filter_by(contest_id=c.id).count()
    return render_template(
        "admin/semesters/detail.html", semester=sem, contests=contests
    )


@admin.route("/admin/semesters/<int:semester_id>/edit", methods=["GET", "POST"])
@admins_only
def semester_edit(semester_id):
    sem = Semester.query.get_or_404(semester_id)
    if request.method == "POST":
        sem.name = request.form.get("name", sem.name).strip()
        sem.code = request.form.get("code", "").strip() or None
        sem.academic_year = request.form.get("academic_year", "").strip() or None
        sem.start_date = request.form.get("start_date", "").strip() or None
        sem.end_date = request.form.get("end_date", "").strip() or None
        sem.status = request.form.get("status", sem.status)
        sem.note = request.form.get("note", "").strip() or None
        db.session.commit()
        flash("Đã cập nhật kỳ học.", "success")
        return redirect(url_for("admin.semester_detail", semester_id=sem.id))
    return render_template("admin/semesters/edit.html", semester=sem)


@admin.route("/admin/semesters/<int:semester_id>/delete", methods=["POST"])
@admins_only
def semester_delete(semester_id):
    sem = Semester.query.get_or_404(semester_id)
    name = sem.name
    db.session.delete(sem)
    db.session.commit()
    flash(f"Đã xoá kỳ học '{name}'.", "success")
    return redirect(url_for("admin.semesters_listing"))


# ── Contest CRUD (trong một semester) ────────────────────────────────────────

@admin.route("/admin/semesters/<int:semester_id>/contests/new", methods=["GET", "POST"])
@admins_only
def contest_new(semester_id):
    sem = Semester.query.get_or_404(semester_id)
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Tên contest không được trống.", "danger")
            return redirect(url_for("admin.contest_new", semester_id=semester_id))

        slug = _unique_slug(request.form.get("slug", "") or name)

        def _parse_dt(field):
            val = request.form.get(field, "").strip()
            if not val:
                return None
            try:
                return datetime.datetime.fromisoformat(val)
            except ValueError:
                return None

        from CTFd.utils.user import get_current_user
        owner = get_current_user()

        contest = Contest(
            semester_id=semester_id,
            name=name,
            description=request.form.get("description", "").strip() or None,
            slug=slug,
            owner_id=owner.id if owner else None,
            state=request.form.get("state", "hidden"),
            user_mode=request.form.get("user_mode", "users"),
            start_time=_parse_dt("start_time"),
            end_time=_parse_dt("end_time"),
            freeze_scoreboard_at=_parse_dt("freeze_scoreboard_at"),
        )
        db.session.add(contest)
        db.session.commit()
        flash(f"Đã tạo contest '{contest.name}'.", "success")
        return redirect(
            url_for("admin.contest_dashboard", contest_id=contest.id)
        )

    return render_template("admin/semesters/contest_new.html", semester=sem)


@admin.route("/admin/contests/<int:contest_id>/edit", methods=["GET", "POST"])
@admins_only
def contest_edit(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    if request.method == "POST":
        contest.name = request.form.get("name", contest.name).strip()
        contest.description = request.form.get("description", "").strip() or None
        contest.state = request.form.get("state", contest.state)
        contest.user_mode = request.form.get("user_mode", contest.user_mode)
        contest.updated_at = datetime.datetime.utcnow()

        def _parse_dt(field, fallback=None):
            val = request.form.get(field, "").strip()
            if not val:
                return fallback
            try:
                return datetime.datetime.fromisoformat(val)
            except ValueError:
                return fallback

        contest.start_time = _parse_dt("start_time", contest.start_time)
        contest.end_time = _parse_dt("end_time", contest.end_time)
        contest.freeze_scoreboard_at = _parse_dt(
            "freeze_scoreboard_at", contest.freeze_scoreboard_at
        )

        # Slug chỉ thay nếu người dùng nhập mới
        new_slug = request.form.get("slug", "").strip()
        if new_slug and new_slug != contest.slug:
            contest.slug = _unique_slug(new_slug, exclude_id=contest.id)

        db.session.commit()
        flash("Đã cập nhật contest.", "success")
        return redirect(url_for("admin.contest_dashboard", contest_id=contest.id))

    return render_template("admin/contests/edit.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/delete", methods=["POST"])
@admins_only
def contest_delete(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    semester_id = contest.semester_id
    name = contest.name
    db.session.delete(contest)
    db.session.commit()
    flash(f"Đã xoá contest '{name}'.", "success")
    if semester_id:
        return redirect(url_for("admin.semester_detail", semester_id=semester_id))
    return redirect(url_for("admin.semesters_listing"))


# ── Contest Dashboard (landing khi vào một contest) ───────────────────────────

@admin.route("/admin/contests/<int:contest_id>")
@admins_only
def contest_dashboard(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    participant_count = ContestParticipant.query.filter_by(contest_id=contest_id).count()
    from CTFd.models import ContestChallenge, Submissions, Solves
    challenge_count = ContestChallenge.query.filter_by(contest_id=contest_id).count()
    solve_count = Solves.query.filter_by(contest_id=contest_id).count()
    submission_count = Submissions.query.filter_by(contest_id=contest_id).count()
    return render_template(
        "admin/contests/dashboard.html",
        contest=contest,
        participant_count=participant_count,
        challenge_count=challenge_count,
        solve_count=solve_count,
        submission_count=submission_count,
    )


# ── Contest → Challenges ──────────────────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/challenges")
@admins_only
def contest_challenges(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.models import ContestChallenge, ChallengeBank, Challenges, Tags

    # Lấy danh sách challenge_id thuộc contest này
    cc_bank_ids = {
        cc.bank_id: cc
        for cc in ContestChallenge.query.filter_by(contest_id=contest_id).all()
    }
    bank_challenge_ids = list(cc_bank_ids.keys())

    # Map bank_id → challenge_id trong Challenges table (nếu có liên kết)
    # Thực tế contest dùng Challenges model (legacy), filter theo bank_id
    # Lấy Challenges có id nằm trong bank_challenge_ids
    q = request.args.get("q")
    field = request.args.get("field") or "name"
    category = request.args.get("category")
    type_ = request.args.get("type")
    difficulty = request.args.get("difficulty")
    state_filter = request.args.get("state")
    has_prereq = request.args.get("has_prereq")
    page = abs(request.args.get("page", 1, type=int))
    tags_q = request.args.get("tags")

    tag_terms = []
    filters = [Challenges.id.in_(bank_challenge_ids)] if bank_challenge_ids else [db.false()]

    if tags_q:
        tag_terms = [t.strip() for t in tags_q.split(",") if t.strip()]
        for term in tag_terms:
            exists_filter = (
                db.session.query(Tags.id)
                .filter(Tags.challenge_id == Challenges.id, db.func.lower(Tags.value) == term.lower())
                .exists()
            )
            filters.append(exists_filter)

    if q and Challenges.__mapper__.has_property(field):
        filters.append(getattr(Challenges, field).like(f"%{q}%"))
    if category:
        filters.append(Challenges.category == category)
    if type_:
        filters.append(Challenges.type == type_)
    if difficulty:
        filters.append(Challenges.difficulty == int(difficulty))
    if state_filter:
        filters.append(Challenges.state == state_filter)
    if has_prereq == "yes":
        filters.append(Challenges.requirements.isnot(None))
    elif has_prereq == "no":
        filters.append(Challenges.requirements.is_(None))

    challenges = Challenges.query.filter(*filters).order_by(Challenges.id.asc()).paginate(
        page=page, per_page=50, error_out=False
    )

    # Thêm creator name
    from CTFd.models import Users
    for c in challenges.items:
        user = Users.query.filter_by(id=c.user_id).first()
        c.creator = user.name if user else "Unknown"

    categories = [r[0] for r in db.session.query(Challenges.category).filter(
        Challenges.id.in_(bank_challenge_ids)).distinct().all() if r[0]]
    types = [r[0] for r in db.session.query(Challenges.type).filter(
        Challenges.id.in_(bank_challenge_ids)).distinct().all() if r[0]]

    args = dict(request.args)
    args.pop("page", None)
    args["contest_id"] = contest_id

    prev_page = url_for("admin.contest_challenges", page=challenges.prev_num, **args) if challenges.has_prev else "#"
    next_page = url_for("admin.contest_challenges", page=challenges.next_num, **args) if challenges.has_next else "#"

    return render_template(
        "admin/contests/challenges.html",
        contest=contest,
        challenges=challenges,
        field=field,
        q=q,
        category=category,
        type=type_,
        difficulty=difficulty,
        state_filter=state_filter,
        has_prereq=has_prereq,
        tag_terms=tag_terms,
        categories=categories,
        types=types,
        prev_page=prev_page,
        next_page=next_page,
    )


@admin.route("/admin/contests/<int:contest_id>/challenges/add", methods=["POST"])
@admins_only
def contest_challenge_add(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.models import ContestChallenge, ChallengeBank
    data = request.get_json(silent=True) or {}
    bank_ids = data.get("bank_ids", [])
    if not bank_ids:
        return jsonify({"success": False, "message": "Không có challenge nào được chọn."}), 400

    added, skipped = [], []
    for bid in bank_ids:
        bc = ChallengeBank.query.get(bid)
        if not bc:
            skipped.append(bid)
            continue
        exists = ContestChallenge.query.filter_by(
            contest_id=contest_id, bank_id=bid
        ).first()
        if exists:
            skipped.append(bid)
            continue
        cc = ContestChallenge(
            contest_id=contest_id,
            bank_id=bid,
            name=bc.name,
            connection_protocol=bc.connection_protocol or "http",
            max_deploy_count=bc.max_deploy_count or 0,
        )
        db.session.add(cc)
        added.append(bid)

    db.session.commit()
    return jsonify({
        "success": True,
        "message": f"Đã thêm {len(added)} challenge.",
        "added": added,
        "skipped": skipped,
    })


@admin.route(
    "/admin/contests/<int:contest_id>/challenges/<int:cc_id>/remove",
    methods=["POST"]
)
@admins_only
def contest_challenge_remove(contest_id, cc_id):
    from CTFd.models import ContestChallenge
    cc = ContestChallenge.query.filter_by(
        id=cc_id, contest_id=contest_id
    ).first_or_404()
    db.session.delete(cc)
    db.session.commit()
    flash("Đã xoá challenge khỏi contest.", "success")
    return redirect(url_for("admin.contest_challenges", contest_id=contest_id))


# ── Contest → Users (Participants) ───────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/users")
@admins_only
def contest_users(contest_id):
    contest = Contest.query.get_or_404(contest_id)

    q = request.args.get("q", "").strip()
    field = request.args.get("field") or "name"
    role_filter = request.args.get("role", "")
    verified_filter = request.args.get("verified", "")
    hidden_filter = request.args.get("hidden", "")
    banned_filter = request.args.get("banned", "")
    page = abs(request.args.get("page", 1, type=int))

    # Lấy user_id thuộc contest
    participant_user_ids = [
        cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()
    ]

    filters = [Users.id.in_(participant_user_ids)] if participant_user_ids else [db.false()]

    if q and hasattr(Users, field):
        filters.append(getattr(Users, field).like(f"%{q}%"))
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

    users_q = Users.query.filter(*filters).order_by(Users.id.asc()).paginate(
        page=page, per_page=50, error_out=False
    )

    args = dict(request.args)
    args.pop("page", None)
    args["contest_id"] = contest_id
    prev_page = url_for("admin.contest_users", page=users_q.prev_num, **args) if users_q.has_prev else "#"
    next_page = url_for("admin.contest_users", page=users_q.next_num, **args) if users_q.has_next else "#"

    return render_template(
        "admin/contests/users.html",
        contest=contest,
        users=users_q,
        q=q,
        field=field,
        role_filter=role_filter,
        verified_filter=verified_filter,
        hidden_filter=hidden_filter,
        banned_filter=banned_filter,
        prev_page=prev_page,
        next_page=next_page,
    )


@admin.route("/admin/contests/<int:contest_id>/users/import", methods=["POST"])
@admins_only
def contest_users_import(contest_id):
    """Import users từ danh sách users tổng vào contest."""
    contest = Contest.query.get_or_404(contest_id)
    data = request.get_json(silent=True) or {}
    user_ids = data.get("user_ids", [])

    if not user_ids:
        return jsonify({"success": False, "message": "Không có user nào được chọn."}), 400

    added, skipped = [], []
    for uid in user_ids:
        user = Users.query.get(uid)
        if not user:
            skipped.append(uid)
            continue
        exists = ContestParticipant.query.filter_by(
            contest_id=contest_id, user_id=uid
        ).first()
        if exists:
            skipped.append(uid)
            continue
        cp = ContestParticipant(
            contest_id=contest_id,
            user_id=uid,
            role="contestant",
            score=0,
        )
        db.session.add(cp)
        added.append(uid)

    db.session.commit()
    return jsonify({
        "success": True,
        "message": f"Đã import {len(added)} user.",
        "added": added,
        "skipped": skipped,
    })


@admin.route(
    "/admin/contests/<int:contest_id>/users/<int:user_id>/remove",
    methods=["POST"]
)
@admins_only
def contest_user_remove(contest_id, user_id):
    cp = ContestParticipant.query.filter_by(
        contest_id=contest_id, user_id=user_id
    ).first_or_404()
    db.session.delete(cp)
    db.session.commit()
    flash("Đã xoá user khỏi contest.", "success")
    return redirect(url_for("admin.contest_users", contest_id=contest_id))


# ── Contest → Scoreboard ──────────────────────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/scoreboard")
@admins_only
def contest_scoreboard(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    standings = (
        ContestParticipant.query
        .filter_by(contest_id=contest_id)
        .order_by(
            ContestParticipant.score.desc(),
            ContestParticipant.last_solve_at.asc(),
        )
        .all()
    )
    # Gắn user
    for p in standings:
        p.user_obj = Users.query.get(p.user_id)
    return render_template(
        "admin/contests/scoreboard.html", contest=contest, standings=standings
    )


# ── API: danh sách users tổng để import ──────────────────────────────────────

@admin.route("/admin/contests/<int:contest_id>/api/available-users")
@admins_only
def contest_api_available_users(contest_id):
    """Trả về users chưa có trong contest (để import)."""
    already_in = db.session.query(ContestParticipant.user_id).filter_by(
        contest_id=contest_id
    ).subquery()
    users = (
        Users.query
        .filter(Users.type == "user")
        .filter(Users.id.not_in(already_in))
        .order_by(Users.name)
        .all()
    )
    return jsonify({
        "success": True,
        "users": [
            {"id": u.id, "name": u.name, "email": u.email}
            for u in users
        ],
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Contest-scoped pages — wrap existing global pages với contest context
# ═══════════════════════════════════════════════════════════════════════════════

@admin.route("/admin/contests/<int:contest_id>/submissions")
@admin.route("/admin/contests/<int:contest_id>/submissions/<type>")
@admins_only
def contest_submissions(contest_id, type=None):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.models import Submissions, Challenges, Teams as TeamsModel

    q = request.args.get("q")
    field = request.args.get("field")
    page = abs(request.args.get("page", 1, type=int))
    team_filter = request.args.get("team_id", "").strip()
    user_filter = request.args.get("user_id", "").strip()
    challenge_filter = request.args.get("challenge_id", "").strip()

    filters = []
    if contest_id:
        filters.append(Submissions.contest_id == contest_id)
    if type:
        filters.append(Submissions.type == type)
    if team_filter:
        filters.append(Submissions.team_id == int(team_filter))
    if user_filter:
        filters.append(Submissions.user_id == int(user_filter))
    if challenge_filter:
        filters.append(Submissions.challenge_id == int(challenge_filter))

    submissions = (
        Submissions.query.filter(*filters)
        .order_by(Submissions.date.desc())
        .paginate(page=page, per_page=50, error_out=False)
    )

    participant_ids = [cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()]
    all_users = Users.query.filter(Users.id.in_(participant_ids)).order_by(Users.name).all() if participant_ids else []
    all_teams = TeamsModel.query.join(Users, TeamsModel.id == Users.team_id).filter(Users.id.in_(participant_ids)).distinct().all() if participant_ids else []
    all_challenges = Challenges.query.all()

    args = dict(request.args)
    args.pop("page", None)
    prev_page = url_for("admin.contest_submissions", contest_id=contest_id, page=submissions.prev_num, **args) if submissions.has_prev else "#"
    next_page = url_for("admin.contest_submissions", contest_id=contest_id, page=submissions.next_num, **args) if submissions.has_next else "#"

    return render_template(
        "admin/contests/submissions.html",
        contest=contest,
        submissions=submissions,
        type=type,
        q=q,
        field=field,
        team_filter=team_filter,
        user_filter=user_filter,
        challenge_filter=challenge_filter,
        all_teams=all_teams,
        all_users=all_users,
        all_challenges=all_challenges,
        prev_page=prev_page,
        next_page=next_page,
        timezone_offset="",
        filter_args={},
    )


@admin.route("/admin/contests/<int:contest_id>/teams")
@admins_only
def contest_teams(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.models import Teams as TeamsModel

    q = request.args.get("q", "").strip()
    field = request.args.get("field") or "name"
    hidden = request.args.get("hidden", "")
    banned = request.args.get("banned", "")
    page = abs(request.args.get("page", 1, type=int))

    participant_ids = [cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()]

    filters = []
    if participant_ids:
        filters.append(
            TeamsModel.id.in_(
                db.session.query(Users.team_id)
                .filter(Users.id.in_(participant_ids), Users.team_id.isnot(None))
            )
        )
    else:
        filters.append(db.false())

    if q and hasattr(TeamsModel, field):
        filters.append(getattr(TeamsModel, field).ilike(f"%{q}%"))
    if hidden == "true":
        filters.append(TeamsModel.hidden == True)
    elif hidden == "false":
        filters.append(TeamsModel.hidden == False)
    if banned == "true":
        filters.append(TeamsModel.banned == True)
    elif banned == "false":
        filters.append(TeamsModel.banned == False)

    teams = TeamsModel.query.filter(*filters).order_by(TeamsModel.id.asc()).paginate(
        page=page, per_page=50, error_out=False
    )

    args = dict(request.args)
    args.pop("page", None)
    prev_page = url_for("admin.contest_teams", contest_id=contest_id, page=teams.prev_num, **args) if teams.has_prev else "#"
    next_page = url_for("admin.contest_teams", contest_id=contest_id, page=teams.next_num, **args) if teams.has_next else "#"

    return render_template(
        "admin/contests/teams.html",
        contest=contest,
        teams=teams,
        q=q,
        field=field,
        hidden=hidden,
        banned=banned,
        bracket_id="",
        prev_page=prev_page,
        next_page=next_page,
    )


@admin.route("/admin/contests/<int:contest_id>/action-logs")
@admins_only
def contest_action_logs(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.models import ActionLogs
    from CTFd.admin.action_logs import (
        ACTION_TYPE_LABELS, _base_action_logs_query,
        _apply_user_team_filters, _apply_action_type_filter
    )
    page = abs(request.args.get("page", 1, type=int))
    per_page = max(1, min(request.args.get("per_page", 50, type=int), 200))
    user_filter = (request.args.get("user") or "").strip()
    team_filter = (request.args.get("team") or "").strip()
    action_type_filter = (request.args.get("action_type") or "").strip()

    participant_ids = [cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()]
    query = _base_action_logs_query()
    if participant_ids:
        query = query.filter(ActionLogs.userId.in_(participant_ids))
    else:
        query = query.filter(db.false())
    query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
    query = _apply_action_type_filter(query, action_type_filter=action_type_filter)
    logs = query.paginate(page=page, per_page=per_page, error_out=False)

    args = dict(request.args)
    args.pop("page", None)
    prev_page = url_for("admin.contest_action_logs", contest_id=contest_id, page=logs.prev_num, **args) if logs.has_prev else "#"
    next_page = url_for("admin.contest_action_logs", contest_id=contest_id, page=logs.next_num, **args) if logs.has_next else "#"

    return render_template(
        "admin/contests/action_logs.html",
        contest=contest, logs=logs,
        prev_page=prev_page, next_page=next_page,
        user_filter=user_filter, team_filter=team_filter,
        action_type_filter=action_type_filter,
        per_page=per_page, action_type_labels=ACTION_TYPE_LABELS,
    )


@admin.route("/admin/contests/<int:contest_id>/instances")
@admins_only
def contest_instances(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.admin.instances_history import (
        _base_instances_query, _apply_team_filter,
        _apply_challenge_filter, _apply_date_filters,
        _parse_datetime, _parse_quick_range, _local_to_utc,
    )
    from CTFd.models import ChallengeStartTracking
    from datetime import datetime as dt_datetime

    page = abs(request.args.get("page", 1, type=int))
    per_page = max(1, min(request.args.get("per_page", 50, type=int), 200))
    team_filter = (request.args.get("team") or "").strip()
    challenge_filter = (request.args.get("challenge") or "").strip()
    start_filter = (request.args.get("start") or "").strip()
    end_filter = (request.args.get("end") or "").strip()
    quick_filter = (request.args.get("quick") or "").strip()
    timezone_offset = (request.args.get("timezone_offset") or "").strip()

    start_date = _parse_datetime(start_filter)
    end_date = _parse_datetime(end_filter)
    quick_range = _parse_quick_range(quick_filter)
    if quick_range:
        end_date = dt_datetime.utcnow()
        start_date = end_date - quick_range
    else:
        if start_date:
            start_date = _local_to_utc(start_date, timezone_offset)
        if end_date:
            end_date = _local_to_utc(end_date, timezone_offset)

    participant_ids = [cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()]
    query = _base_instances_query()
    if participant_ids:
        query = query.filter(ChallengeStartTracking.user_id.in_(participant_ids))
    else:
        query = query.filter(db.false())
    query = _apply_team_filter(query, team_filter=team_filter)
    query = _apply_challenge_filter(query, challenge_filter=challenge_filter)
    query = _apply_date_filters(query, start_date=start_date, end_date=end_date)

    logs = query.paginate(page=page, per_page=per_page, error_out=False)
    args = dict(request.args)
    args.pop("page", None)
    prev_page = url_for("admin.contest_instances", contest_id=contest_id, page=logs.prev_num, **args) if logs.has_prev else "#"
    next_page = url_for("admin.contest_instances", contest_id=contest_id, page=logs.next_num, **args) if logs.has_next else "#"

    return render_template(
        "admin/contests/instances.html",
        contest=contest,
        logs=logs,
        prev_page=prev_page,
        next_page=next_page,
        team_filter=team_filter,
        challenge_filter=challenge_filter,
        start_filter=start_filter,
        end_filter=end_filter,
        quick_filter=quick_filter,
        timezone_offset=timezone_offset,
        per_page=per_page,
    )


@admin.route("/admin/contests/<int:contest_id>/tickets")
@admins_only
def contest_tickets(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.admin.Ticket import get_all_tickets
    page = max(request.args.get("page", default=1, type=int) or 1, 1)
    per_page = min(max(request.args.get("per_page", default=50, type=int) or 50, 1), 100)
    user_id = request.args.get("user_id", type=int)
    status = request.args.get("status", type=str)
    type_ = request.args.get("type", type=str)
    search = request.args.get("search", type=str)

    participant_ids = [cp.user_id for cp in ContestParticipant.query.filter_by(contest_id=contest_id).all()]
    response, status_code = get_all_tickets(user_id=user_id, status=status, type_=type_, search=search, page=page, per_page=per_page)
    if not isinstance(response, dict):
        response = {}
    all_tickets = response.get("tickets", []) if status_code == 200 else []
    tickets = [t for t in (all_tickets or []) if t.get("user_id") in participant_ids] if participant_ids else []

    return render_template(
        "admin/contests/tickets.html",
        contest=contest, tickets=tickets, total=len(tickets),
        per_page=per_page, page=page,
        status_options=["Open", "Closed"], type_options=["Question", "Error"],
        selected_user=user_id, selected_status=status, selected_type=type_, search=search,
    )


@admin.route("/admin/contests/<int:contest_id>/audit-logs")
@admins_only
def contest_audit_logs(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    from CTFd.admin.admin_audit import (
        ALL_ACTIONS, TARGET_TYPES, ACTOR_ROLES, ACTION_LABELS,
        _build_query, _current_filters
    )
    page = abs(request.args.get("page", 1, type=int))
    per_page = max(1, min(request.args.get("per_page", 50, type=int), 200))
    filters = _current_filters()
    q = _build_query(**filters)
    logs = q.paginate(page=page, per_page=per_page, error_out=False)
    args = dict(request.args)
    args.pop("page", None)
    prev_page = url_for("admin.contest_audit_logs", contest_id=contest_id, page=logs.prev_num, **args) if logs.has_prev else "#"
    next_page = url_for("admin.contest_audit_logs", contest_id=contest_id, page=logs.next_num, **args) if logs.has_next else "#"
    return render_template(
        "admin/contests/audit_logs.html",
        contest=contest, logs=logs,
        prev_page=prev_page, next_page=next_page,
        per_page=per_page, all_actions=ALL_ACTIONS,
        target_types=TARGET_TYPES, actor_roles=ACTOR_ROLES,
        action_labels=ACTION_LABELS, **filters,
    )


@admin.route("/admin/contests/<int:contest_id>/rewards")
@admins_only
def contest_rewards(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    return render_template("admin/contests/rewards.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/config", methods=["GET", "POST"])
@admins_only
def contest_config(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    return render_template("admin/contests/config.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/monitoring")
@admins_only
def contest_monitoring(contest_id):
    contest = Contest.query.get_or_404(contest_id)
    return render_template("admin/contests/monitoring.html", contest=contest)