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
        db.session.query(db.func.sum(db.literal(0)))
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

    solves_sub = (
        db.session.query(
            Solves.contest_challenge_id, db.func.count(Solves.contest_challenge_id).label("solves_cnt")
        )
        .join(Model, Solves.account_id == Model.id)
        .filter(Model.banned == False, Model.hidden == False)
        .group_by(Solves.contest_challenge_id)
        .subquery()
    )
    
    from CTFd.models import ContestsChallenges
    solves = (
        db.session.query(
            ContestsChallenges.challenge_id,
            solves_sub.columns.solves_cnt,
            Challenges.name,
        )
        .join(ContestsChallenges, solves_sub.columns.contest_challenge_id == ContestsChallenges.id)
        .join(Challenges, ContestsChallenges.challenge_id == Challenges.id)
        .all()
    )
    # solves is a list of tuples: (challenge_id, solves_cnt, name)
    # Unpack accordingly: (challenge_id, count, name)
    solve_data = {name: count for _cid, count, name in solves}
    most_solved = max(solve_data, key=solve_data.get) if solve_data else None
    least_solved = min(solve_data, key=solve_data.get) if solve_data else None
    db.session.close()

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