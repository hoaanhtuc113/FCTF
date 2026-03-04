from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
import shutil
import tempfile
import threading
import time
import zipfile

from flask import jsonify, render_template, request
import redis
import requests
from CTFd.constants.envvars import (
    API_URL_CONTROLSERVER,
    DEPLOYMENT_SERVICE_API,
    HOST_CACHE,
    PRIVATE_KEY,
    DATABASE_PORT,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASS,
    REDIS_DB,
    ARGO_WORKFLOWS_URL,
    ARGO_WORKFLOWS_TOKEN,
    UP_CHALLENGE_TEMPLATE,
    NFS_MOUNT_PATH,
    IMAGE_REPO,
    DOCKER_USERNAME,
)
import random 
    
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
    ChallengeVersion,
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
    raw_key = f"deploy_challenge_{challenge_id}_{team_id}"
    return raw_key

def get_workflow_key(challenge_id):
    key = f"challenge_up_workflow_{challenge_id}"
    return key

def get_workflow_name(challenge_id):
    key = get_workflow_key(challenge_id)
    workflow_name = redis_client.get(key)
    return workflow_name

def get_team_id_and_cache_key(user, challenge_id):
    if user.type != "user":
        team_id = -1
        cache_key = generate_cache_key(challenge_id, team_id)
    else:
        team_id = user.team_id
        cache_key = generate_cache_key(challenge_id, team_id)
    return team_id, cache_key

def prepare_start_challenge_payload(challenge, user_id, team_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY,
        unix_time,
        {
            "challengeId": challenge.id,
            "teamId": team_id,
            "userId": user_id,
        },
    )
    payload = {
        "challengeId": challenge.id,
        "teamId": team_id,
        "userId": user_id,
        "unixTime": unix_time, 
    }
    headers = {"SecretKey": secret_key}
    api_start = f"{DEPLOYMENT_SERVICE_API}/api/challenge/start"
    
    return payload, headers, api_start

def prepare_up_challenge_payload(challenge_id,path, image_tag):
    headers = { 
        "Authorization": f"Bearer {ARGO_WORKFLOWS_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "resourceKind": "WorkflowTemplate",
        "resourceName": UP_CHALLENGE_TEMPLATE,
        "submitOptions": {
            "entryPoint": "main",
            "parameters": [
                f"CHALLENGE_ID={challenge_id}",
                f"CHALLENGE_PATH={path}",
                f"IMAGE_TAG={image_tag}",
            ]
        }
    }
    api_url = f"{ARGO_WORKFLOWS_URL}/submit"
    return payload, headers, api_url

def challenge_start(payload, headers, api_start):
    try:
        redis_client.ping()
    except redis.ConnectionError as e:
        print(f"Redis connection failed: {e}")
        return jsonify({"error": "Redis connection failed"}), 400

    try:
        print("API Endpoint: " + api_start)
        print("Payload: " + json.dumps(payload, indent=2))
        print("Headers: " + json.dumps(headers, indent=2))

        # Luôn gửi request, không cần kiểm tra if payload
        response = requests.post(api_start, headers=headers, json=payload, timeout=30)
        
        print(f"Response Status Code: {response.status_code}")
        print(f"Response Text: {response.text}")

        res_data = response.json()

        if not res_data:
            return jsonify({"success": False, "message": "Empty response from server"}), 400

        print("Response start data: " + json.dumps(res_data))
        return res_data
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to API: {e}")
        return format_response({"message": "Connection url failed", "success": False, "status": 400}) 

def force_stop(user_id, challenge_id, team_id):
    team_name = "Preview"

    team = Teams.query.filter_by(id=team_id).first()
    if team:
        team_name = team.name

    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {
            "challengeId": challenge_id,
            "teamId": team_id,
            "userId": user_id
        }
    )
    payload = {
        "challengeId": challenge_id,
        "teamId": team_id,
        "userId": user_id,
        "unixTime": unix_time,
    }
    print(f"User {user_id} is forcing stop challenge {challenge_id} for team {team_name} ({team_id})")
    headers = {"Secretkey": secret_key}
    stop_url = f"{DEPLOYMENT_SERVICE_API}/api/challenge/stop"
    try:
        response = requests.post(stop_url,  headers=headers,json=payload)
        response_data = response.json()
        print(f"Force stop response: {response_data}")
        # if response_data.get("isSuccess") == True:
        #     redis_client.delete(cache_key)
        # else:
        #     raise Exception(response.get("message"))

        return response_data
    except requests.exceptions.RequestException as e:
        raise Exception(e)

