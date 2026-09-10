import re
import uuid
from datetime import datetime, timedelta, timezone

from flask import Blueprint, render_template, abort, request, flash, redirect, url_for, jsonify, session  # type: ignore

from CTFd.models import Challenges, ChallengeInstance, db, Users, DeployedChallenge
from CTFd.utils.decorators import admins_only, admin_or_challenge_writer_only_or_jury,is_jury,is_admin
from CTFd.utils.user import authed
from CTFd.utils.connector.multiservice_connector import (
    get_workflow_logs,
    get_challenge_pod_logs,
    get_instance_request_logs,
)
from CTFd.utils.logging.audit_logger import log_audit

challengeHistory = Blueprint("challengeHistory", __name__)


_INSTANCE_LOG_PROTOCOLS = {"http", "tcp"}
_INSTANCE_LOG_VALUE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")


def _parse_instance_log_time(value, label):
    if not value:
        return None, None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None, f"{label} must be an ISO-8601 timestamp."
    if parsed.tzinfo is None:
        return None, f"{label} must include a timezone."
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), None


def _parse_instance_log_filters():
    """Read only the bounded metadata filters accepted by the log API."""
    filters = {}
    from_value, error = _parse_instance_log_time(request.args.get("from"), "from")
    if error:
        return None, error
    to_value, error = _parse_instance_log_time(request.args.get("to"), "to")
    if error:
        return None, error
    if from_value:
        filters["from"] = from_value
    if to_value:
        filters["to"] = to_value
    if from_value and to_value:
        if datetime.fromisoformat(from_value.replace("Z", "+00:00")) > datetime.fromisoformat(to_value.replace("Z", "+00:00")):
            return None, "from must be before to."
        if datetime.fromisoformat(to_value.replace("Z", "+00:00")) - datetime.fromisoformat(from_value.replace("Z", "+00:00")) > timedelta(hours=24):
            return None, "The time range may not exceed 24 hours."

    def values(name, target, allowed=None):
        raw_values = [value.strip() for value in request.args.getlist(name) if value.strip()]
        if len(raw_values) > 10:
            return f"Too many {name} filters."
        if any(not _INSTANCE_LOG_VALUE.fullmatch(value) for value in raw_values):
            return f"Invalid {name} filter."
        if allowed and any(value not in allowed for value in raw_values):
            return f"Invalid {name} filter."
        if raw_values:
            filters[target] = raw_values
        return None

    for name, target, allowed in (
        ("protocol", "protocol", _INSTANCE_LOG_PROTOCOLS),
        ("event", "events", None),
        ("outcome", "outcome", None),
    ):
        error = values(name, target, allowed)
        if error:
            return None, error

    statuses = []
    for value in request.args.getlist("status"):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None, "status must be an HTTP status code."
        if not 100 <= parsed <= 599:
            return None, "status must be an HTTP status code."
        statuses.append(parsed)
    if len(statuses) > 10:
        return None, "Too many status filters."
    if statuses:
        filters["status"] = statuses

    actor_user_ref = (request.args.get("actor_user_ref") or "").strip()
    if actor_user_ref:
        if len(actor_user_ref) > 128 or not _INSTANCE_LOG_VALUE.fullmatch(actor_user_ref):
            return None, "Invalid actor filter."
        filters["actorUserRef"] = actor_user_ref
    return filters or None, None


def get_list_challenge_deploy(challenge_id):
    if not challenge_id:
        print("Error: Invalid challenge ID")
        return None
    else:
        deploy_challenges = (
            db.session.query(DeployedChallenge, Challenges)
            .join(Challenges, DeployedChallenge.challenge_id == Challenges.id)
            .filter(DeployedChallenge.challenge_id == challenge_id)
            .all()
        )
        print(deploy_challenges)
        return deploy_challenges


