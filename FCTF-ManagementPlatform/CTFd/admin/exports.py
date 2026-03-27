from io import BytesIO

from flask import request, send_file
from CTFd.admin import admin
from CTFd.models import Challenges, Teams, Tracking, Submissions, Users
from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.scores import get_standings, get_user_standings, getSubmitStandings, get_team_challenge_counts
from CTFd.utils.modes import get_model
from datetime import datetime

try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False


@admin.route('/admin/exports_excel')
@admin_or_jury
def export_data():
    if not PANDAS_AVAILABLE:
        return {"success": False, "error": "pandas library not installed"}, 500
    
    try:
        standings = get_standings(admin=True)
        submit_standings = getSubmitStandings(admin=True)
        user_standings= get_user_standings(admin=True)
        top_challenge_count_teams= get_team_challenge_counts(is_admin= True)
      
        standings_df = pd.DataFrame(standings)
        submit_standings_df = pd.DataFrame(submit_standings)
        user_standings_df= pd.DataFrame(user_standings)
        top_challenge_count_teams_df= pd.DataFrame(top_challenge_count_teams)
        
        output = BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            standings_df.to_excel(writer, sheet_name='Standings', index=False)
            submit_standings_df.to_excel(writer, sheet_name='Submit Standings', index=False)
            user_standings_df.to_excel(writer, sheet_name='Users Standings', index=False)
            top_challenge_count_teams_df.to_excel(writer, sheet_name='Top Teams Solved Most Chal', index=False)
        
        output.seek(0)
        
        return send_file(
            output,
            as_attachment=True,
            download_name='scoreboard.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error exporting Excel: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}, 500
    

@admin.route('/admin/export_submission_data')
@admin_or_jury
def export_submission_data():
    if not PANDAS_AVAILABLE:
        return {"success": False, "error": "pandas library not installed"}, 500
        
    try:
        submission_type = request.args.get("submission_type") or request.args.get("type")

        q = request.args.get("q")
        field = request.args.get("field")
        team_filter = request.args.get("team_id", "", type=str).strip()
        user_filter = request.args.get("user_id", "", type=str).strip()
        challenge_filter = request.args.get("challenge_id", "", type=str).strip()
        date_from = request.args.get("date_from", "").strip()
        date_to = request.args.get("date_to", "").strip()

        filters_by = {}
        if submission_type:
            filters_by["type"] = submission_type

        filters = build_model_filters(
            model=Submissions,
            query=q,
            field=field,
            extra_columns={
                "challenge_name": Challenges.name,
                "account_id": Submissions.account_id,
            },
        )

        if team_filter:
            filters.append(Submissions.team_id == int(team_filter))
        if user_filter:
            filters.append(Submissions.user_id == int(user_filter))
        if challenge_filter:
            filters.append(Submissions.challenge_id == int(challenge_filter))
        if date_from:
            try:
                dt_from = datetime.strptime(date_from, "%Y-%m-%d")
                filters.append(Submissions.date >= dt_from)
            except ValueError:
                pass
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d")
                dt_to = dt_to.replace(hour=23, minute=59, second=59)
                filters.append(Submissions.date <= dt_to)
            except ValueError:
                pass

        submissions = (
            Submissions.query.filter_by(**filters_by)
            .filter(*filters)
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

        def normalize_sheet_name(name: str) -> str:
            # Excel sheet name must be <= 31 chars and cannot contain []:*?/\
            safe = "".join("_" if ch in "[]:*?/\\" else ch for ch in name)
            safe = safe.strip() or "Sheet1"
            return safe[:31]

        sheet_name = "All Submissions"
        if submission_type:
            sheet_name = f"{submission_type.title()} Submissions"
        sheet_name = normalize_sheet_name(sheet_name)

        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            submission_df.to_excel(writer, sheet_name=sheet_name, index=False)

        output.seek(0)

        filename = "submissions"
        if submission_type:
            filename = f"{submission_type}-submissions"
        return send_file(
            output,
            as_attachment=True,
            download_name=f"{filename}.xlsx",
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        print(f"Error exporting submission Excel: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}, 500