import json
from operator import and_
import os
import time
from CTFd.utils.security.signing import serialize
from flask import (
    Blueprint,
    abort,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)
import redis
from CTFd.constants.envvars import (
    API_URL_ADMINSERVER,
    PRIVATE_KEY,
    API_URL_CONTROLSERVER,
    HOST_CACHE,
)
from sqlalchemy import func
from CTFd.utils.connector.multiservice_connector import (
    challenge_start,
    create_secret_key,
    force_stop,
    generate_cache_attempt_key,
    generate_cache_key,
    get_team_id_and_cache_key,
    get_token_from_header,
    prepare_challenge_payload,
)

from CTFd.constants.config import ChallengeVisibilityTypes, Configs
from CTFd.utils.config import is_teams_mode
from CTFd.utils.dates import ctf_ended, ctf_paused, ctf_started
from CTFd.utils.decorators import (
    during_ctf_time_only,
    require_complete_profile,
    require_verified_emails,
)
from CTFd.utils.decorators.visibility import check_challenge_visibility
from CTFd.utils.helpers import get_errors, get_infos
from CTFd.utils.user import authed, get_current_team, is_banned
from CTFd.models import (
    ChallengeFiles,
    ChallengeTopics,
    Challenges,
    Files,
    Solves,
    Submissions,
    Teams,
    Tokens,
    Topics,
    Users,
)
from CTFd.plugins import bypass_csrf_protection
from CTFd.StartChallenge import generate_cache_key, get_token_from_header
from CTFd.plugins.multiple_choice import modify_description

redis_client = redis.StrictRedis(
    host=f"{HOST_CACHE}", port=6379, db=0, encoding="utf-8", decode_responses=True
)
challenges = Blueprint("challenges", __name__)


@challenges.route("/challenges", methods=["GET"])
@require_complete_profile
@during_ctf_time_only
@require_verified_emails
@check_challenge_visibility
def listing():
    if (
        Configs.challenge_visibility == ChallengeVisibilityTypes.PUBLIC
        and authed() is False
    ):
        pass
    else:
        if is_teams_mode() and get_current_team() is None:
            return redirect(url_for("teams.private", next=request.full_path))

    infos = get_infos()
    errors = get_errors()

    if Configs.challenge_visibility == ChallengeVisibilityTypes.ADMINS:
        infos.append("Challenge Visibility is set to Admins Only")

    if ctf_started() is False:
        errors.append(f"{Configs.ctf_name} has not started yet")

    if ctf_paused() is True:
        infos.append(f"{Configs.ctf_name} is paused")

    if ctf_ended() is True:
        infos.append(f"{Configs.ctf_name} has ended")

    return render_template("challenges.html", infos=infos, errors=errors)


