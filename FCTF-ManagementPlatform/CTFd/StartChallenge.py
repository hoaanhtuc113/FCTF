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
    API_URL_ADMINSERVER,
    PRIVATE_KEY,
    API_URL_CONTROLSERVER,
    HOST_CACHE,
)
# 
from CTFd.utils.user import get_current_user, is_admin

import redis
import re

from CTFd.utils.decorators import admins_only, during_ctf_time_only
from CTFd.utils.connector.multiservice_connector import challenge_start, create_secret_key, force_stop, generate_cache_attempt_key, generate_cache_key, get_team_id_and_cache_key, get_token_from_header, prepare_challenge_payload

challenge = Blueprint("challenge", __name__)
redis_client = redis.StrictRedis(
    host=f"{HOST_CACHE}", port=6379, db=0, encoding="utf-8", decode_responses=True
)


def remove_from_cache_by_challenge_id(cache_key, challenge_id):
    # Retrieve the list
    cached_list = redis_client.lrange(cache_key, 0, -1)
    
    if not cached_list:
        print(f"No cache found for key: {cache_key}")
        return
    
    # Deserialize and filter out the matching item
    filtered_list = []
    removed = False
    for item in cached_list:
        value = json.loads(item)
        if value.get("challenge_id") == challenge_id:
            removed = True
            continue
        filtered_list.append(value)

    if not removed:
        print(f"Challenge ID {challenge_id} not found in cache: {cache_key}")
        return
    
    # Clear the original list
    redis_client.delete(cache_key)

    # Push the filtered items back to the list
    for value in filtered_list:
        redis_client.rpush(cache_key, json.dumps(value))

    print(f"Removed challenge_id {challenge_id} from cache: {cache_key}")


   
@challenge.route("/api/challenge/start", methods=["POST"])
@during_ctf_time_only
@bypass_csrf_protection
def start_challenge():
    data = request.get_json() or request.form.to_dict()
    challenge_id = data.get("challenge_id")
    user_id = session["id"]

    if user_id is None:
        generatedToken = get_token_from_header()
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
    challenge = Challenges.query.filter_by(id=challenge_id).first()
    challenge_time = challenge.time_limit or -1
    # lấy ra team_id theo user_id
    team_id, cache_key = get_team_id_and_cache_key(user, challenge_id, challenge_time)
    team = Teams.query.filter_by(id=team_id).first()
    if not user or not team_id or not challenge:
        return jsonify({"error": "Invalid user or team"}), 400

    if challenge.require_deploy:
        # Check xem team đã có đội trưởng chưa và người khởi động challenge có phải đội trưởng không
        if(user.type == 'user' and (not team.captain_id or team.captain_id != user_id)):
            return jsonify({"error": "Contact the organizers to select a team captain. Only the team captain has the permission to start the challenge."}), 400
        
        payload, headers, api_start = prepare_challenge_payload(challenge, user, team_id, challenge_time)
        
        return challenge_start(payload, headers, api_start, challenge, challenge_time, cache_key, user_id, challenge_id, team_id)

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
        force_stop(cache_key=cache_key, challenge_id=challenge_id,team_id=team_id)
        return (
            jsonify(
                {
                    "isSuccess":True,
                    "status": "Stopped",
                    "message": "Stop challenge success",
                }
            ),
            200,
        )

    except requests.exceptions.RequestException as e:
        print(f"Error during stop challenge: {e}")
        return (
            jsonify({"error": "Failed to connect to stop API", "error_detail": str(e)}),
            400,
        )

@challenge.route("/api/challenge/stop-by-user", methods=["POST"])
@bypass_csrf_protection
def stop_challenge_by_user():
    data = request.get_json() or request.form.to_dict()
    challenge_id = data.get("challenge_id")

    if not challenge_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    generatedToken = get_token_from_header()
    token = Tokens.query.filter_by(value=generatedToken).first()
    if not token:
        return jsonify({"error": "Token not found"}), 404
    else:
        user_id = token.user_id
        if not user_id:
            return jsonify({"error": "Please login"}), 400

    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"error": "User Not found"}), 404

    team_id = user.team_id
    if not team_id :
        return jsonify({"err or": "User no join team"}), 400
        
    challenge = Challenges.query.filter_by(id=challenge_id).first()

    if not challenge:
        return jsonify({"error": "Challenge not found"}), 400

    cache_key = generate_cache_key(challenge_id, team_id)

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
        force_stop(cache_key=cache_key, challenge_id=challenge_id,team_id=team_id)
        return (
            jsonify(
                {
                    "isSuccess": True,
                    "status": "Stopped",
                    "message": "Stop challenge success",
                }
            ),
            200,
        )

    except requests.exceptions.RequestException as e:
        print(f"Error during stop challenge: {e}")
        return (
            jsonify({"error": "Failed to connect to stop API", "error_detail": str(e)}),
            400,
        )


@challenge.route("/api/challenge/get-all-instance", methods=["POST"])
@bypass_csrf_protection
def get_all_instance():
    try:
        # Kiểm tra quyền truy cập của người dùng
        user = get_current_user()
        if not user or not is_admin():
            return jsonify({"error": "Permission denied"}), 403
        
        pattern = "challenge_url_*_*"
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
            match = re.match(r"challenge_url_(\d+)_(-?\d+)", key_str)
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
            finished_time = (
                datetime.fromtimestamp(raw_timestamp).isoformat()
                if raw_timestamp is not None
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
                    "time_finished": finished_time  # dạng ISO 8601
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
                    "time_finished": finished_time  # dạng ISO 8601
                })

        return jsonify({
            "success": True,
            "data": special_cases + normal_cases,
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