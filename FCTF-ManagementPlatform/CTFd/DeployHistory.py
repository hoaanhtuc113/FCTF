from flask import Blueprint, render_template, abort, request, flash, redirect, url_for, jsonify, session  # type: ignore

from CTFd.models import Challenges, db, Users, DeployedChallenge
from CTFd.utils.decorators import admins_only, admin_or_challenge_writer_only_or_jury,is_jury,is_admin
from CTFd.utils.user import authed
from CTFd.utils.connector.multiservice_connector import (
    get_workflow_logs,
    get_challenge_pod_logs
)

challengeHistory = Blueprint("challengeHistory", __name__)


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

    team_id = user.team_id if user.team_id is not None else -1
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