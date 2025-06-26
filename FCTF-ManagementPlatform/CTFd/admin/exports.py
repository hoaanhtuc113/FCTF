from io import BytesIO

from flask import send_file
from CTFd.admin import admin
from CTFd.models import Challenges, Teams, Tracking, Submissions, Users
from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.scores import get_standings, get_user_standings, getSubmitStandings, get_team_challenge_counts, get_teams_cleared_all_challenges_by_topic
import pandas as pd 
from CTFd.utils.modes import get_model


@admin.route('/admin/exports_excel')
@admin_or_jury
def export_data():
    
    standings = get_standings(admin=True)
    submit_standings = getSubmitStandings(admin=True)
    user_standings= get_user_standings(admin=True)
    top_challenge_count_teams= get_team_challenge_counts(is_admin= True)
    get_team_cleared= get_teams_cleared_all_challenges_by_topic(user_is_admin= True)
    print(get_team_cleared)
  
    standings_df = pd.DataFrame(standings)
    submit_standings_df = pd.DataFrame(submit_standings)
    user_standings_df= pd.DataFrame(user_standings)
    top_challenge_count_teams_df= pd.DataFrame(top_challenge_count_teams)
    get_teams_clear_df= pd.DataFrame(get_team_cleared)
    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        standings_df.to_excel(writer, sheet_name='Standings', index=False)
        submit_standings_df.to_excel(writer, sheet_name='Submit Standings', index=False)
        user_standings_df.to_excel(writer, sheet_name='Users Standings', index=False)
        top_challenge_count_teams_df.to_excel(writer, sheet_name='Top Teams Solved Most Chal', index=False)
        get_teams_clear_df.to_excel(writer, sheet_name='All Chal By Topic', index=False)
    
    output.seek(0)
    
    return send_file(
        output,
        as_attachment=True,
        download_name='scoreboard.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    

@admin.route('/admin/export_submission_data')
@admin_or_jury
def export_submission_data():
    # Truy vấn dữ liệu submissions đầy đủ
    submissions = (
        Submissions.query
        .join(Challenges, Submissions.challenge_id == Challenges.id)
        .join(Teams, Submissions.team_id == Teams.id)
        .join(Users, Submissions.user_id == Users.id)
        .add_columns(
            Submissions.id.label("ID"),
            Users.name.label("User"),
            Teams.name.label("Team"),
            Challenges.name.label("Challenge"),
            Submissions.type.label("Type"),
            Submissions.provided.label("Provided"),
            Submissions.date.label("Date")
        )
        .order_by(Submissions.date.desc())
        .all()
    )

    # Chuyển đổi dữ liệu sang DataFrame
    data = [{
        "ID": s.ID,
        "User": s.User,
        "Account": s.Team,
        "Challenge": s.Challenge,
        "Type": s.Type,
        "Provided": s.Provided,
        "Date": s.Date.strftime('%Y-%m-%d %H:%M:%S')
    } for s in submissions]

    submission_df = pd.DataFrame(data)

    # Xuất ra Excel
    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        submission_df.to_excel(writer, sheet_name='All Submissions', index=False)

    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name='submissions.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )