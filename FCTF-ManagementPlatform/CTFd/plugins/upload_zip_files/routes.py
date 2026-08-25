from datetime import datetime, timedelta
from flask import Flask, request, jsonify, Blueprint, session
import requests
import zipfile
import io
from CTFd.plugins import bypass_csrf_protection
import time
import hmac
from CTFd.models import Challenges, ChallengeBank, ChallengeBankDeployHistory, DeployedChallenge, Users, db
from CTFd.plugins.challenges import get_chal_class
from CTFd.schemas.challenges import ChallengeSchema
from CTFd.constants.formats import FORMAT_DATETIME
from CTFd.StartChallenge import generate_cache_key
from CTFd.constants.status_challenge import STATUS
from CTFd.constants.envvars import API_URL_CONTROLSERVER, PRIVATE_KEY
from CTFd.utils.security.auth import generate_user_token
from CTFd.utils.connector.multiservice_connector import (
    CHALLENGE_BANK_ID_OFFSET,
    create_secret_key,
    delete_cached_files,
    redeploy,
    handle_challenge_upload,
    stop_active_instances,
)

file_app = Blueprint("upload_zip_files", __name__)


def allowed_file(filename):
    # Chỉ chấp nhận tệp có phần mở rộng là '.zip'
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "zip"


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

# Bao nhiêu lệch đồng hồ thì còn chấp nhận cho một callback đã ký. Cùng tên biến
# môi trường và cùng mặc định với phía C# (RequireSecretKeyAttribute) để hai đầu
# không lệch nhau khi chỉnh.
try:
    MAX_SKEW_SECONDS = int(os.environ.get("SECRET_KEY_MAX_SKEW_SECONDS", "") or 60)
    if MAX_SKEW_SECONDS <= 0:
        MAX_SKEW_SECONDS = 60
except ValueError:
    MAX_SKEW_SECONDS = 60

def upload_file(challenge_id, file_path, exposed_port=None):
    from flask import session as flask_session
    admin_user_id = flask_session.get("id")

    # Stop all live K8s instances BEFORE wiping Redis keys.
    # If we delete Redis first, the deployment service loses context
    # (namespace, team mapping) needed to clean up pods.
    stop_active_instances(challenge_id, admin_user_id)

    # Safety sweep: remove any keys the deployment service may not have deleted.
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
    data = request.form.to_dict() or request.get_json()

    challenge_id = data.get("ChallengeId")
    if not challenge_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    unix_time = data.get("UnixTime")
    deploy_status = data.get("ChallengeStatus")
    log_content = data.get("ChallengeLogs")

    private_key = PRIVATE_KEY

    # UnixTime nằm trong phần được ký, nhưng chữ ký chỉ chứng minh cặp
    # (UnixTime, data) từng được ký bằng PRIVATE_KEY - nó không nói gì về thời
    # điểm. Không có cửa sổ này thì một request hợp lệ bắt được ở đâu đó (log,
    # bản ghi trên đường truyền) phát lại được mãi mãi, mà endpoint này không
    # idempotent: mỗi lần phát lại ghi đè image_link/deploy_status về giá trị cũ
    # và chèn thêm một dòng DeployedChallenge nữa.
    try:
        unix_time_value = int(unix_time)
    except (TypeError, ValueError):
        return jsonify({"error": "UnixTime is required"}), 400

    if abs(int(time.time()) - unix_time_value) > MAX_SKEW_SECONDS:
        return jsonify({"error": "Request expired"}), 400

    data.pop("UnixTime", None)
    secret_key = create_secret_key(private_key, unix_time, data)

    # So sánh constant-time: phép so sánh chuỗi thường dừng ở ký tự sai đầu tiên,
    # để lộ đoán được bao nhiêu ký tự và biến việc giả chữ ký thành dò từng ký tự.
    if not hmac.compare_digest(secret_key_request, secret_key):
        return jsonify({"error": "SecretKey is not correct"}), 400

    # Cửa sổ thời gian ở trên vẫn chừa lại đúng bấy nhiêu giây để phát lại. Đóng
    # nốt bằng nonce dùng một lần: chữ ký đã là duy nhất theo (UnixTime, data)
    # nên dùng luôn nó làm nonce. TTL chỉ cần dài hơn cửa sổ, vì quá đó thì
    # UnixTime cũ đã bị chặn từ trước rồi. Kiểm tra sau khi đã xác thực chữ ký
    # để người gửi chữ ký giả không đốt được nonce của người gửi thật.
    nonce_key = f"fctf:admin:secretkey-nonce:{secret_key}"
    try:
        first_use = redis_client.set(nonce_key, "1", nx=True, ex=MAX_SKEW_SECONDS * 2)
    except Exception as e:
        # Fail closed. Cho request đi tiếp khi không tới được nonce store là âm
        # thầm bỏ luôn chống phát lại, nên từ chối và nói rõ lý do.
        return jsonify({"error": f"Nonce store unavailable: {e}"}), 503

    if not first_use:
        return jsonify({"error": "SecretKey already used"}), 400

    # A bank build's callback carries the offset id (see
    # CHALLENGE_BANK_ID_OFFSET) and lands on update_challenge_bank_info()
    # below instead - reject it here rather than let a coincidental id match
    # in `challenges` silently apply a bank build's status to a real contest
    # challenge.
    try:
        if int(challenge_id) >= CHALLENGE_BANK_ID_OFFSET:
            return jsonify({"error": "Challenge not found"}), 404
    except (TypeError, ValueError):
        pass

    challenge = Challenges.query.filter_by(id=challenge_id).first()
    if challenge is None:
        return jsonify({"error": "Challenge not found"}), 404
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


