from datetime import datetime
from urllib.parse import urlencode

from flask import render_template, request, url_for, jsonify

from CTFd.admin import admin
from CTFd.models import Challenges, Submissions, Teams, Users, db
from CTFd.utils.decorators import admin_or_jury, admins_only
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.modes import get_model
from pytz import timezone
import pytz


@admin.route("/admin/submissions", defaults={"submission_type": None})
@admin.route("/admin/submissions/<submission_type>")
@admin_or_jury
def submissions_listing(submission_type):
    filters_by = {}
    if submission_type:
        filters_by["type"] = submission_type
    filters = []

    q = request.args.get("q")
    field = request.args.get("field")
    page = abs(request.args.get("page", 1, type=int))

    # New filter parameters
    team_filter = request.args.get("team_id", "", type=str).strip()
    user_filter = request.args.get("user_id", "", type=str).strip()
    challenge_filter = request.args.get("challenge_id", "", type=str).strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()

    filters = build_model_filters(
        model=Submissions,
        query=q,
        field=field,
        extra_columns={
            "challenge_name": Challenges.name,
            "account_id": Submissions.account_id,
        },
    )

    # Apply additional filters
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
            # Include the entire end day
            dt_to = dt_to.replace(hour=23, minute=59, second=59)
            filters.append(Submissions.date <= dt_to)
        except ValueError:
            pass

    Model = get_model()

    submissions = (
        Submissions.query.filter_by(**filters_by)
        .filter(*filters)
        .join(Challenges)
        .join(Model)
        .order_by(Submissions.date.desc())
        .paginate(page=page, per_page=10, error_out=False)
    )

    # Get unique teams, users, challenges for filter dropdowns
    all_teams = Teams.query.order_by(Teams.name).all()
    all_users = Users.query.filter(Users.type != "admin").order_by(Users.name).all()
    all_challenges = Challenges.query.order_by(Challenges.name).all()

    args = dict(request.args)
    args.pop("page", 1)
    args.pop("submission_type", None)

    export_args = request.args.to_dict(flat=True)
    export_args.pop("page", None)
    if submission_type:
        export_args["submission_type"] = submission_type
    export_query = urlencode(export_args)

    return render_template(
        "admin/submissions.html",
        submissions=submissions,
        prev_page=url_for(
            request.endpoint,
            submission_type=submission_type,
            page=submissions.prev_num,
            **args
        ),
        next_page=url_for(
            request.endpoint,
            submission_type=submission_type,
            page=submissions.next_num,
            **args
        ),
        type=submission_type,
        export_query=export_query,
        q=q,
        field=field,
        all_teams=all_teams,
        all_users=all_users,
        all_challenges=all_challenges,
        team_filter=team_filter,
        user_filter=user_filter,
        challenge_filter=challenge_filter,
        date_from=date_from,
        date_to=date_to,
    )


@admin.route("/admin/submissions/resync-dynamic", methods=["POST"])
@admins_only
def resync_dynamic_challenges():
    """
    Recalculate values for all dynamic challenges.
    This endpoint triggers DynamicValueChallenge.calculate_value() for each dynamic challenge.
    """
    try:
        # Import here to avoid circular import issues
        from CTFd.plugins.dynamic_challenges import DynamicChallenge, DynamicValueChallenge
        from CTFd.cache import clear_challenges, clear_standings
        
        # Get all dynamic challenges
        dynamic_challenges = DynamicChallenge.query.all()
        
        if not dynamic_challenges:
            return jsonify({
                "success": True,
                "message": "No dynamic challenges found to resync",
                "count": 0
            })
        
        # Recalculate value for each dynamic challenge
        resync_count = 0
        for challenge in dynamic_challenges:
            try:
                DynamicValueChallenge.calculate_value(challenge)
                resync_count += 1
            except Exception as e:
                # Log error but continue with other challenges
                print(f"Error resyncing challenge {challenge.id}: {str(e)}")
                continue
        
        db.session.commit()
        
        # Clear caches to reflect updated challenge values
        clear_challenges()
        clear_standings()
        
        return jsonify({
            "success": True,
            "message": f"Successfully resynced {resync_count} dynamic challenge(s)",
            "count": resync_count
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": f"Error resyncing dynamic challenges: {str(e)}"
        }), 500
