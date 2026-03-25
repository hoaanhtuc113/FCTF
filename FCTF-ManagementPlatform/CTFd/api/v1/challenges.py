import hashlib
import json
import time
from typing import List
from datetime import datetime, timedelta, timezone
import requests  # noqa: I001

from flask import abort, jsonify, render_template, request, session, url_for
from flask_restx import Namespace, Resource
import redis
from CTFd.StartChallenge import create_secret_key, generate_cache_key
from CTFd.constants.envvars import API_URL_CONTROLSERVER, HOST_CACHE, PRIVATE_KEY, get_redis_client_kwargs
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
    ChallengeVersion,
)
from CTFd.models import Challenges
from CTFd.models import ChallengeTopics as ChallengeTopicsModel
from CTFd.models import Fails, Flags, Hints, HintUnlocks, Solves, Submissions, Tags, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.plugins.dynamic_challenges import DynamicChallenge
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
from CTFd.utils.logging.audit_logger import log_audit
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

from CTFd.utils.connector.multiservice_connector import (
    delete_challenge,
    force_stop,
    get_workflow_status,
    get_workflow_name,
    delete_cached_files,
)
from CTFd.utils.uploads import delete_folder

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

redis_client = redis.StrictRedis(**get_redis_client_kwargs())


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

        # Trim name and category fields
        if "name" in data:
            data["name"] = data["name"].strip()
        if "category" in data:
            data["category"] = data["category"].strip()

        # Validate name and category are not empty after trim
        if not data.get("name"):
            return {"success": False, "errors": {"name": ["Name cannot be empty"]}}, 400
        if not data.get("category"):
            return {"success": False, "errors": {"category": ["Category cannot be empty"]}}, 400
        
        # Validate category max length
        if len(data.get("category", "")) > 20:
            return {"success": False, "errors": {"category": ["Category must be 20 characters or less"]}}, 400

        # Normalize difficulty: empty string → None so schema validation passes
        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None

        schema = ChallengeSchema()
        response = schema.load(data)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        challenge_type = data["type"]
        challenge_class = get_chal_class(challenge_type)
        challenge = challenge_class.create(request)
        response = challenge_class.read(challenge)

        log_audit(
            action="challenge_create",
            data={
                "challenge_id": challenge.id,
                "name": challenge.name,
                "description": challenge.description,
                "category": challenge.category,
                "type": challenge.type,
                "value": challenge.value,
                "state": challenge.state,
                "max_attempts": challenge.max_attempts,
                "connection_info": challenge.connection_info,
                "time_limit": challenge.time_limit,
                "cooldown": challenge.cooldown,
                "difficulty": challenge.difficulty,
                "requirements": challenge.requirements,
                "next_id": challenge.next_id,
                "user_id": challenge.user_id,
                "require_deploy": challenge.require_deploy,
                "deploy_status": challenge.deploy_status,
                "image_link": challenge.image_link,
                "deploy_file": challenge.deploy_file,
                "cpu_limit": challenge.cpu_limit,
                "cpu_request": challenge.cpu_request,
                "memory_limit": challenge.memory_limit,
                "memory_request": challenge.memory_request,
                "use_gvisor": challenge.use_gvisor,
                "harden_container": challenge.harden_container,
                "max_deploy_count": challenge.max_deploy_count,
            }
        )

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

        # FIX: Don't pass Hints objects to template, use dict instead
        response["view"] = render_template(
            chal_class.templates["view"].lstrip("/"),
            solves=solve_count,
            solved_by_me=solved_by_user,
            files=files,
            tags=tags,
            hints=hints,  # Changed from [Hints(**h) for h in hints] to just hints
            max_attempts=chal.max_attempts,
            attempts=attempts,
            challenge=chal,
        )

        db.session.close()
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
        # Normalize difficulty: empty string → None so schema validation passes
        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None
        # Load data through schema for validation but not for insertion
        schema = ChallengeSchema()
        data["user_id"] = session["id"]
        response = schema.load(data)
        scoringType = data.get("scoring-type-radio")

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        user_id = session["id"]
        user = Users.query.filter_by(id=user_id).first()
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        print(f"Challenge {challenge.name} has been updated by user {user_id} ({user.type})")

        # Store before state for audit
        before_state = {
            "name": challenge.name,
            "description": challenge.description,
            "category": challenge.category,
            "type": challenge.type,
            "value": challenge.value,
            "state": challenge.state,
            "max_attempts": challenge.max_attempts,
            "connection_info": challenge.connection_info,
            "time_limit": challenge.time_limit,
            "cooldown": challenge.cooldown,
            "difficulty": challenge.difficulty,
            "requirements": challenge.requirements,
            "next_id": challenge.next_id,
            "user_id": challenge.user_id,
            "require_deploy": challenge.require_deploy,
            "deploy_status": challenge.deploy_status,
            "image_link": challenge.image_link,
            "deploy_file": challenge.deploy_file,
            "cpu_limit": challenge.cpu_limit,
            "cpu_request": challenge.cpu_request,
            "memory_limit": challenge.memory_limit,
            "memory_request": challenge.memory_request,
            "use_gvisor": challenge.use_gvisor,
            "harden_container": challenge.harden_container,
            "max_deploy_count": challenge.max_deploy_count,
        }

        if user.type == "admin":
            data["user_id"] = challenge.user_id
            pass
        elif user.type == "challenge_writer":
            if challenge.user_id != user_id:
                return {
                    "success": False,
                    "error": "You are not authorized to update this challenge.",
                }, 403
            data["user_id"] = user_id
        else:
            return {"success": False, "error": "Unauthorized user type."}, 403

        if scoringType == "standard" and challenge.type == "dynamic":
            # Converting from dynamic to standard
            from sqlalchemy import text
            db.session.execute(
                text("DELETE FROM dynamic_challenge WHERE id = :id"),
                {"id": challenge_id}
            )
            
            challenge.type = "standard"
            db.session.commit()
            db.session.expunge_all()
            challenge = Challenges.query.filter_by(id=challenge_id).first()
            
        elif scoringType == "dynamic" and challenge.type == "standard":
            # Converting from standard to dynamic
            challenge.type = "dynamic"
            db.session.flush()

            initial = int(data.get("initial", 100))
            minimum = int(data.get("minimum", 10))
            decay = int(data.get("decay", 50))
            function = data.get("function", "logarithmic")
            
            from sqlalchemy import text
            db.session.execute(
                text(
                    "INSERT INTO dynamic_challenge (id, initial, minimum, decay, function) "
                    "VALUES (:id, :initial, :minimum, :decay, :function)"
                ),
                {
                    "id": challenge_id,
                    "initial": initial,
                    "minimum": minimum,
                    "decay": decay,
                    "function": function
                }
            )
            db.session.commit()
            db.session.expunge_all()
            challenge = Challenges.query.filter_by(id=challenge_id).first()

        challenge_class = get_chal_class(challenge.type)
        challenge = challenge_class.update(challenge, request)
        response = challenge_class.read(challenge)
        
        log_audit(
            action="challenge_update",
            before=before_state,
            after={
                "name": challenge.name,
                "description": challenge.description,
                "category": challenge.category,
                "type": challenge.type,
                "value": challenge.value,
                "state": challenge.state,
                "max_attempts": challenge.max_attempts,
                "connection_info": challenge.connection_info,
                "time_limit": challenge.time_limit,
                "cooldown": challenge.cooldown,
                "difficulty": challenge.difficulty,
                "requirements": challenge.requirements,
                "next_id": challenge.next_id,
                "user_id": challenge.user_id,
                "require_deploy": challenge.require_deploy,
                "deploy_status": challenge.deploy_status,
                "image_link": challenge.image_link,
                "deploy_file": challenge.deploy_file,
                "cpu_limit": challenge.cpu_limit,
                "cpu_request": challenge.cpu_request,
                "memory_limit": challenge.memory_limit,
                "memory_request": challenge.memory_request,
                "use_gvisor": challenge.use_gvisor,
                "harden_container": challenge.harden_container,
                "max_deploy_count": challenge.max_deploy_count,
            },
            data={"challenge_id": challenge_id, "name": challenge.name}
        )
        
        print("challengeState:" + challenge.state)
        if challenge.state == "visible":
            # notification to contestants disabled
            pass

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
        
        # Store challenge info before deletion for audit
        challenge_info = {
            "challenge_id": challenge.id,
            "name": challenge.name,
            "description": challenge.description,
            "category": challenge.category,
            "type": challenge.type,
            "value": challenge.value,
            "state": challenge.state,
            "max_attempts": challenge.max_attempts,
            "connection_info": challenge.connection_info,
            "time_limit": challenge.time_limit,
            "cooldown": challenge.cooldown,
            "difficulty": challenge.difficulty,
            "requirements": challenge.requirements,
            "next_id": challenge.next_id,
            "user_id": challenge.user_id,
            "require_deploy": challenge.require_deploy,
            "deploy_status": challenge.deploy_status,
            "image_link": challenge.image_link,
            "deploy_file": challenge.deploy_file,
            "cpu_limit": challenge.cpu_limit,
            "cpu_request": challenge.cpu_request,
            "memory_limit": challenge.memory_limit,
            "memory_request": challenge.memory_request,
            "use_gvisor": challenge.use_gvisor,
            "harden_container": challenge.harden_container,
            "max_deploy_count": challenge.max_deploy_count,
        }

        if challenge.require_deploy:
            delete_folder(challenge.deploy_file)
            delete_cached_files(challenge.id)
            # if challenge.deploy_status != "PENDING_DEPLOY":
            #     delete_response, status_code = delete_challenge(challenge_id)
            #     if status_code != 200 or not delete_response.get("isSuccess"):
            #         return {
            #             "isSuccess": False,
            #             "message": delete_response.get("message"),
            #         }, status_code
            # else:
            #     pass

        chal_class = get_chal_class(challenge.type)
        chal_class.delete(challenge)
        clear_standings()
        clear_challenges()
        
        log_audit(
            action="challenge_delete",
            before=challenge_info,
            data={"challenge_id": challenge_id, "name": challenge_info["name"]}
        )
        
        if(challenge.state == "visible"):
            # notification to contestants disabled
            pass
        

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
    def post(self):
        print("Chay vao day")
        auth_header = get_token_from_header()
        if not auth_header:
            return {"success": False, "message": "Authorization missing"}, 403

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
            return {"success": False, "error": "Token not found"}, 404

        user = Users.query.filter_by(id=token.user_id).first()
        if user is None:
            return {"success": False, "error": "User not found"}, 404

        team_id = user.team_id
        if not challenge_id:
            return {"success": False, "error": "ChallengeId is required"}, 400

        challenge = Challenges.query.filter_by(id=challenge_id).first()
        if not challenge:
            return {"success": False, "error": "Challenge not found"}, 400

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
                        "cooldown": challenge.cooldown,
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

        team = Teams.query.filter_by(id=team_id).first()
        
        # Check captain_only_submit_challenge config
        captain_only_submit = get_config("captain_only_submit_challenge")
        if (captain_only_submit == 1 or captain_only_submit == "true") and user.type == 'user':
            if not team or not team.captain_id or team.captain_id != user.id:
                return (
                    {
                        "success": False,
                        "data": {
                            "status": "forbidden",
                            "message": "Only the team captain has permission to submit flags for challenges.",
                        },
                    },
                    403,
                )
        
        # Cooldown check
        cooldown_seconds = challenge.cooldown or 0
        if cooldown_seconds > 0:
            cooldown_key = f"submission_cooldown_{challenge_id}_{team_id}"
            last_submission_time = redis_client.get(cooldown_key)
            
            if last_submission_time:
                last_submission_time = float(last_submission_time)
                current_time = time.time()
                time_elapsed = current_time - last_submission_time
                
                if time_elapsed < cooldown_seconds:
                    remaining_cooldown = int(cooldown_seconds - time_elapsed)
                    return (
                        {
                            "success": True,
                            "data": {
                                "status": "ratelimited",
                                "message": f"Please wait {remaining_cooldown} seconds before submitting again.",
                            },
                        },
                        429,
                    )
            
            redis_client.set(cooldown_key, str(time.time()))
        
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
                print("Print hello")
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
                    if redis_client.exists(cache_key):
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
                                {
                                    "success": False,
                                    "message": f"Failed to stop challenge: {e}",
                                },
                                500,
                            )

                return {
                    "success": True, 
                    "data": {
                        "status": "correct", 
                        "message": message
                    }
                }

            else:
                print("dddddd")
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
                    attempts_left = max_tries - fails - 1
                    tries_str = pluralize(attempts_left, singular="try", plural="tries")
                    if message[-1] not in "!().;?[]{}":
                        message = message + "."
                    return {
                        "success": True,
                        "data": {
                            "status": "incorrect",
                            "message": "{} You have {} {} remaining.".format(
                                message, attempts_left, tries_str
                            ),
                            "cooldown": challenge.cooldown,
                        },
                    }
                else:
                    return {
                        "success": True,
                        "data": {"status": "incorrect", "message": message, "cooldown": challenge.cooldown},
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

@challenges_namespace.route("/<challenge_id>/deploy-duration")
class ChallengeDeploy(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        try:
            challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
            if not challenge.require_deploy:
                return {"success": False, "error": "Challenge does not require deployment"}, 400
            
            workflow_name = get_workflow_name(challenge.id)
            if not workflow_name:
                return {"success": False, "error": "Workflow name not found for challenge"}, 404
            
            workflow_phase, started_at_iso, estimated_duration = get_workflow_status(workflow_name)
            if workflow_phase is None or started_at_iso is None or estimated_duration is None:
                return {"success": False, "error": "Could not retrieve workflow status"}, 500

            remaining_time = None
            if estimated_duration and started_at_iso:
                started_at_dt = datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
                now_utc = datetime.now(timezone.utc)

                elapsed_time = max(0.0, (now_utc - started_at_dt).total_seconds())
                remaining_time = max(0.0, float(estimated_duration) - elapsed_time)

                print(f"Started at: {started_at_dt}, Now: {now_utc}, Elapsed: {elapsed_time}, Remaining: {remaining_time}")

            if workflow_phase == "Succeeded":
                challenge.deploy_status = "DEPLOY_SUCCESS"
                challenge.state = "visible"
                db.session.commit()

            elif workflow_phase in ("Failed", "Error"):
                challenge.deploy_status = "DEPLOY_FAILED"
                challenge.state = "hidden"
                db.session.commit()

            return {
                "success": True,
                "data": {
                    "phase": workflow_phase,
                    "estimated_duration": float(estimated_duration),
                    "started_at": started_at_iso,
                    "remaining_time": remaining_time
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500


@challenges_namespace.route("/<challenge_id>/versions")
class ChallengeVersionList(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id):
        """List all versions for a challenge"""
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        versions = (
            ChallengeVersion.query
            .filter_by(challenge_id=challenge.id)
            .order_by(ChallengeVersion.version_number.desc())
            .all()
        )
        data = []
        for v in versions:
            data.append({
                "id": v.id,
                "challenge_id": v.challenge_id,
                "version_number": v.version_number,
                "image_tag": v.image_tag,
                "expose_port": v.expose_port,
                "deploy_file": v.deploy_file,
                "cpu_limit": v.cpu_limit,
                "cpu_request": v.cpu_request,
                "memory_limit": v.memory_limit,
                "memory_request": v.memory_request,
                "use_gvisor": v.use_gvisor,
                "max_deploy_count": v.max_deploy_count,
                "is_active": v.is_active,
                "created_by": v.creator.name if v.creator else "Unknown",
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "notes": v.notes,
            })
        return {"success": True, "data": data}


@challenges_namespace.route("/<challenge_id>/versions/<version_id>")
class ChallengeVersionDetail(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, challenge_id, version_id):
        """Get a specific version detail"""
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        version = ChallengeVersion.query.filter_by(
            id=version_id, challenge_id=challenge.id
        ).first_or_404()
        data = {
            "id": version.id,
            "challenge_id": version.challenge_id,
            "version_number": version.version_number,
            "image_link": version.image_link,
            "image_tag": version.image_tag,
            "expose_port": version.expose_port,
            "deploy_file": version.deploy_file,
            "cpu_limit": version.cpu_limit,
            "cpu_request": version.cpu_request,
            "memory_limit": version.memory_limit,
            "memory_request": version.memory_request,
            "use_gvisor": version.use_gvisor,
            "harden_container": version.harden_container,
            "max_deploy_count": version.max_deploy_count,
            "is_active": version.is_active,
            "created_by": version.creator.name if version.creator else "Unknown",
            "created_at": version.created_at.isoformat() if version.created_at else None,
            "notes": version.notes,
        }
        return {"success": True, "data": data}


@challenges_namespace.route("/<challenge_id>/versions/<version_id>/rollback")
class ChallengeVersionRollback(Resource):
    @admins_only
    def post(self, challenge_id, version_id):
        """Rollback a challenge to a specific version"""
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        version = ChallengeVersion.query.filter_by(
            id=version_id, challenge_id=challenge.id
        ).first_or_404()

        if version.is_active:
            return {"success": False, "message": "This version is already active"}, 400

        if not version.image_link:
            return {"success": False, "message": "This version has no image to rollback to"}, 400

        try:
            # Deactivate all versions for this challenge
            ChallengeVersion.query.filter_by(
                challenge_id=challenge.id
            ).update({"is_active": False})

            # Activate the target version
            version.is_active = True

            # Update challenge with the version's config
            challenge.image_link = version.image_link
            if version.deploy_file:
                challenge.deploy_file = version.deploy_file
            if version.cpu_limit is not None:
                challenge.cpu_limit = version.cpu_limit
            if version.cpu_request is not None:
                challenge.cpu_request = version.cpu_request
            if version.memory_limit is not None:
                challenge.memory_limit = version.memory_limit
            if version.memory_request is not None:
                challenge.memory_request = version.memory_request
            if version.use_gvisor is not None:
                challenge.use_gvisor = version.use_gvisor
            if version.harden_container is not None:
                challenge.harden_container = version.harden_container
            if version.max_deploy_count is not None:
                challenge.max_deploy_count = version.max_deploy_count

            challenge.deploy_status = "DEPLOY_SUCCESS"
            challenge.last_update = datetime.utcnow()

            db.session.commit()

            return {
                "success": True,
                "message": f"Challenge rolled back to version {version.version_number}",
                "data": {
                    "version_number": version.version_number,
                    "image_tag": version.image_tag,
                    "max_deploy_count": version.max_deploy_count,
                }
            }
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Rollback failed: {str(e)}"}, 500