def force_stop_all(user_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {
            "challengeId": 0,
            "teamId": -1,
            "userId": user_id
        }
    )
    payload = {
        "challengeId": 0,
        "teamId": -1,
        "userId": user_id,
        "unixTime": unix_time,
    }
    headers = {"Secretkey": secret_key}
    stop_url = f"{DEPLOYMENT_SERVICE_API}/api/challenge/stop-all"
    try:
        response = requests.post(stop_url,  headers=headers,json=payload)
        response_data = response.json()
        print(f"Force stop all response: {response_data}")

        return response_data
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
    raw_key_pattern = f"deploy_challenge_{challenge_id}_*"
    keys_to_delete = redis_client.scan_iter(raw_key_pattern)
    deleted_count = 0
    for key in keys_to_delete:
        redis_client.delete(key)
        deleted_count += 1
    print(f"Deleted {deleted_count} cache entries for challenge_id: {challenge_id}")


def handle_zip_file_upload(challenge, file_path, challenge_id):
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

def handle_challenge_upload(challenge, file_path, expose_port=None):
    """
    Handle the challenge upload process
    - Unzip the uploaded file
    - Upload folder to NFS_MOUNT_PATH directory
    """
    zip_filename = os.path.basename(file_path) 
    folder_name = os.path.splitext(zip_filename)[0] + f"-{challenge.id}" 
    safe_folder_name = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in folder_name)
    
    # Create temporary directory for extraction
    temp_dir = tempfile.mkdtemp()
    
    try:
        with open(file_path, "rb") as file:
            zip_content = file.read()
            
            try:
                with zipfile.ZipFile(io.BytesIO(zip_content)) as z:
                    if z.testzip() is not None:
                        return {"success": False, "error": "Invalid Zip file"}, 400
            except zipfile.BadZipFile:
                return {"success": False, "error": "Invalid zip file format"}, 400
        
        # Extract the zip file to temporary directory
        extract_path = os.path.join(temp_dir, f"challenge_{challenge.id}")
        os.makedirs(extract_path, exist_ok=True)
        
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)
        
        print(f"Extracted challenge files to: {extract_path}")
        
        # Create challenges directory if it doesn't exist
        challenges_dir = os.path.join(NFS_MOUNT_PATH, "challenges")
        os.makedirs(challenges_dir, exist_ok=True)
        
        # Define destination path using the zip file name
        nfs_destination = os.path.join(challenges_dir, safe_folder_name)
        
        # Remove existing directory if it exists
        if os.path.exists(nfs_destination):
            print(f"Removing existing challenge directory: {nfs_destination}")
            shutil.rmtree(nfs_destination)
        
        # Copy the extracted folder to NFS_MOUNT_PATH
        print(f"Copying challenge folder to: {nfs_destination}")
        shutil.copytree(extract_path, nfs_destination)
        challenge.deploy_file = nfs_destination
        print(f"Challenge folder copied successfully")
        
        # Find Dockerfile directory path (relative to challenges directory)
        dockerfile_path = None
        for root, dirs, files in os.walk(nfs_destination):
            if "Dockerfile" in files:
                # Get directory path relative to NFS_MOUNT_PATH (without Dockerfile filename)
                dockerfile_path = os.path.relpath(root, NFS_MOUNT_PATH)
                break
        
        if dockerfile_path is None:
            print(f"Warning: Dockerfile not found in {nfs_destination}")
            return {"success": False, "error": "Dockerfile not found in challenge folder"}, 400

        if expose_port is None:
            print(f"Warning: No exposed port found")
            return {"success": False, "error": "No exposed port found"}, 400

        # Update challenge status
        if challenge.deploy_status is None or challenge.deploy_status != "PENDING_DEPLOY":
            try:
                unix_time = str(int(time.time()))
                image_tag = f"challenge-{challenge.id}-{safe_folder_name}-{unix_time}"
                image_link = f"{DOCKER_USERNAME}/{IMAGE_REPO}:{image_tag}"

                object_image = {
                    "imageLink": image_link,
                    "exposedPort": expose_port,
                }

                payload, headers, api_url = prepare_up_challenge_payload(challenge.id,dockerfile_path, image_tag)
                response = requests.post(api_url, headers=headers, json=payload)

                if response.status_code != 200:
                    print(f"Error uploading challenge: {response.text}")
                    return {"success": False, "error": f"Deployment service error: {response.text}"}, 500
                    
                result = response.json()
                workflow_name = result.get("metadata", {}).get("name")

                redis_client.set(
                    f"{get_workflow_key(challenge.id)}",
                    workflow_name,
                    ex=86400  # TTL: 1 day
                )
                workflow_phase, started_at, estimated_duration = get_workflow_status(workflow_name)
                if workflow_phase is None:
                    return {"success": False, "error": "Error getting workflow status"}, 500

                print(f"Challenge {challenge.id} deployment started with workflow {workflow_name}, started at {started_at}")
                challenge.require_deploy = True
                challenge.deploy_status = "PENDING_DEPLOY"
                challenge.state = "hidden"
                challenge.image_link = json.dumps(object_image)

                # Auto-save challenge version
                try:
                    latest_version = (
                        ChallengeVersion.query
                        .filter_by(challenge_id=challenge.id)
                        .order_by(ChallengeVersion.version_number.desc())
                        .first()
                    )
                    next_version = (latest_version.version_number + 1) if latest_version else 1

                    # Deactivate all previous versions
                    ChallengeVersion.query.filter_by(
                        challenge_id=challenge.id
                    ).update({"is_active": False})

                    # Get current user ID from session
                    from flask import session as flask_session
                    current_user_id = flask_session.get("id", None)

                    new_version = ChallengeVersion(
                        challenge_id=challenge.id,
                        version_number=next_version,
                        image_link=json.dumps(object_image),
                        deploy_file=challenge.deploy_file,
                        cpu_limit=challenge.cpu_limit,
                        cpu_request=challenge.cpu_request,
                        memory_limit=challenge.memory_limit,
                        memory_request=challenge.memory_request,
                        use_gvisor=challenge.use_gvisor,
                        max_deploy_count=challenge.max_deploy_count,
                        is_active=True,
                        created_by=current_user_id,
                        notes=f"Auto-created on deploy: {image_tag}",
                    )
                    db.session.add(new_version)
                    print(f"Challenge version v{next_version} created for challenge {challenge.id}")
                except Exception as ver_err:
                    print(f"Warning: Failed to save challenge version: {ver_err}")

                db.session.commit()
                return {
                    "success": True,
                    "message": "Challenge folder uploaded successfully",
                    "challenge_id": challenge.id,
                    "workflow_name": workflow_name,
                    "workflow_phase": workflow_phase,
                    "estimated_duration": estimated_duration,
                    "started_at": started_at
                }, 200
                
            except Exception as e:
                print(f"Error updating challenge status: {e}")
                db.session.rollback()
                return {"success": False, "error": f"Error updating challenge status: {str(e)}"}, 500
        else:
            return {"success": False, "error": "Challenge already pending deploy"}, 400
            
    except Exception as e:
        challenge.deploy_status = "FILE_UPLOAD_FAILED"
        challenge.state = "hidden"
        db.session.commit()
        print(f"Error handling challenge upload: {e}")
        return {"success": False, "error": f"Error processing challenge upload: {str(e)}"}, 500
    finally:
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                print(f"Cleaned up temporary directory: {temp_dir}")
        except Exception as e:
            print(f"Error cleaning up temporary directory: {e}")
    
