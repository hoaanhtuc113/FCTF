import copy
import logging
from typing import List

from flask import abort, request, session
from flask_restx import Namespace, Resource

from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import (
    APIDetailedSuccessResponse,
    PaginatedAPIListSuccessResponse,
)
from CTFd.cache import (
    clear_challenges,
    clear_standings,
    clear_team_session,
    clear_user_session,
)
from CTFd.constants import RawEnum
from CTFd.models import Awards, Challenges, Contests, KypoTeamAccount, Submissions, Teams, Tokens, Unlocks, UserTeamMember, Users, db
from CTFd.schemas.awards import AwardSchema
from CTFd.schemas.submissions import SubmissionSchema
from CTFd.schemas.teams import TeamSchema
from CTFd.utils import get_config
from CTFd.utils.crypto import verify_password
from CTFd.utils.decorators import admins_only, authed_only, require_team
from CTFd.utils.decorators.modes import require_team_mode
from CTFd.utils.decorators.visibility import (
    check_account_visibility,
    check_score_visibility,
)
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.keycloak_service import create_kypo_user
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.user import get_current_team, get_current_user_type, is_admin

logger = logging.getLogger(__name__)

teams_namespace = Namespace("teams", description="Endpoint to retrieve Teams")

TeamModel = sqlalchemy_to_pydantic(Teams)
TransientTeamModel = sqlalchemy_to_pydantic(Teams, exclude=["id"])


class TeamDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: TeamModel


class TeamListSuccessResponse(PaginatedAPIListSuccessResponse):
    data: List[TeamModel]


teams_namespace.schema_model(
    "TeamDetailedSuccessResponse", TeamDetailedSuccessResponse.apidoc()
)

teams_namespace.schema_model(
    "TeamListSuccessResponse", TeamListSuccessResponse.apidoc()
)