@file_app.route("/challenges/update-bank-info-by-cs", methods=["POST"])
@bypass_csrf_protection
def update_challenge_bank_info():
    """Build-completion callback for a Challenge Bank item — same signature
    scheme as update_challenge_info(), kept as its own route/function rather
    than a branch inside that one so a bug here can never touch a live
    contest challenge's row, and vice versa."""
    secret_key_request = request.headers.get("SecretKey")
    if not secret_key_request:
        return jsonify({"error": "SecretKey is required"}), 400
    data = request.form.to_dict() or request.get_json()

    external_id = data.get("ChallengeId")
    if not external_id:
        return jsonify({"error": "ChallengeId is required"}), 400

    try:
        external_id_value = int(external_id)
    except (TypeError, ValueError):
        return jsonify({"error": "ChallengeId must be numeric"}), 400

    if external_id_value < CHALLENGE_BANK_ID_OFFSET:
        return jsonify({"error": "Challenge bank not found"}), 404
    bank_id = external_id_value - CHALLENGE_BANK_ID_OFFSET

    unix_time = data.get("UnixTime")
    deploy_status = data.get("ChallengeStatus")
    log_content = data.get("ChallengeLogs")

    try:
        unix_time_value = int(unix_time)
    except (TypeError, ValueError):
        return jsonify({"error": "UnixTime is required"}), 400

    if abs(int(time.time()) - unix_time_value) > MAX_SKEW_SECONDS:
        return jsonify({"error": "Request expired"}), 400

    data.pop("UnixTime", None)
    secret_key = create_secret_key(PRIVATE_KEY, unix_time, data)

    if not hmac.compare_digest(secret_key_request, secret_key):
        return jsonify({"error": "SecretKey is not correct"}), 400

    nonce_key = f"fctf:admin:secretkey-nonce:{secret_key}"
    try:
        first_use = redis_client.set(nonce_key, "1", nx=True, ex=MAX_SKEW_SECONDS * 2)
    except Exception as e:
        return jsonify({"error": f"Nonce store unavailable: {e}"}), 503

    if not first_use:
        return jsonify({"error": "SecretKey already used"}), 400

    bank = ChallengeBank.query.filter_by(id=bank_id).first()
    if bank is None:
        return jsonify({"error": "Challenge bank not found"}), 404

    if deploy_status in STATUS:
        deploy_history = ChallengeBankDeployHistory(
            challenge_bank_id=bank.id,
            deploy_status=deploy_status,
            log_content=log_content,
            deploy_at=datetime.utcnow(),
        )

        bank.last_update = datetime.utcnow()
        bank.image_link = data.get("ImageLink")
        bank.deploy_status = deploy_status

        try:
            db.session.add(deploy_history)
            db.session.commit()
            return jsonify({"message": "Challenge bank updated successfully"}), 200
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
