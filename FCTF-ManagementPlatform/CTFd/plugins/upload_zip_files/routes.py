from datetime import datetime, timedelta
from flask import Flask, request, jsonify, Blueprint, session
import requests
import zipfile
import io
from CTFd.plugins import bypass_csrf_protection
import time
import hashlib
from CTFd.models import Challenges, DeployedChallenge, Users, db
from CTFd.plugins.challenges import get_chal_class
from CTFd.schemas.challenges import ChallengeSchema
from CTFd.constants.formats import FORMAT_DATETIME
from CTFd.StartChallenge import generate_cache_key
from CTFd.constants.status_challenge import STATUS
from CTFd.constants.envvars import API_URL_CONTROLSERVER, PRIVATE_KEY
from CTFd.utils.security.auth import generate_user_token
from CTFd.utils.connector.multiservice_connector import (
    delete_cached_files,
    redeploy,
    handle_challenge_upload,
)

file_app = Blueprint("upload_zip_files", __name__)


def allowed_file(filename):
    # Chỉ chấp nhận tệp có phần mở rộng là '.zip'
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "zip"


def create_secret_key(
    private_key: str, unix_time: int, data: dict, default_value: str = "1"
) -> str:
    sorted_key = sorted(data.keys())
    combineString = str(unix_time) + private_key

    for key in sorted_key:
        combineString += str(data.get(key, default_value))
    md5_hash = hashlib.md5(combineString.encode()).hexdigest()
    return md5_hash


import os
import time
import zipfile
import io
import requests
from flask import jsonify
import asyncio
import json
import redis
from CTFd.constants.envvars import (
    PRIVATE_KEY,
    API_URL_CONTROLSERVER,
    HOST_CACHE,
    get_redis_client_kwargs,
)

    
redis_client = redis.StrictRedis(**get_redis_client_kwargs())

def upload_file(challenge_id, file_path, exposed_port=None):
    delete_cached_files(challenge_id)

    if not os.path.exists(file_path):
        return {"success": False, "error": "File not found"}, 400

    challenge = Challenges.query.filter_by(id=challenge_id).first()
    
    if allowed_file(file_path) and file_path.endswith(".zip"):
        return handle_challenge_upload(challenge, file_path, exposed_port)
    else:
        return {"success": False, "error": "File type not allowed. Only zip files are allowed."}, 400

@file_app.route("/challenges/update-info-by-cs", methods=["POST"])
@bypass_csrf_protection
def update_challenge_info():
    secret_key_request = request.headers.get("SecretKey")
    if not secret_key_request:
        return jsonify({"error": "SecretKey is required"}), 400
    print(secret_key_request)
    data = request.form.to_dict() or request.get_json()

    challenge_id = data.get("ChallengeId")
    if not challenge_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    unix_time = data.get("UnixTime")
    deploy_status = data.get("ChallengeStatus")
    log_content = data.get("ChallengeLogs")

    private_key = PRIVATE_KEY

    data.pop("UnixTime", None)
    secret_key = create_secret_key(private_key, unix_time, data)
    print(secret_key)
    print(secret_key)

    if secret_key_request != secret_key:
        return jsonify({"error": "SecretKey is not correct"}), 400
    challenge = Challenges.query.filter_by(id=challenge_id).first()
    print("challlegengeee" + str(challenge))
    if deploy_status in STATUS:
        deploy_challenge = DeployedChallenge(
            challenge_id=challenge_id,
            deploy_status=deploy_status,
            log_content=log_content,
            deploy_at=datetime.utcnow(),
        )

        print("deploystatusss" + str(deploy_status))

        challenge.last_update = datetime.utcnow()
        challenge.image_link = data.get("ImageLink")
        challenge.deploy_status = deploy_status

        try:
            db.session.add(deploy_challenge)
            db.session.commit()
            print(challenge.deploy_status)
            return jsonify({"message": "Challenge updated successfully"}), 200
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": str(e)}), 500
    else:
        return (
            jsonify(
                {"error": f"Invalid deploy status. Must be one of: {', '.join(STATUS)}"}
            ),
            400,
        )


if __name__ == "__main__":
    file_app.run(debug=True)
