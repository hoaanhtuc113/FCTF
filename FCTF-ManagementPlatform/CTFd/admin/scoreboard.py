from collections import defaultdict
from flask import render_template
import pytz
from CTFd.admin import admin
from CTFd.utils.config import is_teams_mode

from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.scores import (
    get_standings,
    get_user_standings,
    getSubmitStandings,
    get_team_challenge_counts,
    get_teams_cleared_all_challenges_by_topic,
    calculate_and_assign_awards,
)
from CTFd.models import Achievements, Awards, Challenges, Solves, Teams, Users, db
from sqlalchemy import and_



@admin.route("/admin/scoreboard")
@admin_or_jury
def scoreboard_listing():
    
    standings = get_standings(admin=True)
    user_standings = get_user_standings(admin=True) if is_teams_mode() else None
    top_submission = getSubmitStandings(admin=True)
    print('top submit:', top_submission)
    top_solves = get_team_challenge_counts(is_admin=True)
    top_solves_with_topics = get_teams_cleared_all_challenges_by_topic(user_is_admin=True)
    calculate_and_assign_awards()

    # Subquery for latest submissions
    latest_submission_subquery = (
        db.session.query(
            Solves.challenge_id,
            db.func.max(Solves.date).label("latest_submission_time")
        )
        .group_by(Solves.challenge_id)
        .subquery()
    )

    # Main query to join with the subquery and fetch additional details
    last_submission = (
        db.session.query(
            Solves.challenge_id,
            Solves.team_id,
            Solves.user_id,
            Solves.date.label("submission_time"),
            Challenges.name.label("challenge_name"),
            Teams.name.label("team_name"),
            Users.name.label("user_name")
        )
        .join(latest_submission_subquery, and_(
            Solves.challenge_id == latest_submission_subquery.c.challenge_id,
            Solves.date == latest_submission_subquery.c.latest_submission_time
        ))
        .join(Teams, Solves.team_id == Teams.id)
        .join(Users, Solves.user_id == Users.id)
        .join(Challenges, Solves.challenge_id == Challenges.id)
        .order_by(Solves.challenge_id)
        .all()
    )

    # Query for achievements
    first_bloods = (
        db.session.query(Achievements)
        .join(Challenges, Achievements.challenge_id == Challenges.id)
        .filter(Achievements.name == 'First Blood')
        .all()
    )

    # Prepare achievement data for the template
    first_bloods_data = [
        {
            "challenge": achievement.challenge.name,
            "team_name": achievement.team.name if achievement.team else "No Team",
            "user_name": achievement.user.name if achievement.user else "No User",
        }
        for achievement in first_bloods
    ]
    
    team_ids = [team.account_id for team in standings]

    solves = Solves.query.filter(Solves.account_id.in_(team_ids)).all()
    awards = Awards.query.filter(Awards.account_id.in_(team_ids)).all()

    team_scores = defaultdict(lambda: defaultdict(int))

    for solve in solves:
        team_scores[solve.challenge_id][solve.team_id] += solve.challenge.value

    for award in awards:
        team_scores[None][award.team_id] += award.value

    challenge_masters_data = []
    for challenge_id, teams_scores in team_scores.items():
        if challenge_id:  
            max_team_id = max(teams_scores, key=teams_scores.get)
            max_score = teams_scores[max_team_id]

            challenge = Challenges.query.filter_by(id=challenge_id).first()
            challenge_name = challenge.name if challenge else "Unknown Challenge"

            team = Teams.query.filter_by(id=max_team_id).first()
            team_name = team.name if team else "No Team"
            challenge_masters_data.append({
            "challenge_id": challenge_id,
            "challenge_name": challenge_name,
            "team_name": team_name,
            "max_score": max_score,
        })
        else:
        # Nếu không có challenge_id (chỉ từ giải thưởng), cộng điểm vào đội
            for team_id, score in teams_scores.items():
                if team_id:  # Đảm bảo rằng có team_id
                    team = Teams.query.filter_by(id=team_id).first()
                    team_name = team.name if team else "No Team"
                    challenge_masters_data.append({
                    "challenge_id": None,
                    "challenge_name": "No Challenge",
                    "team_name": team_name,
                    "user_name": "No User",
                    "max_score": score,
                })
                    
    challenge_masters_data = [data for data in challenge_masters_data if data["max_score"] >= 0]
    print('master data:', challenge_masters_data)

    # Render the template
    return render_template(
        "admin/scoreboard.html",
        standings=standings,
        user_standings=user_standings,
        top_submission=top_submission,
        top_solves=top_solves,
        last_submission=last_submission,
        top_solves_with_topics=top_solves_with_topics,
        first_bloods=first_bloods_data,
        challenge_masters=challenge_masters_data,
    )