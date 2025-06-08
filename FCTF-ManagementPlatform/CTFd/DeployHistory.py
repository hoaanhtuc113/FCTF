from flask import Blueprint, render_template, abort, request, flash, redirect, url_for, jsonify  # type: ignore

from CTFd.models import Challenges, db, Users, DeployedChallenge
from CTFd.utils.decorators import admins_only, admin_or_challenge_writer_only_or_jury,is_jury,is_admin
from CTFd.utils.user import authed

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
