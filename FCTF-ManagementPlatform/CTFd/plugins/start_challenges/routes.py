import time
from flask import Blueprint, jsonify, request
from CTFd.models import Challenges, DeployedChallenge, db
from datetime import datetime
import logging
from flask_cors import CORS  # type: ignore
import requests
import hashlib
from CTFd.plugins import bypass_csrf_protection

from CTFd.constants.envvars import PRIVATE_KEY


logging.basicConfig(
    level=logging.INFO,  # Set to INFO level
    format="%(asctime)s - %(levelname)s - %(message)s",
)


start_challenge_api = Blueprint("start_challenge_api", __name__, url_prefix="/api/v1")


def create_secret_key(
    private_key: str, unix_time: int, data: dict, default_value: str = "1"
) -> str:
    sorted_key = sorted(data.keys())
    combineString = str(unix_time) + private_key

    for key in sorted_key:
        combineString += str(data.get(key, default_value))
    print(f"RAW KEY DATA: {combineString}")
    md5_hash = hashlib.md5(combineString.encode()).hexdigest()
    return md5_hash


@start_challenge_api.route("/start_challenge/<int:challenge_id>", methods=["POST"])
@bypass_csrf_protection
def start_challenge(challenge_id):

    url = "{API_URL_CONTROLSERVER}/portForwardChallenge/web_chal_demo"

    try:
        user_id = request.json.get("user_id")

        unix_time = int(time.time())

        private_key = PRIVATE_KEY
        data = {"challengeId": challenge_id}
        secret_key = create_secret_key(private_key, unix_time, data)

        payload = {
            "challengeId": challenge_id,
            "user_id": user_id,
            "unixTime": unix_time,
        }
        # response = requests.post(
        #     url,
        #     headers={"SecretKey": secret_key},
        #     data=payload,)
        # response = requests.post(url)

        # res_data = response.json()

        challenge_url = f"http://demo.challenge.{challenge_id}"
        # data = response.json()
        # print('Response JSON:', data)

        # challenge_url = res_data["output"]
        challenge = Challenges.query.filter_by(id=challenge_id).first()

        logStart = DeployedChallenge.query.filter_by(challenge_id=challenge.id).first()
        # logContent = res_data["logContent"]
        # logStart.log_content = logContent

        challenge.connection_info = challenge_url
        db.session.commit()
        # if data.get('success'):
        #     challenge_url = data.get('challenge_url')
        #     print(f"Challenge URL: {challenge_url}")

        if challenge_url:
            challenge = Challenges.query.filter_by(id=challenge_id).first()
            challenge.connection_info = challenge_url
            db.session.commit()
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Challenge started",
                        "challenge_url": challenge_url,
                    }
                ),
                200,
            )
        else:

            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Challenge started, but no URL returned.",
                    }
                ),
                500,
            )

    except requests.exceptions.RequestException as e:

        print(f"Error occurred: {e}")

        return (
            jsonify(
                {
                    "success": False,
                    "message": "Control server is not available. Please try again later.",
                }
            ),
            503,
        )

    except ValueError:

        return (
            jsonify(
                {"success": False, "message": "Invalid response from control server."}
            ),
            500,
        )


# @start_challenge_api.route("/stop_challenge/<int:challenge_id>", methods=["POST"])
# def stop_challenge(challenge_id):
#     try: 
#         stop_challenge_url= "{API_URL_CONTROLSERVER}/api/challenge/stop"

#         unix_time = int(time.time())

#         private_key = PRIVATE_KEY
#         data = {"challengeId": challenge_id}
#         secret_key = create_secret_key(private_key, unix_time, data)
#     except requests.RequestException as e:



   