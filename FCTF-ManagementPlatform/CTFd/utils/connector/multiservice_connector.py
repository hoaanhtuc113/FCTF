from datetime import datetime, timedelta
import hashlib
import io
import json
import os
import threading
import time
import zipfile

from flask import jsonify, render_template, request
import redis
import requests
from CTFd.constants.envvars import (
    API_URL_CONTROLSERVER,
    HOST_CACHE,
    PRIVATE_KEY,
    DATABASE_PORT,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASS,
    REDIS_DB,
    ARGO_WORKFLOWS_URL,
    ARGO_WORKFLOWS_TOKEN,
)
import random 
from CTFd.schemas.notifications import NotificationSchema
    
redis_client = redis.StrictRedis(
    host=f"{REDIS_HOST}",
    port=int(REDIS_PORT),
    password=REDIS_PASS,
    db=int(REDIS_DB),
    encoding="utf-8",
    decode_responses=True
)
from CTFd.models import (
    ChallengeFiles,
    Challenges,
    Teams,
    Tokens,
    Users,
    db,
)
def generate_cache_attempt_key(challenge_id, team_id):
    raw_key = f"challenge_status_{challenge_id}_{team_id}"
    return hashlib.md5(raw_key.encode()).hexdigest()


def get_token_from_header():
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    if auth_header.startswith("Bearer "):
        return auth_header.split("Bearer ")[1]
    return None


def create_secret_key(private_key: str, unix_time: int, data: dict) -> str:
    sorted_key = sorted(data.keys())
    combine_string = str(unix_time) + private_key
    for key in sorted_key:
        combine_string += str(data.get(key, "1"))
    return hashlib.md5(combine_string.encode()).hexdigest()


def generate_cache_key(challenge_id, team_id):
    raw_key = f"challenge_url_{challenge_id}_{team_id}"
    return raw_key


def get_team_id_and_cache_key(user, challenge_id, challenge_time):
    if user.type != "user":
        team_id = -1
        cache_key = generate_cache_key(challenge_id, team_id)
    else:
        team_id = user.team_id
        cache_key = generate_cache_key(challenge_id, team_id)
    return team_id, cache_key

def prepare_challenge_payload(challenge, user, team_id, challenge_time):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY,
        unix_time,
        {
            "ChallengeId": challenge.id,
            "TeamId": team_id,
            "TimeLimit": challenge_time,
            "ImageLink": challenge.image_link,
        },
    )
    payload = {
        "ChallengeId": challenge.id,
        "TeamId": team_id,
        "TimeLimit": challenge_time,
        "ImageLink": challenge.image_link,
        "UnixTime": unix_time,
    }
    headers = {"SecretKey": secret_key}
    api_start = f"{API_URL_CONTROLSERVER}/api/challenge/start"
    
    return payload, headers, api_start