def get_workflow_status(workflow_name):
    """
    Get workflow status from Argo Workflows
    Returns: (workflow_phase, started_at, estimated_duration)
    """
    url = f"{ARGO_WORKFLOWS_URL}/{workflow_name}"
    headers = {
        "Authorization": f"Bearer {ARGO_WORKFLOWS_TOKEN}",
        "Content-Type": "application/json"
    }
    try:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Error getting workflow status: {response.status_code} - {response.text}")
            return None, None, None
        
        data = response.json()
        status = data.get("status", {})
        
        workflow_phase = status.get("phase","Running")
        started_at_str = status.get("startedAt")
        estimated_duration = status.get("estimatedDuration", 90)
        print(f"Workflow raw data {workflow_name}: phase={workflow_phase}, started={started_at_str}, duration={estimated_duration}s")
        started_at = datetime.now(timezone.utc)
        if started_at_str:
            try:
                started_at = datetime.fromisoformat(
                    started_at_str.replace('Z', '+00:00')
                ).astimezone(timezone.utc)
            except Exception as e:
                print(f"Error parsing startedAt: {e}")
                started_at = None
        print(f"Workflow response data {workflow_name}: phase={workflow_phase}, started={started_at}, duration={estimated_duration}s")
        return workflow_phase, (started_at.isoformat() if started_at else None), int(estimated_duration)
        
    except Exception as e:
        print(f"Error getting workflow status: {e}")
        return None, None, None