@challengeHistory.route("/deploy_History/<int:challenge_id>", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def view_deploy_history(challenge_id):
    challenge = Challenges.query.filter(Challenges.id == challenge_id).first_or_404()
    deployed_challenges = get_list_challenge_deploy(challenge_id)
    if not deployed_challenges:

        return render_template(
            "admin/challenges/deploy_history.html",
            challenge_id=challenge_id,
            deployed_challenges=None,
        )

    else:

        return render_template(
            "admin/challenges/deploy_history.html",
            challenge_id=challenge_id,
            deployed_challenges=deployed_challenges,
        )


@challengeHistory.route("/deploy_History/details/<int:id>", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def view_deploy_history_details(id):
    deployed_challenge = (
        db.session.query(DeployedChallenge)
        .join(Challenges, DeployedChallenge.challenge_id == Challenges.id)
        .filter(DeployedChallenge.id == id)
        .first()
    )

    print(deployed_challenge)

    log_content = deployed_challenge.log_content
    if not deployed_challenge:
        print(f"Not found deploy_detail of challenge {deployed_challenge.id}")
        return render_template(
            "admin/challenges/deploy_detail.html", id=id, deployed_challenge=None
        )
    else:
        print(f"Success get deploy detail of with id= {deployed_challenge.id}")
        return render_template(
            "admin/challenges/deploy_detail.html",
            id=id,
            deployed_challenge=deployed_challenge,
            log_content=log_content,
        )

@challengeHistory.route("/deploy_History/<int:id>/logs", methods=["Get"])
@admin_or_challenge_writer_only_or_jury
def get_deploy_logs(id):
    deployed_challenge = DeployedChallenge.query.filter(DeployedChallenge.id == id).first()
    user_id = session["id"]
    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"error": "User Not found"}), 403

    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400

    if not deployed_challenge:
        return jsonify({"success": False, "log_content": "Deploy record not found."}), 404

    return get_workflow_logs(deployed_challenge.challenge_id, deployed_challenge.log_content, user_id)

@challengeHistory.route("/deploy_History/<int:challenge_id>/pods-logs", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_pods_logs(challenge_id):
    user_id = session["id"]
    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"error": "User Not found"}), 403

    if user.type == "user":
        return jsonify({"error": "Permission denied"}), 400

    team_id = -1
    team_id_param = request.args.get("team_id")
    if team_id_param is not None:
        try:
            team_id = int(team_id_param)
        except ValueError:
            return jsonify({"error": "Invalid team_id"}), 400
    logs = get_challenge_pod_logs(challenge_id, team_id)

    return render_template(
        "admin/challenges/pod_logs.html",
        challenge_id=challenge_id,
        log_content=logs,
    )


@challengeHistory.route("/deploy_History/<int:challenge_id>/pods-logs-api", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_pods_logs_api(challenge_id):
    """API endpoint to fetch pod logs as JSON (used by refresh button)."""
    user_id = session["id"]
    user = Users.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"success": False, "error": "User not found"}), 403

    if user.type == "user":
        return jsonify({"success": False, "error": "Permission denied"}), 400

    team_id = -1
    team_id_param = request.args.get("team_id")
    if team_id_param is not None:
        try:
            team_id = int(team_id_param)
        except ValueError:
            return jsonify({"success": False, "error": "Invalid team_id"}), 400

    logs = get_challenge_pod_logs(challenge_id, team_id)

    return jsonify({"success": True, "logs": logs}), 200


@challengeHistory.route("/deploy_History/<int:challenge_id>/instances/<instance_id>/request-logs", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_instance_request_logs_page(challenge_id, instance_id):
    try:
        parsed_instance_id = str(uuid.UUID(instance_id))
    except ValueError:
        abort(404)

    instance = ChallengeInstance.query.filter_by(
        instance_id=parsed_instance_id, challenge_id=challenge_id
    ).first_or_404()
    return render_template("admin/challenges/request_logs.html", instance=instance)


@challengeHistory.route("/deploy_History/<int:challenge_id>/instances/<instance_id>/request-logs-api", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_instance_request_logs_api(challenge_id, instance_id):
    try:
        parsed_instance_id = str(uuid.UUID(instance_id))
    except ValueError:
        return jsonify({"success": False, "message": "Instance was not found."}), 404

    instance = ChallengeInstance.query.filter_by(
        instance_id=parsed_instance_id, challenge_id=challenge_id
    ).first_or_404()
    filters, error = _parse_instance_log_filters()
    if error:
        return jsonify({"success": False, "message": error}), 400
    cursor = request.args.get("cursor") or None
    limit = request.args.get("limit", 50)
    response, status = get_instance_request_logs(
        instance.instance_id,
        cursor=cursor,
        limit=limit,
        filters=filters,
    )
    data = response.get("data") if isinstance(response, dict) else None
    events = data.get("events", []) if isinstance(data, dict) else []
    log_audit(
        "view_instance_logs",
        data={
            "challenge_id": instance.challenge_id,
            "contest_id": instance.contest_id,
            "filters": filters or {},
            "event_count": len(events) if isinstance(events, list) else 0,
            "source_status": (data or {}).get("sourceStatus", (data or {}).get("source_status", "unavailable" if status >= 500 else "healthy")),
        },
        contest_id=instance.contest_id,
        target_ref=instance.instance_id,
    )
    return jsonify(response), status