@challenges.route("/api/challenge/<int:challenge_id>", methods=["GET"])
@during_ctf_time_only
@bypass_csrf_protection
def get_challenge_detail(challenge_id):
    try:
        challenge = Challenges.query.filter_by(id=challenge_id).first()

        if not challenge:
            return jsonify({"success": False, "message": "Challenge not found"}), 404
        if challenge.state == "hidden":
            return (
                jsonify(
                    {"success": False, "message": "Challenge now is not available"}
                ),
                404,
            )

        generatedToken = get_token_from_header()
        if not generatedToken:
            return jsonify({"error": "No account or account has been banned"}), 403
        token = Tokens.query.filter_by(value=generatedToken).first()
        if token is None:
            return jsonify({"error": "Token not found"}), 404
        user = Users.query.filter_by(id=token.user_id).first()

        if user is None:
            return jsonify({"error": "User not found"}), 404
        team_id = user.team_id
        team = Teams.query.filter_by(id=team_id).first()
        if team.banned or user.banned:
            return jsonify({"error": "Your team has been banned"}), 404

        solve_id = (
            Solves.query.with_entities(Solves.challenge_id)
            .filter(Solves.team_id == team_id)
            .filter(Solves.challenge_id == challenge.id)
            .first()
        )

        solve_by_myteam = False
        if solve_id:
            solve_by_myteam = True

        attempts = Submissions.query.filter_by(
            team_id=team_id, challenge_id=challenge.id
        ).count()

        files = []
        for f in challenge.files:
            token = {
                "user_id": user.id,
                "team_id": team_id if team_id else None,
                "file_id": f.id,
            }
            files.append(
                url_for("views.files", path=f.location, token=serialize(token))
            )

        challenge_data = {
            "id": challenge.id,
            "name": challenge.name,
            "description": modify_description(challenge),
            "max_attempts": challenge.max_attempts,
            "attemps": attempts,
            "category": challenge.category,
            "time_limit": challenge.time_limit,
            "require_deploy": challenge.require_deploy,
            "type": challenge.type,
            "next_id": challenge.next_id,
            "solve_by_myteam": solve_by_myteam,
            "files": files,
        }

        cache_key = generate_cache_key(challenge_id, team_id)
        print("cache_key:", cache_key)
        if redis_client.exists(cache_key):
            cached_value = redis_client.get(cache_key)
            challenge_data_cached = json.loads(cached_value)
            challenge_id_cache = challenge_data_cached.get("challenge_id")
            challenge_user_id = challenge_data_cached.get("user_id")
            user = Users.query.filter_by(id=challenge_user_id).first()
            user_name = user.name
            if challenge_id_cache == challenge_id:

                time_finished = challenge_data_cached.get("time_finished")
                time_remaining = 0
                if time_finished:
                    time_remaining = int(
                        time_finished - time.time()
                    )  # time_remaining in seconds
                    if time_remaining < 0:
                        time_remaining = 0
                return (
                    jsonify(
                        {
                            "message": f"Challenge was started by: {user_name}",
                            "data": challenge_data,
                            "is_started": True,
                            "challenge_url": challenge_data_cached["challenge_url"],
                            "time_remaining": time_remaining,
                        }
                    ),
                    200,
                )
            else:
                return jsonify(
                    {
                        "data": challenge_data,
                        "is_started": False,
                    }
                )
        else:
            return (
                jsonify({"success": True, "data": challenge_data, "is_started": False}),
                200,
            )
    except Exception as e:
        return (
            jsonify({"success": False, "message": f"An error occurred: {str(e)}"}),
            400,
        )


@challenges.route("/api/challenge/list_challenge/<string:category>", methods=["GET"])
@bypass_csrf_protection
def get_challenges_by_topic(category):
    try:
        challenges = Challenges.query.filter_by(category=category).all()
        generatedToken = get_token_from_header()
        token = Tokens.query.filter_by(value=generatedToken).first()
        user_id = token.user_id
        user = Users.query.filter_by(id=user_id).first()
        team_id = user.team_id
        if not token:
            return jsonify({"error": "Token not found"}), 404

        topics_data = []

        for challenge in challenges:
            if challenge.state == "hidden":
                continue
            else:
                solve_id = (
                    Solves.query.with_entities(Solves.challenge_id)
                    .filter(Solves.team_id == team_id)
                    .filter(Solves.challenge_id == challenge.id)
                    .first()
                )

                solve_by_myteam = False
                if solve_id:
                    solve_by_myteam = True
                challenge_data = {
                    "id": challenge.id,
                    "name": challenge.name,
                    "next_id": challenge.next_id,
                    "max_attempts": challenge.max_attempts,
                    "value": challenge.value,
                    "category": challenge.category,
                    "time_limit": challenge.time_limit,
                    "type": challenge.type,
                    "requirements": challenge.requirements,
                    "time_limit": challenge.time_limit,
                    "solve_by_myteam": solve_by_myteam,
                }
                topics_data.append(challenge_data)

        return jsonify({"success": True, "data": topics_data}), 200

    except Exception as e:
        return (
            jsonify({"success": False, "message": "An error occurred: " + str(e)}),
            500,
        )


