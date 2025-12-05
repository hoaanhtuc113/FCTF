import hashlib
import threading
import time
from flask import Blueprint, jsonify, request, session, url_for
from datetime import datetime, timedelta
import requests
import json
from CTFd.models import (
    Teams,
    ChallengeFiles,
    Challenges,
    Tokens,
    Users,
    db,
)
from CTFd.plugins import bypass_csrf_protection
from CTFd.constants.envvars import (
    PRIVATE_KEY,
    API_URL_CONTROLSERVER,
    HOST_CACHE,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASS,
    REDIS_DB,
)
# 
from CTFd.utils.user import get_current_user, is_admin

import redis
import re

from CTFd.utils.decorators import admins_only, during_ctf_time_only
from CTFd.utils.connector.multiservice_connector import (
    challenge_start,
    create_secret_key,
    force_stop,
    force_stop_all,
    generate_cache_attempt_key,
    generate_cache_key,
    get_team_id_and_cache_key,
    get_token_from_header,
    prepare_start_challenge_payload,
    start_challenge_status_checking,
)

challenge = Blueprint("challenge", __name__)
redis_client = redis.StrictRedis(
    host=f"{REDIS_HOST}",
    port=int(REDIS_PORT),
    password=REDIS_PASS,
    db=int(REDIS_DB),
    encoding="utf-8",
    decode_responses=True
)
   
@challenge.route("/api/challenge/start", methods=["POST"])
@during_ctf_time_only
@bypass_csrf_protection
def start_challenge():
    data = request.get_json() or request.form.to_dict()
    challenge_id = data.get("challenge_id")
    user_id = session["id"]

    if user_id is None:
        generatedToken = get_token_from_header()
        print("Generated Token:", generatedToken)
        token = Tokens.query.filter_by(value=generatedToken).first()
        if not token:
            return jsonify({"error": "Token not found"}), 404
        else:
            user_id = token.user_id

    if not user_id:
        return jsonify({"error": "Please login"}), 400

    if not challenge_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    user = Users.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"error": "User Not found"}), 404

    challenge = Challenges.query.filter_by(id=challenge_id).first()
    # lấy ra team_id theo user_id
    team_id, cache_key = get_team_id_and_cache_key(user, challenge_id)
    team = Teams.query.filter_by(id=team_id).first()
    if not team_id or not challenge:
        return jsonify({"error": "Invalid team or challenge"}), 400

    if challenge.require_deploy:
        # # Check xem team đã có đội trưởng chưa và người khởi động challenge có phải đội trưởng không
        # if(user.type == 'user' and (not team.captain_id or team.captain_id != user_id)):
        #     return jsonify({"error": "Contact the organizers to select a team captain. Only the team captain has the permission to start the challenge."}), 400
        # Chuẩn bị payload và headers
        payload, headers, api_start = prepare_start_challenge_payload(challenge, user_id, team_id)

        return challenge_start(payload, headers, api_start)

@challenge.route("/api/challenge/status-check/<challenge_id>", methods=["GET"])
@bypass_csrf_protection
def check_challenge_status(challenge_id):
    if not challenge_id or challenge_id == 'undefined':
        return jsonify({"error": "ChallengeId is required"}), 400

    return start_challenge_status_checking(challenge_id, -1)  # -1 for preview mode
    