@teams_namespace.route("")
class TeamList(Resource):
    method_decorators = [require_team_mode]

    @check_account_visibility
    @teams_namespace.doc(
        description="Endpoint to get Team objects in bulk",
        responses={
            200: ("Success", "TeamListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    @validate_args(
        {
            "affiliation": (str, None),
            "country": (str, None),
            "bracket": (str, None),
            "q": (str, None),
            "field": (
                RawEnum(
                    "TeamFields",
                    {
                        "name": "name",
                        "website": "website",
                        "country": "country",
                        "bracket": "bracket",
                        "affiliation": "affiliation",
                        "email": "email",
                    },
                ),
                None,
            ),
        },
        location="query",
    )
    def get(self, query_args):
        q = query_args.pop("q", None)
        field = str(query_args.pop("field", None))

        if field == "email":
            if is_admin() is False:
                return {
                    "success": False,
                    "errors": {"field": "Emails can only be queried by admins"},
                }, 400

        filters = build_model_filters(model=Teams, query=q, field=field)

        if is_admin() and request.args.get("view") == "admin":
            teams = (
                Teams.query.filter_by(**query_args)
                .filter(*filters)
                .paginate(per_page=50, max_per_page=100, error_out=False)
            )
        else:
            teams = (
                Teams.query.filter_by(hidden=False, banned=False, **query_args)
                .filter(*filters)
                .paginate(per_page=50, max_per_page=100, error_out=False)
            )

        user_type = get_current_user_type(fallback="user")
        view = copy.deepcopy(TeamSchema.views.get(user_type))
        view.remove("members")
        response = TeamSchema(view=view, many=True).dump(teams.items)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {
            "meta": {
                "pagination": {
                    "page": teams.page,
                    "next": teams.next_num,
                    "prev": teams.prev_num,
                    "pages": teams.pages,
                    "per_page": teams.per_page,
                    "total": teams.total,
                }
            },
            "success": True,
            "data": response.data,
        }

    @admins_only
    @teams_namespace.doc(
        description="Endpoint to create a Team object",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def post(self):
        req = request.get_json()
        user_type = get_current_user_type()
        view = TeamSchema.views.get(user_type)
        schema = TeamSchema(view=view)
        response = schema.load(req)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        db.session.add(response.data)
        db.session.commit()

        team = response.data
        kypo_error = None
        try:
            kypo_creds = create_kypo_user(team.id, team.name, contest_id=team.contest_id)
            kypo_account = KypoTeamAccount(
                team_id=team.id,
                kypo_user_id=kypo_creds["kypo_user_id"],
                kypo_username=kypo_creds["kypo_username"],
                kypo_password=kypo_creds["kypo_password"],
            )
            db.session.add(kypo_account)
            db.session.commit()
            logger.info("Created KYPO account for team %s (id=%s)", team.name, team.id)
        except Exception as exc:
            kypo_error = str(exc)
            logger.error("Failed to create KYPO account for team %s: %s", team.id, exc, exc_info=True)

        log_audit(
            action="team_create",
            data={
                "team_id": team.id,
                "name": team.name,
                "email": team.email,
                "website": team.website,
                "affiliation": team.affiliation,
                "country": team.country,
                "bracket_id": team.bracket_id,
                "hidden": team.hidden,
                "banned": team.banned,
                "captain_id": team.captain_id,
            }
        )

        response = schema.dump(team)
        db.session.close()

        clear_standings()
        clear_challenges()

        result = {"success": True, "data": response.data}
        if kypo_error:
            result["kypo_warning"] = f"Team created but KYPO account creation failed: {kypo_error}"
        return result


@teams_namespace.route("/<int:team_id>")
@teams_namespace.param("team_id", "Team ID")
class TeamPublic(Resource):
    method_decorators = [require_team_mode]

    @check_account_visibility
    @teams_namespace.doc(
        description="Endpoint to get a specific Team object",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def get(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        if (team.banned or team.hidden) and is_admin() is False:
            abort(404)

        user_type = get_current_user_type(fallback="user")
        view = TeamSchema.views.get(user_type)
        schema = TeamSchema(view=view)
        response = schema.dump(team)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        response.data["place"] = team.place
        response.data["score"] = team.score
        return {"success": True, "data": response.data}

    @admins_only
    @teams_namespace.doc(
        description="Endpoint to edit a specific Team object",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def patch(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()
        
        # Store before state for audit
        before_state = {
            "name": team.name,
            "email": team.email,
            "banned": team.banned,
            "hidden": team.hidden,
            "captain_id": team.captain_id,
            "website": team.website,
            "affiliation": team.affiliation,
            "country": team.country,
            "bracket_id": team.bracket_id,
        }
        
        data = request.get_json()

        # marshmallow-sqlalchemy regenerates Integer fields from the model without
        # allow_none, so null cannot pass through schema.load. Strip bracket_id=null
        # from data before loading (partial=True means it won't be touched), then
        # apply it directly to the instance after loading.
        clear_bracket = "bracket_id" in data and data["bracket_id"] is None
        if clear_bracket:
            del data["bracket_id"]

        data["id"] = team_id

        schema = TeamSchema(view="admin", instance=team, partial=True)

        response = schema.load(data)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        if clear_bracket:
            response.data.bracket_id = None

        response = schema.dump(response.data)
        db.session.commit()

        log_audit(
            action="team_update",
            before=before_state,
            after={
                "name": team.name,
                "email": team.email,
                "banned": team.banned,
                "hidden": team.hidden,
                "captain_id": team.captain_id,
                "website": team.website,
                "affiliation": team.affiliation,
                "country": team.country,
                "bracket_id": team.bracket_id,
                "password_changed": bool(data.get("password")),
            },
            data={"team_id": team_id, "name": team.name}
        )

        clear_team_session(team_id=team.id)
        clear_standings()
        clear_challenges()

        db.session.close()

        return {"success": True, "data": response.data}

    @admins_only
    @teams_namespace.doc(
        description="Endpoint to delete a specific Team object",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self, team_id):
        from CTFd.utils.keycloak_service import delete_kypo_user

        team = Teams.query.filter_by(id=team_id).first_or_404()
        team_id = team.id

        # Store team info before deletion for audit
        team_info = {
            "team_id": team.id,
            "name": team.name,
            "email": team.email,
            "member_count": len(team.members),
            "website": team.website,
            "affiliation": team.affiliation,
            "country": team.country,
            "bracket_id": team.bracket_id,
            "hidden": team.hidden,
            "banned": team.banned,
            "captain_id": team.captain_id,
        }

        kypo_account = KypoTeamAccount.query.filter_by(team_id=team.id).first()
        if kypo_account:
            try:
                delete_kypo_user(kypo_account.kypo_user_id)
            except Exception as exc:
                logger.error("Failed to delete Keycloak user for team %s: %s", team.id, exc)

        for member in team.members:
            clear_user_session(user_id=member.id)

        db.session.delete(team)
        db.session.commit()

        log_audit(
            action="team_delete",
            before=team_info,
            data={"team_id": team_id, "name": team_info["name"]}
        )

        clear_team_session(team_id=team_id)
        clear_standings()
        clear_challenges()

        db.session.close()

        return {"success": True}


@teams_namespace.route("/<int:team_id>/kypo")
@teams_namespace.param("team_id", "Team ID")
class TeamKypo(Resource):
    @admins_only
    def post(self, team_id):
        from CTFd.utils.keycloak_service import create_kypo_user

        team = Teams.query.filter_by(id=team_id).first_or_404()

        existing = KypoTeamAccount.query.filter_by(team_id=team_id).first()
        if existing:
            return {"success": False, "message": "KYPO account already exists for this team."}, 400

        try:
            kypo_creds = create_kypo_user(team.id, team.name, contest_id=team.contest_id)
            kypo_account = KypoTeamAccount(
                team_id=team.id,
                kypo_user_id=kypo_creds["kypo_user_id"],
                kypo_username=kypo_creds["kypo_username"],
                kypo_password=kypo_creds["kypo_password"],
            )
            db.session.add(kypo_account)
            db.session.commit()
            logger.info("Created KYPO account for team %s (id=%s) via admin API", team.name, team.id)
        except Exception as exc:
            logger.error("Failed to create KYPO account for team %s: %s", team.id, exc, exc_info=True)
            db.session.close()
            return {"success": False, "message": str(exc)}, 500

        created_at_str = kypo_account.created_at.strftime("%Y-%m-%d %H:%M:%S") if kypo_account.created_at else ""
        db.session.close()
        return {
            "success": True,
            "data": {
                "kypo_user_id": kypo_creds["kypo_user_id"],
                "kypo_username": kypo_creds["kypo_username"],
                "kypo_password": kypo_creds["kypo_password"],
                "created_at": created_at_str,
            },
        }


@teams_namespace.route("/me")
@teams_namespace.param("team_id", "Current Team")
class TeamPrivate(Resource):
    method_decorators = [require_team_mode]

    @authed_only
    @require_team
    @teams_namespace.doc(
        description="Endpoint to get the current user's Team object",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def get(self):
        team = get_current_team()
        response = TeamSchema(view="self").dump(team)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        # A team can always calculate their score regardless of any setting because they can simply sum all of their challenges
        # Therefore a team requesting their private data should be able to get their own current score
        # However place is not something that a team can ascertain on their own so it is always gated behind freeze time
        response.data["place"] = team.place
        response.data["score"] = team.get_score(admin=True)
        return {"success": True, "data": response.data}

    @authed_only
    @require_team
    @teams_namespace.doc(
        description="Endpoint to edit the current user's Team object",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def patch(self):
        team = get_current_team()
        if team.captain_id != session["id"]:
            return (
                {
                    "success": False,
                    "errors": {"": ["Only team captains can edit team information"]},
                },
                403,
            )

        data = request.get_json()

        response = TeamSchema(view="self", instance=team, partial=True).load(data)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        db.session.commit()
        clear_team_session(team_id=team.id)
        response = TeamSchema("self").dump(response.data)
        db.session.close()

        return {"success": True, "data": response.data}

    @authed_only
    @require_team
    @teams_namespace.doc(
        description="Endpoint to disband your current team. Can only be used if the team has performed no actions in the CTF.",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self):
        team_disbanding = get_config("team_disbanding", default="inactive_only")
        if team_disbanding == "disabled":
            return (
                {
                    "success": False,
                    "errors": {"": ["Team disbanding is currently disabled"]},
                },
                403,
            )

        team = get_current_team()
        if team.captain_id != session["id"]:
            return (
                {
                    "success": False,
                    "errors": {"": ["Only team captains can disband their team"]},
                },
                403,
            )

        # The team must not have performed any actions in the CTF
        performed_actions = any(
            [
                team.solves != [],
                team.fails != [],
                team.awards != [],
                Submissions.query.filter_by(team_id=team.id).all() != [],
                Unlocks.query.filter_by(team_id=team.id).all() != [],
            ]
        )

        if performed_actions:
            return (
                {
                    "success": False,
                    "errors": {
                        "": [
                            "You cannot disband your team as it has participated in the event. "
                            "Please contact an admin to disband your team or remove a member."
                        ]
                    },
                },
                403,
            )

        for member in team.members:
            clear_user_session(user_id=member.id)

        db.session.delete(team)
        db.session.commit()

        clear_team_session(team_id=team.id)
        clear_standings()
        clear_challenges()

        db.session.close()

        return {"success": True}


@teams_namespace.route("/me/members")
class TeamPrivateMembers(Resource):
    method_decorators = [require_team_mode]

    @authed_only
    @require_team
    def post(self):
        team = get_current_team()
        if team.captain_id != session["id"]:
            return (
                {
                    "success": False,
                    "errors": {"": ["Only team captains can generate invite codes"]},
                },
                403,
            )

        invite_code = team.get_invite_code()
        response = {"code": invite_code}
        return {"success": True, "data": response}


@teams_namespace.route("/<team_id>/members")
@teams_namespace.param("team_id", "Team ID")
class TeamMembers(Resource):
    method_decorators = [require_team_mode]

    @admins_only
    def get(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        view = "admin" if is_admin() else "user"
        schema = TeamSchema(view=view)
        response = schema.dump(team)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        members = response.data.get("members")

        return {"success": True, "data": members}

    @admins_only
    def post(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        # Generate an invite code if no user or body is specified
        if len(request.data) == 0:
            invite_code = team.get_invite_code()
            response = {"code": invite_code}
            return {"success": True, "data": response}

        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id")

        if user_id is not None:
            user = Users.query.filter_by(id=user_id).first_or_404()

            if user.verified is False:
                return (
                    {
                        "success": False,
                        "errors": {"id": ["User must be verified before adding to a team"]},
                    },
                    400,
                )

            # Check if user is already in a team for this contest (contest-scoped)
            if team.contest_id:
                already_in_contest = (
                    db.session.query(UserTeamMember)
                    .join(Teams, Teams.id == UserTeamMember.team_id)
                    .filter(
                        UserTeamMember.user_id == user.id,
                        Teams.contest_id == team.contest_id,
                    )
                    .first()
                )
            else:
                already_in_contest = UserTeamMember.query.filter_by(
                    user_id=user.id, team_id=team.id
                ).first()

            if already_in_contest is not None:
                return (
                    {
                        "success": False,
                        "errors": {"id": ["User has already joined a team in this contest"]},
                    },
                    400,
                )

            # Enforce team_size limit from contest settings
            if team.contest_id:
                contest = Contests.query.filter_by(id=team.contest_id).first()
                team_size_limit = contest.team_size if contest else None
            else:
                team_size_limit = get_config("team_size", default=0) or None

            if team_size_limit:
                current_count = (
                    db.session.query(db.func.count(UserTeamMember.id))
                    .filter_by(team_id=team.id)
                    .scalar()
                )
                if current_count >= team_size_limit:
                    return (
                        {
                            "success": False,
                            "errors": {
                                "id": [
                                    "This team is full. Teams are limited to {} member{}.".format(
                                        team_size_limit,
                                        "" if team_size_limit == 1 else "s",
                                    )
                                ]
                            },
                        },
                        400,
                    )

            team.members.append(user)
            db.session.commit()
        else:
            invite_code = team.get_invite_code()
            response = {"code": invite_code}
            return {"success": True, "data": response}

        view = "admin" if is_admin() else "user"
        schema = TeamSchema(view=view)
        response = schema.dump(team)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        members = response.data.get("members")

        return {"success": True, "data": members}

    @admins_only
    def delete(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        data = request.get_json()
        user_id = data["user_id"]
        user = Users.query.filter_by(id=user_id).first_or_404()

        membership = UserTeamMember.query.filter_by(user_id=user.id, team_id=team.id).first()
        if membership:
            team.members.remove(user)

            # Remove information that links the user to this specific team
            Submissions.query.filter_by(user_id=user.id, team_id=team.id).delete()
            Awards.query.filter_by(user_id=user.id, team_id=team.id).delete()
            Unlocks.query.filter_by(user_id=user.id, team_id=team.id).delete()

            db.session.commit()
        else:
            return (
                {"success": False, "errors": {"id": ["User is not part of this team"]}},
                400,
            )

        view = "admin" if is_admin() else "user"
        schema = TeamSchema(view=view)
        response = schema.dump(team)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        members = response.data.get("members")

        return {"success": True, "data": members}


@teams_namespace.route("/me/solves")
class TeamPrivateSolves(Resource):
    method_decorators = [require_team_mode]

    @authed_only
    @require_team
    def get(self):
        team = get_current_team()
        solves = team.get_solves(admin=True)

        view = "admin" if is_admin() else "user"
        schema = SubmissionSchema(view=view, many=True)
        response = schema.dump(solves)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        count = len(response.data)
        return {"success": True, "data": response.data, "meta": {"count": count}}


@teams_namespace.route("/me/fails")
class TeamPrivateFails(Resource):
    method_decorators = [require_team_mode]

    @authed_only
    @require_team
    def get(self):
        team = get_current_team()
        fails = team.get_fails(admin=True)

        view = "admin" if is_admin() else "user"

        # We want to return the count purely for stats & graphs
        # but this data isn't really needed by the end user.
        # Only actually show fail data for admins.
        if is_admin():
            schema = SubmissionSchema(view=view, many=True)
            response = schema.dump(fails)

            if response.errors:
                return {"success": False, "errors": response.errors}, 400

            data = response.data
        else:
            data = []
        count = len(fails)

        return {"success": True, "data": data, "meta": {"count": count}}


@teams_namespace.route("/me/awards")
class TeamPrivateAwards(Resource):
    method_decorators = [require_team_mode]

    @authed_only
    @require_team
    def get(self):
        team = get_current_team()
        awards = team.get_awards(admin=True)

        schema = AwardSchema(many=True)
        response = schema.dump(awards)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        count = len(response.data)
        return {"success": True, "data": response.data, "meta": {"count": count}}


@teams_namespace.route("/<team_id>/solves")
@teams_namespace.param("team_id", "Team ID")
class TeamPublicSolves(Resource):
    method_decorators = [require_team_mode]

    @check_account_visibility
    @check_score_visibility
    def get(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        if (team.banned or team.hidden) and is_admin() is False:
            abort(404)
        solves = team.get_solves(admin=is_admin())

        view = "admin" if is_admin() else "user"
        schema = SubmissionSchema(view=view, many=True)
        response = schema.dump(solves)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        count = len(response.data)
        return {"success": True, "data": response.data, "meta": {"count": count}}


@teams_namespace.route("/<team_id>/fails")
@teams_namespace.param("team_id", "Team ID")
class TeamPublicFails(Resource):
    method_decorators = [require_team_mode]

    @check_account_visibility
    @check_score_visibility
    def get(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        if (team.banned or team.hidden) and is_admin() is False:
            abort(404)
        fails = team.get_fails(admin=is_admin())

        view = "admin" if is_admin() else "user"

        # We want to return the count purely for stats & graphs
        # but this data isn't really needed by the end user.
        # Only actually show fail data for admins.
        if is_admin():
            schema = SubmissionSchema(view=view, many=True)
            response = schema.dump(fails)

            if response.errors:
                return {"success": False, "errors": response.errors}, 400

            data = response.data
        else:
            data = []
        count = len(fails)

        return {"success": True, "data": data, "meta": {"count": count}}


@teams_namespace.route("/<team_id>/awards")
@teams_namespace.param("team_id", "Team ID")
class TeamPublicAwards(Resource):
    method_decorators = [require_team_mode]

    @check_account_visibility
    @check_score_visibility
    def get(self, team_id):
        team = Teams.query.filter_by(id=team_id).first_or_404()

        if (team.banned or team.hidden) and is_admin() is False:
            abort(404)
        awards = team.get_awards(admin=is_admin())

        schema = AwardSchema(many=True)
        response = schema.dump(awards)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        count = len(response.data)
        return {"success": True, "data": response.data, "meta": {"count": count}}
    
@teams_namespace.route("/contestant")
class TeamContestant(Resource):
    @check_account_visibility
    @teams_namespace.doc(
        description="Endpoint to get a specific Team for contestant",
        responses={
            200: ("Success", "TeamDetailedSuccessResponse"),
            400: (
                    "An error occured processing the provided or stored data",
                    "APISimpleErrorResponse",
            ),
        },
    )
    def get(self):
        auth_header = request.headers.get('Authorization', None)
        user = None
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            token_auth = Tokens.query.filter_by(value=token).first()
            user = Users.query.filter_by(id=token_auth.user_id).first() if token_auth else None
        if user:
            utm = UserTeamMember.query.filter_by(user_id=user.id).first()
            team = Teams.query.filter_by(id=utm.team_id).first() if utm else None
            if team:
                users_member = team.members
                members = [
                    {
                        "name": member.name,
                        "email": member.email,
                        "score": member.get_score(admin=True),
                    }
                    for member in users_member
                ]
                challenges = Challenges.query.filter_by(state="visible").all()
                
                # Sửa lỗi: kiểm tra và thay thế None bằng 0 khi tính tổng
                total_score = sum([challenge.value if challenge.value is not None else 0 for challenge in challenges])

                response = {
                    "name": team.name,
                    "place": team.get_place(admin=True),
                    "members": members,
                    "score": team.get_score(admin=True),
                    "challengeTotalScore": total_score,
                }
                return {"success": True, "data": response}
        return {"success": False, "error": "Unauthorized"}, 401