@challenges.route("/api/challenge/by-topic", methods=["GET"])
@bypass_csrf_protection
def challenge_by_topic():
    if is_banned():
        return (
            jsonify({"message": "You have been banned from CTFd", "success": False}),
            403,
        )
    generatedToken = get_token_from_header()
    token = Tokens.query.filter_by(value=generatedToken).first()
    user_id = token.user_id
    user = Users.query.filter_by(id=user_id).first()
    team_id = user.team_id
    if not token:
        return jsonify({"error": "Token not found"}), 404

    try:
        distinct_categories = (
            Challenges.query.with_entities(Challenges.category)
            .filter(Challenges.state != "hidden")
            .distinct()
            .all()
        )

        challenge_counts_by_topic = (
            Challenges.query.with_entities(
                Challenges.category, func.count(Challenges.id).label("challenge_count")
            )
            .filter(Challenges.state != "hidden")
            .group_by(Challenges.category)
            .all()
        )

        # Tạo từ điển để dễ tra cứu số lượng challenges
        challenge_count_dict = {
            category: count for category, count in challenge_counts_by_topic
        }

        # Thêm số lượng challenges vào topics_data
        topics_data = []

        for category in distinct_categories:
            topic_name = category[0]
            solved_challenges = (
                Solves.query.join(Challenges, Solves.challenge_id == Challenges.id)
                .filter(
                    Solves.team_id == team_id,
                    Challenges.category == topic_name,
                    Challenges.state != "hidden",
                )
                .distinct(Challenges.id)
                .count()
            )

            challenge_count_by_topic = challenge_count_dict.get(category[0], 0)
            cleared = False
            if solved_challenges >= challenge_count_by_topic:
                cleared = True
            data = {
                "topic_name": topic_name,
                "challenge_count": challenge_count_by_topic,
                "cleared": cleared,
            }
            topics_data.append(data)

        return jsonify({"success": True, "data": topics_data}), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@challenges.route("/api/public/challenge/by-topic", methods=["GET"])
@bypass_csrf_protection
def public_challenge_by_topic():
    try:
        # Lấy các danh mục challenge mà không yêu cầu người dùng đăng nhập
        distinct_categories = (
            Challenges.query.with_entities(Challenges.category)
            .filter(Challenges.state != "hidden")
            .distinct()
            .all()
        )

        challenge_counts_by_topic = (
            Challenges.query.with_entities(
                Challenges.category, func.count(Challenges.id).label("challenge_count")
            )
            .filter(Challenges.state != "hidden")
            .group_by(Challenges.category)
            .all()
        )

        # Tạo từ điển để dễ tra cứu số lượng challenges
        challenge_count_dict = {
            category: count for category, count in challenge_counts_by_topic
        }

        # Thêm số lượng challenges vào topics_data
        topics_data = []

        for category in distinct_categories:
            topic_name = category[0]
            solved_challenges = (
                Solves.query.join(Challenges, Solves.challenge_id == Challenges.id)
                .filter(Challenges.category == topic_name, Challenges.state != "hidden")
                .distinct(Challenges.id)
                .count()
            )

            challenge_count_by_topic = challenge_count_dict.get(category[0], 0)
            cleared = False
            if solved_challenges >= challenge_count_by_topic:
                cleared = True
            data = {
                "topic_name": topic_name,
                "challenge_count": challenge_count_by_topic,
                "cleared": cleared,
            }
            topics_data.append(data)

        return jsonify({"success": True, "data": topics_data}), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@challenges.route("/api/challenge/<int:challenge_id>", methods=["GET"])
@bypass_csrf_protection
def challenge_by_id(challenge_id):
    try:
        challenge = Challenges.query.get_or_404(challenge_id)
        if challenge.state != "hidden":
            challenge_data = {
                "id": challenge.id,
                "name": challenge.name,
                "next_id": challenge.next_id,
                "max_attempts": challenge.max_attempts,
                "value": challenge.value,
                "category": challenge.category,
                "time_limit": challenge.time_limit,
                "type": challenge.type,
                "requirements": challenge.requirements,
                "time_limit": challenge.time_limit,
            }
            return jsonify({"success": True, "data": challenge_data}), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), ".", "uploads/")


# Route để lấy file của challenge
@challenges.route("/api/challenge/<int:challenge_id>/file", methods=["GET"])
@bypass_csrf_protection
def get_challenge_file(challenge_id):
    try:
        challenge = Challenges.query.filter_by(id=challenge_id).first()
        if not challenge:
            return jsonify({"success": False, "message": "Challenge not found"}), 404

        challenge_file = ChallengeFiles.query.filter_by(
            challenge_id=challenge_id
        ).first()
        if not challenge_file:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "No file associated with this challenge",
                    }
                ),
                404,
            )

        file_location = challenge_file.location
        if not file_location:
            return (
                jsonify({"success": False, "message": "File path is not defined"}),
                404,
            )

        if file_location.startswith("/"):
            file_location = file_location[1:]

        file_path = os.path.join(UPLOAD_FOLDER, file_location)
        print("File path:", file_path)

        if not os.path.exists(file_path):
            return (
                jsonify({"success": False, "message": "File does not exist on server"}),
                404,
            )

        return send_file(file_path, as_attachment=True)

    except Exception as e:
        return (
            jsonify({"success": False, "message": f"An error occurred: {str(e)}"}),
            500,
        )