@challenge.route("/api/challenge/stop-by-admin", methods=["POST"])
@bypass_csrf_protection
def stop_challenge_by_admin():
    data = request.get_json() or request.form.to_dict()
    team_id = data.get("team_id")
    challenge_id = data.get("challenge_id")
    user_id = session["id"]
    print("useriddddd" +str(user_id))
    if not team_id :
        return jsonify({"error": "TeamId is required"}), 400
        
    if not challenge_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"error": "User Not found"}), 403

    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400
    

    challenge = Challenges.query.filter_by(id=challenge_id).first()

    if not challenge:
        return jsonify({"error": "Challenge not found"}), 400
    if team_id != '-1':
        cache_key = generate_cache_key(challenge_id, team_id)
    else: 
        cache_key = generate_cache_key(challenge_id, team_id)   

    print("test " + str(cache_key))
    if not redis_client.exists(cache_key):
        return (
            jsonify(
                {
                    "error": "Challenge not started or already stopped, no active cache found."
                }
            ),
            400,
        )


    try:
        return force_stop(user_id=user_id, challenge_id=challenge_id,team_id=team_id)

    except requests.exceptions.RequestException as e:
        print(f"Error during stop challenge: {e}")
        return (
            jsonify({"error": "Failed to connect to stop API", "error_detail": str(e)}),
            400,
        )

@challenge.route("/api/challenge/stop-all", methods=["DELETE"])
@bypass_csrf_protection
def stop_all_challenges():
    user_id = session["id"]
    print("useriddddd" +str(user_id))
    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"error": "User Not found"}), 403

    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400

    try:
        return force_stop_all(user_id=user_id)

    except requests.exceptions.RequestException as e:
        print(f"Error during stop challenge: {e}")
        return (
            jsonify({"error": "Failed to connect to stop API", "error_detail": str(e)}),
            400,
        )


