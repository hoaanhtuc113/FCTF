from flask import render_template, request, url_for, jsonify

from CTFd.admin import admin
from CTFd.models import Challenges, Submissions, db
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

    filters = build_model_filters(
        model=Submissions,
        query=q,
        field=field,
        extra_columns={
            "challenge_name": Challenges.name,
            "account_id": Submissions.account_id,
        },
    )

    Model = get_model()

    submissions = (
        Submissions.query.filter_by(**filters_by)
        .filter(*filters)
        .join(Challenges)
        .join(Model)
        .order_by(Submissions.date.desc())
        .paginate(page=page, per_page=10, error_out=False)
    )

    args = dict(request.args)
    args.pop("page", 1)

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
        q=q,
        field=field,
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