def build_payload(chal_id, team_name, node_port):
    team_name = team_name.lower().replace(" ", "-")
    return {
    "workflow": {
        "metadata": {
            "generateName": f"start-challenge-{chal_id}-{team_name}",
            "namespace": "argo",
            "annotations": {
                "workflows.argoproj.io/description": "start challenge workflow"
            }
        },
        "spec": {
            "entrypoint": "main",
            "serviceAccountName": "argo-sa",
            "arguments": {
                "parameters": [
                    {"name": "APP_NAME", "value": f"{team_name}-chal-01-websecpro-chilp"},
                    {"name": "SERVICE_PORT", "value": "80"},
                    {"name": "CONTAINER_PORT", "value": "80"},
                    {"name": "NODE_PORT", "value": f"{str(node_port)}"},
                    {"name": "REPLICA_COUNT", "value": "1"},
                    {"name": "CONTAINER_IMAGE", "value": "quachuoiscontainer/kctf-chal-wsproblem:v01"},
                    {"name": "MEMORY_LIMIT", "value": "256Mi"},
                    {"name": "CPU_LIMIT", "value": "500m"},
                    {"name": "CPU_REQUEST", "value": "100m"},   
                    {"name": "MEMORY_REQUEST", "value": "128Mi"}
                ]
            },
            "templates": [
                {
                    "name": "main",
                    "steps": [
                        [{"name": "check-workspace", "template": "check-workspace"}],
                        [{"name": "deploy-challenge", "template": "deploy-challenge"}]
                    ]
                },
                {
                    "name": "check-workspace",
                    "container": {
                        "image": "quachuoiscontainer/kubectl-cli:v0.0.3",
                        "imagePullPolicy": "IfNotPresent",
                        "securityContext": {
                            "runAsUser": 0,
                            "runAsGroup": 0,
                            "runAsNonRoot": False,
                            "allowPrivilegeEscalation": True,
                            "privileged": True
                        },
                        "resources": {
                            "requests": {"memory": "256Mi", "cpu": "100m"},
                            "limits": {"memory": "512Mi", "cpu": "300m"}
                        },
                        "command": ["sh", "-c"],
                        "args": [
                            "echo \"=== Checking Argo Pod Workspace ===\"\n"
                            "echo \"Current directory: $(pwd)\"\n"
                            "echo \"Testing kubectl connection:\"\n"
                            "kubectl top nodes"
                        ]
                    }
                },
                {
                    "name": "deploy-challenge",
                    "container": {
                        "image": "quachuoiscontainer/kubectl-cli:v0.0.3",
                        "imagePullPolicy": "IfNotPresent",
                        "securityContext": {
                            "runAsUser": 0,
                            "runAsGroup": 0,
                            "runAsNonRoot": False,
                            "allowPrivilegeEscalation": True,
                            "privileged": True
                        },
                        "resources": {
                            "requests": {"memory": "256Mi", "cpu": "100m"},
                            "limits": {"memory": "512Mi", "cpu": "300m"}
                        },
                        "command": ["sh", "-c"],
                        "args": [
                            "set -e\n"
                            "echo \"=== Deploying Challenge with direct parameters ===\"\n\n"
                            "git clone https://github.com/fctf-git-repo/challenge-config.git\n"
                            "cd challenge-config/websecpro_chilp-1\n\n"
                            "export APP_NAME=\"{{workflow.parameters.APP_NAME}}\"\n"
                            "export SERVICE_PORT=\"{{workflow.parameters.SERVICE_PORT}}\"\n"
                            "export CONTAINER_PORT=\"{{workflow.parameters.CONTAINER_PORT}}\"\n"
                            "export NODE_PORT=\"{{workflow.parameters.NODE_PORT}}\"\n"
                            "export REPLICA_COUNT=\"{{workflow.parameters.REPLICA_COUNT}}\"\n"
                            "export CONTAINER_IMAGE=\"{{workflow.parameters.CONTAINER_IMAGE}}\"\n"
                            "export MEMORY_LIMIT=\"{{workflow.parameters.MEMORY_LIMIT}}\"\n"
                            "export CPU_LIMIT=\"{{workflow.parameters.CPU_LIMIT}}\"\n"
                            "export CPU_REQUEST=\"{{workflow.parameters.CPU_REQUEST}}\"\n"
                            "export MEMORY_REQUEST=\"{{workflow.parameters.MEMORY_REQUEST}}\"\n\n"
                            "envsubst < challenge.yaml | kubectl apply -f -\n\n"
                            "echo \"✅ Challenge manifest submitted to cluster\""
                        ]
                    }
                }
            ]
        }
    }
}
port_list = []
public_port = 30000
def randPort():
    while True:
        port = random.randint(30000,32767)
        if port not in port_list:
            port_list.append(port)
            return port

def getPort():
    global public_port
    if public_port > 32767:
        public_port = 30000
    else:
        public_port += 1

    if public_port == REDIS_PORT or public_port == DATABASE_PORT:
        public_port += 1
    return public_port