@challenge.route("/api/challenge/get-all-instance", methods=["POST", "GET"])
@bypass_csrf_protection
def get_all_instance():
    try:
        # Kiểm tra quyền truy cập của người dùng
        user = get_current_user()
        if not user or not is_admin():
            return jsonify({"error": "Permission denied"}), 403
        
        # Get pagination and sorting parameters
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 25, type=int)
        sort_by = request.args.get("sort_by", "time_finished")  # Default sort by time
        sort_order = request.args.get("sort_order", "desc")  # Default descending
        
        # Get filter and search parameters
        team_filter = request.args.get("team_name", "").strip().lower()
        challenge_search = request.args.get("challenge_name", "").strip().lower()
        
        pattern = "deploy_challenge_*_*"
        cursor = 0
        matching_keys = []

        while True:
            cursor, keys = redis_client.scan(cursor=cursor, match=pattern, count=100)
            matching_keys.extend(keys)
            if cursor == 0:
                break

        result = []
        special_cases = []
        normal_cases = []
        
        # goi then status checking API de lay trang thai cua tung instance
        print("Matching key: " + str(matching_keys))
        for key in matching_keys:
            print("key: " + str(key))
            key_str = key
            value_raw = redis_client.get(key)
            print("key_str: " + key_str)
            print("value_raw: " + str(value_raw))

            if not value_raw:
                continue

            try:
                value = json.loads(value_raw)
            except json.JSONDecodeError:
                continue

            # Tách challenge_id và team_id từ key
            match = re.match(r"deploy_challenge_(\d+)_(-?\d+)", key_str)
            if not match:
                continue

            challenge_id_key = int(match.group(1))
            team_id = int(match.group(2))
            user_id = value.get("user_id")
            user = Users.query.filter_by(id=user_id).first()
            team_name = "Unknown Team"
            if team_id == -1:
                team_name = "Preview Mode"
            else:
                team = Teams.query.filter_by(id=team_id).first()
                if team:
                    team_name = team.name
                    
            challenge = Challenges.query.filter_by(id=challenge_id_key).first()

            # Chuyển time_finished sang chuỗi thời gian ISO
            raw_timestamp = value.get("time_finished")
            # Backend now returns seconds directly
            finished_time = (
                datetime.fromtimestamp(raw_timestamp).isoformat()
                if raw_timestamp is not None and raw_timestamp > 0
                else None
            )
            
            if team_id == -1:
                special_cases.append({
                    "challenge_id": challenge_id_key,
                    "team_id": team_id,
                    "challenge_name": challenge.name if challenge else "Unknown Challenge",
                    "team_name": team_name,
                    "user_name": user.name if user else "Unknown User",
                    "user_id": value.get("user_id"),
                    "challenge_url": value.get("challenge_url"),
                    "time_finished": finished_time,  # dạng ISO 8601
                    "time_finished_timestamp": raw_timestamp if raw_timestamp else 0
                })
            else:
                normal_cases.append({
                    "challenge_id": challenge_id_key,
                    "challenge_name": challenge.name if challenge else "Unknown Challenge",
                    "team_name": team_name,
                    "user_name": user.name if user else "Unknown User",
                    "team_id": team_id,
                    "user_id": value.get("user_id"),
                    "challenge_url": value.get("challenge_url"),
                    "time_finished": finished_time,  # dạng ISO 8601
                    "time_finished_timestamp": raw_timestamp if raw_timestamp else 0
                })

        # Combine all data
        all_data = special_cases + normal_cases
        
        # Extract unique team names for filtering
        unique_teams = sorted(list(set(item.get("team_name", "") for item in all_data if item.get("team_name"))))
        
        # Apply filters
        if team_filter:
            all_data = [item for item in all_data if team_filter in item.get("team_name", "").lower()]
        
        if challenge_search:
            all_data = [item for item in all_data if challenge_search in item.get("challenge_name", "").lower()]
        
        # Sort data
        reverse = (sort_order == "desc")
        if sort_by == "challenge_name":
            all_data.sort(key=lambda x: x.get("challenge_name", "").lower(), reverse=reverse)
        elif sort_by == "team_name":
            all_data.sort(key=lambda x: x.get("team_name", "").lower(), reverse=reverse)
        elif sort_by == "user_name":
            all_data.sort(key=lambda x: x.get("user_name", "").lower(), reverse=reverse)
        elif sort_by == "time_finished":
            all_data.sort(key=lambda x: x.get("time_finished_timestamp", 0), reverse=reverse)
        elif sort_by == "challenge_id":
            all_data.sort(key=lambda x: x.get("challenge_id", 0), reverse=reverse)
        
        # Calculate pagination
        total_items = len(all_data)
        total_pages = (total_items + per_page - 1) // per_page if per_page > 0 else 1
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        paginated_data = all_data[start_idx:end_idx]
        
        # Remove timestamp field from response
        for item in paginated_data:
            item.pop("time_finished_timestamp", None)

        return jsonify({
            "success": True,
            "data": paginated_data,
            "teams": unique_teams,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total_items": total_items,
                "total_pages": total_pages,
                "has_prev": page > 1,
                "has_next": page < total_pages
            }
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@challenge.route("/api/attempt/check_cache", methods=["POST"])
@bypass_csrf_protection
def check_user_attempt_cache():
    data = request.get_json() or request.form.to_dict()
    if data == request.form.to_dict():
        challenge_id = data.get("challenge_id")
        generatedToken = data.get("generatedToken")
    else:
        challenge_id = data.get("ChallengeId")
        generatedToken = data.get("generatedToken")
    if not challenge_id or not generatedToken:

        return jsonify({"error": "Missing challengeId or generated Token"}), 404
    challenge = Challenges.query.filter_by(id=challenge_id).first()
    if not challenge:
        return jsonify({"error": "Challenge not found"})

    token = Tokens.query.filter_by(value=generatedToken).first()
    if token is None:
        return jsonify({"error": "Token not found"}), 404

    user = Users.query.filter_by(id=token.user_id).first()
    if user is None:
        return jsonify({"error": "User not found"}), 404

    team_id = user.team_id
    cache_key = generate_cache_attempt_key(challenge_id, team_id)
    exist = redis_client.exists(cache_key)
    if exist:
        return (
            jsonify(
                {
                    "status": "Submitted",
                    "message": "This challenge is solved by you or your teamate",
                }
            ),
            200,
        )
    else:
        return jsonify({"status": "Not Submitted"}), 404