def get_workflow_logs(challenge_id, workflow_name, user_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {
            "challengeId": challenge_id,
            "teamId": -1,
            "userId": user_id
        }
    )
    payload = {
        "challengeId": challenge_id,
        "teamId": -1,
        "userId": user_id,
        "unixTime": unix_time,
    }
    headers = {"Secretkey": secret_key}
    
    if not workflow_name:
        return jsonify({"success": False, "message": "Workflow name not found for challenge"}), 404

    stop_url = f"{DEPLOYMENT_SERVICE_API}/api/challenge/deployment-logs/{workflow_name}"
    try:
        response = requests.post(stop_url,  headers=headers,json=payload)
        response_data = response.json()
        print(f"Get deployment logs response: {response_data}")

        return response_data
    except requests.exceptions.RequestException as e:
        raise Exception(e)

def get_challenge_pod_logs(challenge_id, team_id):
    if team_id is None:
        team_id = -1

    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {
            "challengeId": challenge_id,
            "teamId": team_id,
        }
    )
    payload = {
        "challengeId": challenge_id,
        "teamId": team_id,
        "unixTime": unix_time,
    }
    headers = {"SecretKey": secret_key}
    logs_url = f"{DEPLOYMENT_SERVICE_API}/api/challenge/pod-logs"
    try:
        response = requests.post(logs_url, headers=headers, json=payload)
        print(f"Get pod logs response status: {response.status_code}")
        
        if response.status_code == 200:
            response_data = response.json()
            # Extract logs from the nested data structure
            if response_data.get("success") and "data" in response_data:
                logs = response_data["data"].get("logs", "")
                return logs
            return response_data.get("logs", "")
        else:
            print(f"Get pod logs failed: {response.text}")
            response_data = response.json()
            logs = response_data.get("message", "")
            return logs
    except requests.exceptions.RequestException as e:
        print(f"Error getting pod logs: {e}")
        return str(e)

def get_challenge_request_logs(challenge_id, team_id):
    if team_id is None:
        team_id = -1

    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY, unix_time, {
            "challengeId": challenge_id,
            "teamId": team_id,
        }
    )
    payload = {
        "challengeId": challenge_id,
        "teamId": team_id,
        "unixTime": unix_time,
    }
    headers = {"SecretKey": secret_key}

    logs_url = f"{DEPLOYMENT_SERVICE_API}/api/challenge/request-logs"
    try:
        response = requests.post(logs_url, headers=headers, json=payload)
        print(f"Get request logs response status: {response.status_code}")

        if response.status_code == 200:
            response_data = response.json()
            if response_data.get("success") and "data" in response_data:
                logs = response_data["data"].get("logs", "")
                return logs
            return response_data.get("logs", "")

        print(f"Get request logs failed: {response.text}")
        response_data = response.json()
        return response_data.get("message", "")
    except requests.exceptions.RequestException as e:
        print(f"Error getting request logs: {e}")
        return str(e)

def start_challenge_status_checking(challenge_id, team_id):
    unix_time = str(int(time.time()))
    secret_key = create_secret_key(
        PRIVATE_KEY,
        unix_time,
        {
            "challengeId": challenge_id,
            "teamId": team_id,
        },
    )
    payload = {
        "challengeId": challenge_id,
        "teamId": team_id,
        "unixTime": unix_time, 
    }
    headers = {"SecretKey": secret_key}
    api_status = f"{DEPLOYMENT_SERVICE_API}/api/statuscheck/admin-start"

    try:
        response = requests.post(api_status, json=payload, headers=headers)

        if response.status_code != 200:
            return {"success": False, "message": "Failed to start status checking"}, 400
            
        result = response.json()
        return result
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to API: {e}")
        return {"success": False, "message": "Connection url failed"}, 400

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