def challenge_start(payload, headers, api_start, challenge, challenge_time, cache_key, user_id, challenge_id, team):
    try:
        redis_client.ping()
    except redis.ConnectionError as e:
        print(f"Redis connection failed: {e}")
        return jsonify({"error": "Redis connection failed"}), 400

    try:
        print("API Endpoint: " + api_start)
        print(json.dumps(payload))
        print(json.dumps(headers))

        api_start = ARGO_WORKFLOWS_URL
        token = ARGO_WORKFLOWS_TOKEN
        port = getPort()
        print(f"Selected random port: {port}")
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",   # tùy chọn; requests sẽ tự set khi dùng json=
        }

        payload = build_payload(challenge.id, team.name, port)

        if payload:
            response = requests.post(api_start, headers=headers, json=payload, timeout=30)
        print("Response:"+ json.dumps(response.json()))
        print("Response status code: " + str(response.status_code))
        print("Response data: " + response.text)
        if(response.status_code == 200):
            return format_response({"success": True, "challenge_url": "Send to Argo Workflows to deploy successfully"})
        else :
            return format_response({"message": "Failed to start challenge deployment"})
        
        # res_data = response.json()
        # if res_data.get("isSuccess"):
        #     challenge_url = res_data.get("data")
        #     time_finished = datetime.now() + timedelta(minutes=challenge_time)
        #     db.session.commit()
        #     if challenge_time == -1 or team.id == -1:
        #         cache_expiry = None
        #     else:
        #         cache_expiry = challenge_time * 60
        #     try:
        #         redis_client.set(
        #             cache_key,
        #             json.dumps(
        #                 {"challenge_url": challenge_url, "user_id": user_id, "challenge_id": challenge_id, "time_finished": int(time_finished.timestamp())}
        #             ),
        #             ex=cache_expiry,
        #         )
        #         print(f"Cache saved: {cache_key} -> challenge_url: {challenge_url}, time_finished: {time_finished}")
        #         if challenge_time != -1:
        #             threading.Timer(
        #                 max(30, challenge_time * 60),
        #                 lambda: force_stop(cache_key, challenge_id, team.id),
        #             ).start()
        #     except Exception as e:
        #         print(f"Error saving to Redis: {e}")
        #         return jsonify({"error": "Failed to save cache"}), 400
        #     return format_response({"success": True, "challenge_url": challenge_url})
        # else:
        #     message = res_data.get("message")
        #     if res_data.get("data"):
        #         message += "<br><br>Running challenge is: "
        #         challenge_names = []
        #         for item in res_data.get("data"):
        #             challenges = Challenges.query.filter_by(id=item).first()
        #             if challenges is not None:
        #                 challenge_names.append(f"<b>{challenges.name}</b>")
        #         message += "<b>,</b> ".join(challenge_names)
        #     return format_response({"message": message})
    
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to API: {e}")
        return format_response({"message": "Connection url failed"})
def force_stop(cache_key, challenge_id, team_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {"ChallengeId": challenge_id, "TeamId": team_id}
    )

    payload = {
        "ChallengeId": challenge_id,
        "TeamId": team_id,
        "UnixTime": unix_time,
    }
    headers = {"Secretkey": secret_key}
    stop_url = f"{API_URL_CONTROLSERVER}/api/challenge/stop"
    try:
        response = requests.post(stop_url, data=payload, headers=headers)
        response.raise_for_status()
        response_data = response.json()
        if response_data.get("isSuccess") == True:
            redis_client.delete(cache_key)
        else:
            raise Exception(response.get("message"))
    except requests.exceptions.RequestException as e:
        raise Exception(e)
def format_response(data):
    return jsonify(data), 200

