import hashlib
import json
import time
from typing import List

import requests  # noqa: I001

from flask import abort, jsonify, render_template, request, session, url_for
from flask_restx import Namespace, Resource
from CTFd.utils.notifications import notify_to_contestant
import redis
from CTFd.StartChallenge import create_secret_key, generate_cache_key
from CTFd.constants.envvars import API_URL_CONTROLSERVER, HOST_CACHE, PRIVATE_KEY
from sqlalchemy.sql import and_

from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.cache import clear_challenges, clear_standings
from CTFd.constants import RawEnum
from CTFd.models import (
    ChallengeFiles as ChallengeFilesModel,
    Teams,
    Tokens,
    Users,
    DeployedChallenge,
)
from CTFd.models import Challenges
from CTFd.models import ChallengeTopics as ChallengeTopicsModel
from CTFd.models import Fails, Flags, Hints, HintUnlocks, Solves, Submissions, Tags, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.schemas.challenges import ChallengeSchema
from CTFd.schemas.flags import FlagSchema
from CTFd.schemas.hints import HintSchema
from CTFd.schemas.tags import TagSchema
from CTFd.utils import config, get_config
from CTFd.utils import user as current_user
from CTFd.utils.challenges import (
    get_all_challenges,
    get_solve_counts_for_challenges,
    get_solve_ids_for_user_id,
    get_solves_for_challenge_id,
)
from CTFd.utils.config.visibility import (
    accounts_visible,
    challenges_visible,
    scores_visible,
)
from CTFd.utils.dates import ctf_ended, ctf_paused, ctftime
from CTFd.utils.decorators import (
    admin_or_challenge_writer_only_or_jury,
    admins_only,
    during_ctf_time_only,
    require_verified_emails,
)
from CTFd.utils.decorators.visibility import (
    check_account_visibility,
    check_challenge_visibility,
    check_score_visibility,
)
from CTFd.utils.humanize.words import pluralize
from CTFd.utils.logging import log
from CTFd.utils.security.signing import serialize
from CTFd.utils.user import (
    authed,
    get_current_team,
    get_current_team_attrs,
    get_current_user,
    get_current_user_attrs,
    is_admin,
    is_challenge_writer,
    is_jury,
)

from CTFd.plugins import bypass_csrf_protection
from CTFd.utils.connector.multiservice_connector import delete_challenge, force_stop

challenges_namespace = Namespace(
    "challenges", description="Endpoint to retrieve Challenges"
)

ChallengeModel = sqlalchemy_to_pydantic(
    Challenges, include={"solves": int, "solved_by_me": bool}
)
TransientChallengeModel = sqlalchemy_to_pydantic(Challenges, exclude=["id"])


class ChallengeDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: ChallengeModel


class ChallengeListSuccessResponse(APIListSuccessResponse):
    data: List[ChallengeModel]


challenges_namespace.schema_model(
    "ChallengeDetailedSuccessResponse", ChallengeDetailedSuccessResponse.apidoc()
)

challenges_namespace.schema_model(
    "ChallengeListSuccessResponse", ChallengeListSuccessResponse.apidoc()
)

redis_client = redis.StrictRedis(
    host=f"{HOST_CACHE}", port=6379, db=0, encoding="utf-8", decode_responses=True
)


