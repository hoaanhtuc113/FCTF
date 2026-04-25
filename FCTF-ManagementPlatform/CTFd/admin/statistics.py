from flask import render_template

from CTFd.admin import admin
from CTFd.models import Challenges, ContestParticipants, ContestsChallenges, Contests, Fails, Solves, Teams, Tracking, Users, db
from CTFd.utils.decorators import admins_only, admin_or_challenge_writer_only_or_jury
from CTFd.utils.modes import get_model
from CTFd.utils.updates import update_check


@admin.route("/admin/statistics", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def statistics():
    Model = get_model()

    users_q = db.session.query(db.func.count(Users.id)).scalar_subquery()
    chals_q = db.session.query(db.func.count(Challenges.id)).scalar_subquery()
    points_q = (
        db.session.query(db.func.sum(ContestsChallenges.value))
        .filter(ContestsChallenges.state == "visible")
        .scalar_subquery()
    )
    ips_q = db.session.query(db.func.count(db.func.distinct(Tracking.ip))).scalar_subquery()
    wrong_q = (
        db.session.query(db.func.count(Fails.id))
        .join(Model, Fails.account_id == Model.id)
        .filter(Model.banned == False, Model.hidden == False)
        .scalar_subquery()
    )
    solve_q = (
        db.session.query(db.func.count(Solves.id))
        .join(Model, Solves.account_id == Model.id)
        .filter(Model.banned == False, Model.hidden == False)
        .scalar_subquery()
    )
    from CTFd.models import Semester
    semester_q = db.session.query(db.func.count(Semester.id)).scalar_subquery()

    stats = db.session.query(users_q, chals_q, points_q, ips_q, wrong_q, solve_q, semester_q).first()
    (user_count, challenge_count, total_points, ip_count, wrong_count, solve_count, semester_count) = stats

    # Recent contests with participant/challenge counts
    from CTFd.models import Semester
    recent_contests_raw = (
        Contests.query.join(Semester, Semester.id == Contests.semester_id, isouter=True)
        .order_by(Contests.id.desc()).limit(10).all()
    )
    # Pre-load semester to avoid DetachedInstanceError
    semester_map = {s.id: s for s in Semester.query.all()}
    for c in recent_contests_raw:
        c._semester_obj = semester_map.get(c.semester_id)
    recent_contests = []
    for c in recent_contests_raw:
        c.participant_count = ContestParticipants.query.filter_by(contest_id=c.id).count()
        c.challenge_count = ContestsChallenges.query.filter_by(contest_id=c.id).count()
        recent_contests.append(c)

    return render_template(
        "admin/statistics.html",
        user_count=user_count,
        ip_count=ip_count,
        wrong_count=wrong_count,
        solve_count=solve_count,
        challenge_count=challenge_count,
        total_points=total_points,
        semester_count=semester_count,
        recent_contests=recent_contests,
    )