def redeploy(challenge_id):
    unix_time = int(time.time())
    data = {"ChallengeId": challenge_id}
    secret_key = create_secret_key(PRIVATE_KEY, unix_time, data)
    url = f"{API_URL_CONTROLSERVER}/api/challenge/redeploy"

    challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
    challenge.deploy_status = "DEPLOYING"
    db.session.commit()

    payload = {
        "ChallengeId": challenge_id,
        "UnixTime": unix_time,
    }
    try:
        response = requests.post(url, headers={"SecretKey": secret_key}, data=payload)
        response.raise_for_status()
        data = response.json()
        if response.status_code == 200:
            return (
                jsonify(
                    {
                        "message": "Challenge re-deployed successfully",
                    }
                ),
                200,
            )
        else:
            return jsonify({"error": data["message"]}), 500

    except requests.exceptions.RequestException as e:
        return jsonify({"error": "Connection failed"})
    
def delete_cached_files(challenge_id):
    raw_key_pattern = f"challenge_url_{challenge_id}_*"
    keys_to_delete = redis_client.scan_iter(raw_key_pattern)
    deleted_count = 0
    for key in keys_to_delete:
        redis_client.delete(key)
        deleted_count += 1
    print(f"Deleted {deleted_count} cache entries for challenge_id: {challenge_id}")


def create_notification_data(challenge_name):
    return {
        "title": f"The challenge '{challenge_name}' is being redeployed",
        "content": f"The challenge '{challenge_name}' is being redeployed. Please wait a few minutes",
        "date": time.time(),
        "html": f"<p>The challenge '<strong>{challenge_name}</strong>' is being redeployed. Please wait a few minutes</p>\n",
        "sound": True,
        "type": "toast",
    }


def handle_zip_file_upload(challenge, file_path, challenge_id, notification_data):
    """
    Handle the zip file upload process
    """
    with open(file_path, "rb") as file:
        zip_content = file.read()

        try:
            # Validate the zip file
            with zipfile.ZipFile(io.BytesIO(zip_content)) as z:
                if z.testzip() is not None:
                    return jsonify({"error": "Invalid Zip file"}), 400
        except zipfile.BadZipFile:
            return jsonify({"error": "Invalid zip file format"}), 400

        # Create secret key and make the upload request
        unix_time = int(time.time())
        secret_key = create_secret_key(PRIVATE_KEY, unix_time, {"ChallengeId": challenge_id})

        url = f"{API_URL_CONTROLSERVER}/api/challenge/upload"
        files = {"file": (os.path.basename(file_path), zip_content, "application/zip")}
        payload = {"ChallengeId": challenge_id, "UnixTime": unix_time}

        if challenge.deploy_status is None or challenge.deploy_status != "PENDING_DEPLOY":
            try:
                if(challenge.state != "hidden"):
                    print("Gui thong bao")
                    post_notification(notification_data)
                challenge.require_deploy = True
                challenge.deploy_status = "PENDING_DEPLOY"
                challenge.state = "hidden"
                db.session.commit()

                response = requests.post(url, headers={"SecretKey": secret_key}, data=payload, files=files)
            except Exception as e:
                print(f"Error uploading file: {e}")
                return jsonify({"error": "Error uploading file"}), 500

            return jsonify({"message": "File sent successfully", "challenge_id": challenge_id})

        else:
            return jsonify({"error": "Challenge already pending deploy"}), 400
        
def post_notification(notify_data):

    schema = NotificationSchema()
    result = schema.load(notify_data)
    if result.errors:
        return {"success": False, "errors": result.errors}, 400

    db.session.add(result.data)
    db.session.commit()

    response = schema.dump(result.data)

    # Grab additional settings
    notif_type = notify_data.get("type", "alert")
    notif_sound = notify_data.get("sound", True)
    response.data["type"] = notif_type
    response.data["sound"] = notif_sound
    return {"success": True}