@challenges_namespace.route("")
class ChallengeList(Resource):
    @check_challenge_visibility
    @during_ctf_time_only
    @require_verified_emails
    @challenges_namespace.doc(
        description="Endpoint to get Challenge objects in bulk",
        responses={
            200: ("Success", "ChallengeListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    @validate_args(
        {
            "name": (str, None),
            "max_attempts": (int, None),
            "value": (int, None),
            "category": (str, None),
            "type": (str, None),
            "state": (str, None),
            "q": (str, None),
            "field": (
                RawEnum(
                    "ChallengeFields",
                    {
                        "name": "name",
                        "description": "description",
                        "category": "category",
                        "type": "type",
                        "state": "state",
                    },
                ),
                None,
            ),
        },
        location="query",
    )
    def get(self, query_args):
        # Require a team if in teams mode
        # TODO: Convert this into a re-useable decorator
        # TODO: The require_team decorator doesnt work because of no admin passthru
        if get_current_user_attrs():
            if is_admin() or is_challenge_writer() or is_jury:
                pass
            else:
                if config.is_teams_mode() and get_current_team_attrs() is None:
                    abort(403)

        # Build filtering queries
        q = query_args.pop("q", None)
        field = str(query_args.pop("field", None))

        # Admins get a shortcut to see all challenges despite pre-requisites
        admin_view = is_admin() and request.args.get("view") == "admin"

        # Get a cached mapping of challenge_id to solve_count
        solve_counts = get_solve_counts_for_challenges(admin=admin_view)

        # Get list of solve_ids for current user
        if authed():
            user = get_current_user()
            user_solves = get_solve_ids_for_user_id(user_id=user.id)
        else:
            user_solves = set()

        # Aggregate the query results into the hashes defined at the top of
        # this block for later use
        if scores_visible() and accounts_visible():
            solve_count_dfl = 0
        else:
            # Empty out the solves_count if we're hiding scores/accounts
            solve_counts = {}
            # This is necessary to match the challenge detail API which returns
            # `None` for the solve count if visiblity checks fail
            solve_count_dfl = None

        chal_q = get_all_challenges(admin=admin_view, field=field, q=q, **query_args)

        # Iterate through the list of challenges, adding to the object which
        # will be JSONified back to the client
        response = []
        tag_schema = TagSchema(view="user", many=True)

        # Gather all challenge IDs so that we can determine invalid challenge prereqs
        all_challenge_ids = {
            c.id for c in Challenges.query.with_entities(Challenges.id).all()
        }
        for challenge in chal_q:
            if challenge.requirements:
                requirements = challenge.requirements.get("prerequisites", [])
                anonymize = challenge.requirements.get("anonymize")
                prereqs = set(requirements).intersection(all_challenge_ids)
                if user_solves >= prereqs or admin_view:
                    pass
                else:
                    if anonymize:
                        response.append(
                            {
                                "id": challenge.id,
                                "type": "hidden",
                                "name": "???",
                                "value": 0,
                                "solves": None,
                                "solved_by_me": False,
                                "category": "???",
                                "tags": [],
                                "template": "",
                                "script": "",
                            }
                        )
                    # Fallthrough to continue
                    continue

            try:
                challenge_type = get_chal_class(challenge.type)
                print(challenge.requirements)
            except KeyError:
                # Challenge type does not exist. Fall through to next challenge.
                continue

            # Challenge passes all checks, add it to response
            response.append(
                {
                    "id": challenge.id,
                    "type": challenge_type.name,
                    "name": challenge.name,
                    "value": challenge.value,
                    "solves": solve_counts.get(challenge.id, solve_count_dfl),
                    "solved_by_me": challenge.id in user_solves,
                    "category": challenge.category,
                    "tags": tag_schema.dump(challenge.tags).data,
                    "template": challenge_type.templates["view"],
                    "script": challenge_type.scripts["view"],
                }
            )

        db.session.close()
        return {"success": True, "data": response}

    @admin_or_challenge_writer_only_or_jury
    @challenges_namespace.doc(
        description="Endpoint to create a Challenge object",
        responses={
            200: ("Success", "ChallengeDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def post(self):
        data = request.form or request.get_json()

        # Load data through schema for validation but not for insertion
        schema = ChallengeSchema()
        response = schema.load(data)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        challenge_type = data["type"]
        challenge_class = get_chal_class(challenge_type)
        challenge = challenge_class.create(request)
        response = challenge_class.read(challenge)

        clear_challenges()

        return {"success": True, "data": response}


@challenges_namespace.route("/types")
class ChallengeTypes(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        response = {}

        for class_id in CHALLENGE_CLASSES:
            challenge_class = CHALLENGE_CLASSES.get(class_id)
            response[challenge_class.id] = {
                "id": challenge_class.id,
                "name": challenge_class.name,
                "templates": challenge_class.templates,
                "scripts": challenge_class.scripts,
                "create": render_template(
                    challenge_class.templates["create"].lstrip("/")
                ),
            }
        return {"success": True, "data": response}


@challenges_namespace.route("/<challenge_id>")
class Challenge(Resource):
    @check_challenge_visibility
    @during_ctf_time_only
    @require_verified_emails
    @challenges_namespace.doc(
        description="Endpoint to get a specific Challenge object",
        responses={
            200: ("Success", "ChallengeDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def get(self, challenge_id):
        if is_admin() or is_challenge_writer() or is_jury():
            chal = Challenges.query.filter(Challenges.id == challenge_id).first_or_404()
        else:
            chal = Challenges.query.filter(
                Challenges.id == challenge_id,
                and_(Challenges.state != "hidden", Challenges.state != "locked"),
            ).first_or_404()

        try:
            chal_class = get_chal_class(chal.type)
        except KeyError:
            abort(
                500,
                f"The underlying challenge type ({chal.type}) is not installed. This challenge can not be loaded.",
            )

        if chal.requirements:
            requirements = chal.requirements.get("prerequisites", [])
            anonymize = chal.requirements.get("anonymize")
            # Gather all challenge IDs so that we can determine invalid challenge prereqs
            all_challenge_ids = {
                c.id for c in Challenges.query.with_entities(Challenges.id).all()
            }
            if challenges_visible():
                user = get_current_user()
                if user:
                    solve_ids = (
                        Solves.query.with_entities(Solves.challenge_id)
                        .filter_by(account_id=user.account_id)
                        .order_by(Solves.challenge_id.asc())
                        .all()
                    )
                else:
                    # We need to handle the case where a user is viewing challenges anonymously
                    solve_ids = []
                solve_ids = {value for value, in solve_ids}
                prereqs = set(requirements).intersection(all_challenge_ids)
                if (
                    solve_ids >= prereqs
                    or is_admin()
                    or is_challenge_writer()
                    or is_jury()
                ):
                    pass
                else:
                    if anonymize:
                        return {
                            "success": True,
                            "data": {
                                "id": chal.id,
                                "type": "hidden",
                                "name": "???",
                                "value": 0,
                                "solves": None,
                                "solved_by_me": False,
                                "category": "???",
                                "tags": [],
                                "template": "",
                                "script": "",
                            },
                        }
                    abort(403)
            else:
                abort(403)

        tags = [
            tag["value"] for tag in TagSchema("user", many=True).dump(chal.tags).data
        ]

        unlocked_hints = set()
        hints = []
        if authed():
            user = get_current_user()
            team = get_current_team()

            # TODO: Convert this into a re-useable decorator
            if is_admin() or is_challenge_writer() or is_jury():
                pass
            else:
                if config.is_teams_mode() and team is None:
                    abort(403)

            unlocked_hints = {
                u.target
                for u in HintUnlocks.query.filter_by(
                    type="hints", account_id=user.account_id
                )
            }
            files = []
            for f in chal.files:
                token = {
                    "user_id": user.id,
                    "team_id": team.id if team else None,
                    "file_id": f.id,
                }
                files.append(
                    url_for("views.files", path=f.location, token=serialize(token))
                )
        else:
            files = [url_for("views.files", path=f.location) for f in chal.files]

        for hint in Hints.query.filter_by(challenge_id=chal.id).all():
            if hint.id in unlocked_hints or ctf_ended():
                hints.append(
                    {"id": hint.id, "cost": hint.cost, "content": hint.content}
                )
            else:
                hints.append({"id": hint.id, "cost": hint.cost})

        response = chal_class.read(challenge=chal)

        # Get list of solve_ids for current user
        if authed():
            user = get_current_user()
            user_solves = get_solve_ids_for_user_id(user_id=user.id)
        else:
            user_solves = []

        solves_count = get_solve_counts_for_challenges(challenge_id=chal.id)
        if solves_count:
            challenge_id = chal.id
            solve_count = solves_count.get(chal.id)
            solved_by_user = challenge_id in user_solves
        else:
            solve_count, solved_by_user = 0, False

        # Hide solve counts if we are hiding solves/accounts
        if scores_visible() is False or accounts_visible() is False:
            solve_count = None

        if authed():
            # Get current attempts for the user
            attempts = Submissions.query.filter_by(
                account_id=user.account_id, challenge_id=challenge_id
            ).count()
        else:
            attempts = 0

        response["solves"] = solve_count
        response["solved_by_me"] = solved_by_user
        response["attempts"] = attempts
        response["files"] = files
        response["tags"] = tags
        response["hints"] = hints

        response["view"] = render_template(
            chal_class.templates["view"].lstrip("/"),
            solves=solve_count,
            solved_by_me=solved_by_user,
            files=files,
            tags=tags,
            hints=[Hints(**h) for h in hints],
            max_attempts=chal.max_attempts,
            attempts=attempts,
            challenge=chal,
        )

        db.session.close()
        print("challenge response")
        print(response)
        return {"success": True, "data": response}

    @admin_or_challenge_writer_only_or_jury
    @challenges_namespace.doc(
        description="Endpoint to edit a specific Challenge object",
        responses={
            200: ("Success", "ChallengeDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def patch(self, challenge_id):
        data = request.get_json()
        # Load data through schema for validation but not for insertion
        schema = ChallengeSchema()
        data["user_id"] = session["id"]
        response = schema.load(data)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        user_id = session["id"]
        user = Users.query.filter_by(id=user_id).first()
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()

        # Debugging logs
        print(f"Challenge user_id: {challenge.user_id}")
        print(f"Current user's user_id: {user_id}")

        if user.type == "admin":
            pass
        elif user.type == "challenge_writer":
            if challenge.user_id != user_id:
                return {
                    "success": False,
                    "error": "You are not authorized to update this challenge.",
                }, 403
        else:
            return {"success": False, "error": "Unauthorized user type."}, 403

        challenge_class = get_chal_class(challenge.type)
        challenge = challenge_class.update(challenge, request)
        response = challenge_class.read(challenge)
        notify_to_contestant(notif_type = "toast", 
                             notif_sound = True,
                             notif_title= "Thông báo từ ban quản trị",
                             notif_message= f"Thử thách '{challenge.name}' vừa được cập nhật.")

        clear_standings()
        clear_challenges()

        return {"success": True, "data": response}

    @admin_or_challenge_writer_only_or_jury
    @challenges_namespace.doc(
        description="Endpoint to delete a specific Challenge object",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self, challenge_id):
        DeployedChallenge.query.filter_by(challenge_id=challenge_id).delete()

        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        if challenge.require_deploy:
            if challenge.deploy_status != "PENDING_DEPLOY":
                delete_response, status_code = delete_challenge(challenge_id)
                if status_code != 200 or not delete_response.get("isSuccess"):
                    return {
                        "isSuccess": False,
                        "message": delete_response.get("message"),
                    }, status_code
            else:
                pass

        chal_class = get_chal_class(challenge.type)
        chal_class.delete(challenge)
        clear_standings()
        clear_challenges()
        
        notify_to_contestant(notif_type = "toast", 
                             notif_sound = True,
                             notif_title= "Thông báo từ ban quản trị",
                             notif_message= f"Thử thách '{challenge.name}' vừa bị xóa bỏ.")

        return {"success": True}


# redis_client = redis.StrictRedis(
#     host="cache", port=6379, db=0, encoding="utf-8", decode_responses=True
# )


def generate_cache_attempt_key(challenge_id, team_id):
    raw_key = f"challenge_status_{challenge_id}_{team_id}"
    return hashlib.md5(raw_key.encode()).hexdigest()


def get_token_from_header():
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None

    # Authorization should be in the form: "Bearer <token>"
    if auth_header.startswith("Bearer "):
        return auth_header.split("Bearer ")[1]
    return None


@challenges_namespace.route("/attempt")
class ChallengeAttempt(Resource):
    @during_ctf_time_only
    @bypass_csrf_protection
    def post(self):
        print("Chay vao day")
        auth_header = get_token_from_header()
        if not auth_header:
            return jsonify({"message": "Authorization missing"}), 403

        if request.is_json:
            request_data = request.get_json()
        else:
            request_data = request.form

        challenge_id = request_data.get("challengeId") or request_data.get(
            "challenge_id"
        )

        # Kiểm tra nếu dữ liệu cache không tồn tại
        token = Tokens.query.filter_by(value=auth_header).first()
        if token is None:
            return jsonify({"error": "Token not found"}), 404

        user = Users.query.filter_by(id=token.user_id).first()
        if user is None:
            return jsonify({"error": "User not found"}), 404

        team_id = user.team_id
        if not challenge_id:
            return jsonify({"error": "ChallengeId is required"}), 400

        challenge = Challenges.query.filter_by(id=challenge_id).first()
        if not challenge:
            return jsonify({"error": "Challenge not found"}), 400

        # cache_name = f"challenge:{challenge_id}:team_id:{team_id}"

        # # Kiểm tra nếu dữ liệu cache có tồn tại và khớp với dữ liệu đã tạo trước đó
        # cached_data = redis_client.hget(cache_name, team_id)
        # print(f"Cache data: {cached_data}")
        # if cached_data != generated_token:
        #     return jsonify({"error": "Cache mismatch or challenge not started"}), 403

        # Xóa dữ liệu cache để ngăn người dùng gửi lại mà không cần kiểm tra lại

        if (
            current_user.is_admin()
            or current_user.is_challenge_writer()
            or current_user.is_jury()
        ):
            preview = request.args.get("preview", False)
            if preview:
                challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
                chal_class = get_chal_class(challenge.type)
                status, message = chal_class.attempt(challenge, request)

                return {
                    "success": True,
                    "data": {
                        "status": "correct" if status else "incorrect",
                        "message": message,
                    },
                }

        if ctf_paused():

            return (
                {
                    "success": True,
                    "data": {
                        "status": "paused",
                        "message": "{} is paused".format(config.ctf_name()),
                    },
                },
                403,
            )

        # user = get_current_user()
        # team = get_current_team()

        team = Teams.query.filter_by(id=team_id).first()
        # TODO: Convert this into a re-useable decorator
        if config.is_teams_mode() and team is None:
            abort(403)

        fails = Fails.query.filter_by(
            account_id=user.account_id, challenge_id=challenge_id
        ).count()

        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()

        if challenge.state == "hidden":
            abort(404)

        if challenge.state == "locked":
            abort(403)

        if challenge.requirements:
            requirements = challenge.requirements.get("prerequisites", [])
            solve_ids = (
                Solves.query.with_entities(Solves.challenge_id)
                .filter_by(account_id=user.account_id)
                .order_by(Solves.challenge_id.asc())
                .all()
            )
            solve_ids = {solve_id for solve_id, in solve_ids}
            # Gather all challenge IDs so that we can determine invalid challenge prereqs
            all_challenge_ids = {
                c.id for c in Challenges.query.with_entities(Challenges.id).all()
            }
            prereqs = set(requirements).intersection(all_challenge_ids)
            if solve_ids >= prereqs:
                pass
            else:
                abort(403)

        chal_class = get_chal_class(challenge.type)

        # Anti-bruteforce / submitting Flags too quickly
        kpm = current_user.get_wrong_submissions_per_minute(user.account_id)
        kpm_limit = int(get_config("incorrect_submissions_per_min", default=10))
        if kpm > kpm_limit:
            if ctftime():
                chal_class.fail(
                    user=user, team=team, challenge=challenge, request=request
                )
            log(
                "submissions",
                "[{date}] {name} submitted {submission} on {challenge_id} with kpm {kpm} [TOO FAST]",
                name=user.name,
                submission=request_data.get("submission", "").encode("utf-8"),
                challenge_id=challenge_id,
                kpm=kpm,
            )
            # Submitting too fast
            return (
                {
                    "success": True,
                    "data": {
                        "status": "ratelimited",
                        "message": "You're submitting flags too fast. Slow down.",
                    },
                },
                429,
            )

        solves = Solves.query.filter_by(
            account_id=user.account_id, challenge_id=challenge_id
        ).first()

        # Challenge not solved yet
        if not solves:
            # Hit max attempts
            max_tries = challenge.max_attempts
            if max_tries and fails >= max_tries >= 0:
                return (
                    {
                        "success": True,
                        "data": {
                            "status": "incorrect",
                            "message": "You have 0 tries remaining",
                        },
                    },
                    400,
                )

            status, message = chal_class.attempt(challenge, request)

            if status:
                print("Print hello")  # The challenge plugin says the input is right
                if (
                    ctftime()
                    or current_user.is_admin()
                    or current_user.is_challenge_writer()
                    or current_user.is_jury()
                ):
                    chal_class.solve(
                        user=user, team=team, challenge=challenge, request=request
                    )

                    clear_standings()
                    clear_challenges()
                    cache_key = generate_cache_attempt_key(challenge_id, team_id)

                log(
                    "submissions",
                    "[{date}] {name} submitted {submission} on {challenge_id} with kpm {kpm} [CORRECT]",
                    name=user.name,
                    submission=request_data.get("submission", "").encode("utf-8"),
                    challenge_id=challenge_id,
                    kpm=kpm,
                )
                cache_key = generate_cache_key(challenge_id, team_id)
                if challenge.require_deploy:

                    if not redis_client.exists(cache_key):
                        pass

                    try:
                        force_stop(
                            cache_key=cache_key,
                            challenge_id=challenge_id,
                            team_id=team_id,
                        )
                    except requests.exceptions.RequestException as e:
                        log(
                            "errors",
                            "[{date}] Error stopping challenge {challenge_id} for team {team_id}: {error}",
                            challenge_id=challenge_id,
                            team_id=team_id,
                            error=str(e),
                        )
                        return (
                            jsonify(
                                {
                                    "success": False,
                                    "message": f"Failed to stop challenge: {e}",
                                }
                            ),
                            500,
                        )

                return jsonify(
                    {"success": True, "data": {"status": "correct", "message": message}}
                )

            else:
                print("dddddd")  # The challenge plugin says the input is wrong
                if (
                    ctftime()
                    or current_user.is_admin()
                    or current_user.is_challenge_writer()
                    or current_user.is_jury()
                ):

                    chal_class.fail(
                        user=user, team=team, challenge=challenge, request=request
                    )
                    clear_standings()
                    clear_challenges()

                log(
                    "submissions",
                    "[{date}] {name} submitted {submission} on {challenge_id} with kpm {kpm} [WRONG]",
                    name=user.name,
                    submission=request_data.get("submission", "").encode("utf-8"),
                    challenge_id=challenge_id,
                    kpm=kpm,
                )

                if max_tries:
                    # Off by one since fails has changed since it was gotten
                    attempts_left = max_tries - fails - 1
                    tries_str = pluralize(attempts_left, singular="try", plural="tries")
                    # Add a punctuation mark if there isn't one
                    if message[-1] not in "!().;?[]{}":
                        message = message + "."
                    return {
                        "success": True,
                        "data": {
                            "status": "incorrect",
                            "message": "{} You have {} {} remaining.".format(
                                message, attempts_left, tries_str
                            ),
                        },
                    }
                else:
                    return {
                        "success": True,
                        "data": {"status": "incorrect", "message": message},
                    }

        # Challenge already solved
        else:
            log(
                "submissions",
                "[{date}] {name} submitted {submission} on {challenge_id} with kpm {kpm} [ALREADY SOLVED]",
                name=user.name,
                submission=request_data.get("submission", "").encode("utf-8"),
                challenge_id=challenge_id,
                kpm=kpm,
            )
            return {
                "success": True,
                "data": {
                    "status": "already_solved",
                    "message": "You or your teammate already solved this",
                },
            }


@challenges_namespace.route("/<challenge_id>/solves")
class ChallengeSolves(Resource):
    @check_challenge_visibility
    @check_account_visibility
    @check_score_visibility
    @during_ctf_time_only
    @require_verified_emails
    def get(self, challenge_id):
        response = []
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()

        # TODO: Need a generic challenge visibility call.
        # However, it should be stated that a solve on a gated challenge is not considered private.
        if (
            challenge.state == "hidden"
            and (is_admin() or is_challenge_writer() or is_jury()) is False
        ):
            abort(404)

        freeze = get_config("freeze")
        if freeze:
            preview = request.args.get("preview")
            if (is_admin() is False) or (is_admin() is True and preview):
                freeze = True
            elif is_admin() is True:
                freeze = False

        response = get_solves_for_challenge_id(challenge_id=challenge_id, freeze=freeze)

        return {"success": True, "data": response}


@challenges_namespace.route("/<challenge_id>/files")
class ChallengeFiles(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        response = []

        challenge_files = ChallengeFilesModel.query.filter_by(
            challenge_id=challenge_id
        ).all()

        for f in challenge_files:
            response.append({"id": f.id, "type": f.type, "location": f.location})
        return {"success": True, "data": response}


@challenges_namespace.route("/<challenge_id>/tags")
class ChallengeTags(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        response = []

        tags = Tags.query.filter_by(challenge_id=challenge_id).all()

        for t in tags:
            response.append(
                {"id": t.id, "challenge_id": t.challenge_id, "value": t.value}
            )
        return {"success": True, "data": response}


@challenges_namespace.route("/<challenge_id>/topics")
class ChallengeTopics(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        response = []

        topics = ChallengeTopicsModel.query.filter_by(challenge_id=challenge_id).all()

        for t in topics:
            response.append(
                {
                    "id": t.id,
                    "challenge_id": t.challenge_id,
                    "topic_id": t.topic_id,
                    "value": t.topic.value,
                }
            )
        return {"success": True, "data": response}


@challenges_namespace.route("/<challenge_id>/hints")
class ChallengeHints(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        hints = Hints.query.filter_by(challenge_id=challenge_id).all()
        schema = HintSchema(many=True)
        response = schema.dump(hints)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data}


@challenges_namespace.route("/<challenge_id>/flags")
class ChallengeFlags(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        flags = Flags.query.filter_by(challenge_id=challenge_id).all()
        schema = FlagSchema(many=True)
        response = schema.dump(flags)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data}


@challenges_namespace.route("/<challenge_id>/requirements")
class ChallengeRequirements(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        return {"success": True, "data": challenge.requirements}
