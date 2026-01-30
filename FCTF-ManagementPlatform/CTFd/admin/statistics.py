from flask import render_template

from CTFd.admin import admin
from CTFd.models import Challenges, Fails, Solves, Teams, Tracking, Users, db
from CTFd.utils.decorators import admins_only, admin_or_challenge_writer_only_or_jury
from CTFd.utils.modes import get_model
from CTFd.utils.updates import update_check


@admin.route("/admin/statistics", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
# @challenge_writer_only
def statistics():
    # update_check()
    Model = get_model()
    teams_q = db.session.query(db.func.count(Teams.id)).scalar_subquery()
    users_q = db.session.query(db.func.count(Users.id)).scalar_subquery()
    chals_q = db.session.query(db.func.count(Challenges.id)).scalar_subquery()
    points_q = (
        db.session.query(db.func.sum(Challenges.value))
        .filter(Challenges.state == "visible")
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
    # executing batch query
    stats = db.session.query(
        teams_q, users_q, chals_q, points_q, ips_q, wrong_q, solve_q
    ).first()
    (team_count, user_count, challenge_count, total_points, ip_count, wrong_count, solve_count) = stats

    solves_sub = (
        db.session.query(
            Solves.challenge_id, db.func.count(Solves.challenge_id).label("solves_cnt")
        )
        .join(Model, Solves.account_id == Model.id)
        .filter(Model.banned == False, Model.hidden == False)
        .group_by(Solves.challenge_id)
        .subquery()
    )
    
    solves = (
        db.session.query(
            solves_sub.columns.challenge_id,
            solves_sub.columns.solves_cnt,
            Challenges.name,
        )
        .join(Challenges, solves_sub.columns.challenge_id == Challenges.id)
        .all()
    )
    solve_data = {name: count for count, name in solves}
    most_solved = max(solve_data, key=solve_data.get) if solve_data else None
    least_solved = min(solve_data, key=solve_data.get) if solve_data else None
    db.session.close()

    return render_template(
        "admin/statistics.html",
        user_count=user_count,
        team_count=team_count,
        ip_count=ip_count,
        wrong_count=wrong_count,
        solve_count=solve_count,
        challenge_count=challenge_count,
        total_points=total_points,
        solve_data=solve_data,
        most_solved=most_solved,
        least_solved=least_solved,
    )