def delete_challenge(challenge_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {"ChallengeId": challenge_id}
    )
    payload = {"ChallengeId": challenge_id, "UnixTime": unix_time}
    headers = {"Secretkey": secret_key}

    try:
        response = requests.post(
            f"{API_URL_CONTROLSERVER}/api/challenge/delete",
            data=payload,
            headers=headers,
        )
        response.raise_for_status() 

        response_data = response.json()
        if response_data.get("isSuccess"):
            delete_cached_files(challenge_id)
            return {"isSuccess": True, "message": "Challenge deleted successfully"}, 200
        else:
            return {"isSuccess": False, "message": response_data.get("message")}, 400

    except requests.exceptions.HTTPError as http_err:
        return {
            "isSuccess": False,
            "message": f"HTTP error occurred: {str(http_err)}",
        },400
    except requests.exceptions.RequestException as req_err:
        return {
            "isSuccess": False,
            "message": f"Request error occurred: {str(req_err)}",
        }, 400
def estimate_server():
        private_key = PRIVATE_KEY
        unix_time = int(datetime.now().timestamp())
        challenges = Challenges.query.filter(Challenges.require_deploy == True).all()
        challenge_ids = [challenge.id for challenge in challenges]
        team_count = request.form.get("team_count")
        if not team_count or not team_count.isdigit() or int(team_count) <= 0:
            return render_template(
                "admin/estimation.html", error="Please enter a valid number of teams."
            )

        team_count = int(team_count)

        if not challenge_ids:
            return render_template(
                "admin/estimate.html",
                error="No challenges require deployment.",
            )

        challenge_ids_comma_separated = (
            ",".join(str(id) for id in challenge_ids) if challenge_ids else "1"
        )

        data_scretkey = {
            "ChallengeIdList": challenge_ids_comma_separated,
            "TeamCount": team_count,
        }

        data_request = {
            "UnixTime": unix_time,
            "ChallengeIdList": challenge_ids,
            "TeamCount": team_count,
        }

        secret_key = create_secret_key(private_key, unix_time, data_scretkey)

        url = f"{API_URL_CONTROLSERVER}/api/performance/estimate"
        headers = {"SecretKey": secret_key}

        try:
            response = requests.post(url, headers=headers, data=data_request)
            response_data = response.json()
        except Exception as e:
            return render_template(
                "admin/estimation.html", error=f"Error connecting to API: {str(e)}"
            )

        if response_data.get("isSuccess"):
            return render_template(
                "admin/estimation.html",
                response=response_data.get("data"),
            )
        else:
            return render_template(
                "admin/estimation.html",
                error=response_data.get("message"),
            )
        
def monitoring_control():
    url = f"{API_URL_CONTROLSERVER}/api/performance/monitoring" 
    print("url: " + url)
    try:
        unix_time = int(time.time())
        private_key = PRIVATE_KEY
        payload = {"UnixTime": unix_time}
        secret_key = create_secret_key(private_key, unix_time, {})

        headers = {
        'SecretKey': secret_key,
        }

        response = requests.request("POST", url, headers=headers, data=payload)
        
        print(json.dumps(response.json()))

        if response.json().get("isSuccess"):
            result = response.json()
            performance_data = result["data"]
            formatted_data = []
            for entry in performance_data:
                challenge = Challenges.query.filter_by(id=entry["challengeId"]).first()
                team = Teams.query.filter_by(id=entry["teamId"]).first()
                challenge_name = challenge.name if challenge else "Unknown"
                team_name = team.name if team else "Admin / Challenge Writer"
                # Thêm dữ liệu vào danh sách đã format
                formatted_data.append(
                    {
                        "ChallengeName": challenge_name,
                        "TeamName": team_name,
                        "ChallengeId": entry["challengeId"],
                        "TeamId": entry["teamId"],
                        "CPUuse": entry["cpuUsage"],
                        "RamUse": entry["ramUsage"],
                    }
                )
            return jsonify(formatted_data), 200  # Trả về dữ liệu đã format
        else:
            return (
                jsonify({"error": "Failed to fetch performance data."}),
            )
    except Exception as e:
        return (
            jsonify(
                {"error": "An exception occurred while fetching performance data."}
            ),
            400,
        )