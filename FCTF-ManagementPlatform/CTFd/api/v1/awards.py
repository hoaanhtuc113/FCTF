from typing import List
import hashlib
import json

from flask import request
from flask_restx import Namespace, Resource
from sqlalchemy.exc import IntegrityError

from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.pagination import paginate_list
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, PaginatedAPIListSuccessResponse
from CTFd.cache import clear_standings
from CTFd.constants import RawEnum
from CTFd.models import Awards, Teams, Users, db
from CTFd.schemas.awards import AwardSchema
from CTFd.utils.config import is_teams_mode
from CTFd.utils.decorators import admins_only
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.validators.scoring import score_integer, ScoringValidationError
from CTFd.utils.user import get_current_user
from CTFd.utils.validators.references import positive_id, reference
from marshmallow import ValidationError

awards_namespace = Namespace("awards", description="Endpoint to retrieve Awards")

AwardModel = sqlalchemy_to_pydantic(Awards)


class AwardDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: AwardModel


class AwardListSuccessResponse(PaginatedAPIListSuccessResponse):
    data: List[AwardModel]


awards_namespace.schema_model(
    "AwardDetailedSuccessResponse", AwardDetailedSuccessResponse.apidoc()
)

awards_namespace.schema_model(
    "AwardListSuccessResponse", AwardListSuccessResponse.apidoc()
)


@awards_namespace.route("")
class AwardList(Resource):
    @admins_only
    @awards_namespace.doc(
        description="Endpoint to list Award objects in bulk",
        params={"page": "Page number (default 1)", "per_page": "Page size (default 50, maximum 100)"},
        responses={
            200: ("Success", "AwardListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    @validate_args(
        {
            "user_id": (int, None),
            "team_id": (int, None),
            "type": (str, None),
            "value": (int, None),
            "category": (int, None),
            "icon": (int, None),
            "q": (str, None),
            "field": (
                RawEnum(
                    "AwardFields",
                    {
                        "name": "name",
                        "description": "description",
                        "category": "category",
                        "icon": "icon",
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
        filters = build_model_filters(model=Awards, query=q, field=field)

        try:
            awards, meta = paginate_list(Awards.query.filter_by(**query_args).filter(*filters)
                                         .order_by(Awards.id.desc()))
        except ValueError as error:
            return {"success": False, "errors": {"pagination": [str(error)]}}, 400
        schema = AwardSchema(many=True)
        response = schema.dump(awards)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data, "meta": meta}

    @admins_only
    @awards_namespace.doc(
        description="Endpoint to create an Award object",
        responses={
            200: ("Success", "AwardListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def post(self):
        req = request.get_json()
        if not isinstance(req, dict):
            return {"success": False, "errors": {"body": ["Expected an object"]}}, 400
        if req.get("type", "standard") != "standard":
            return {"success": False, "errors": {"type": ["Unsupported award type"]}}, 400
        try:
            # Negative awards remain valid for hint purchases and penalties.
            req["value"] = score_integer(req.get("value"), minimum=-2147483648)
        except ScoringValidationError as error:
            return {"success": False, "errors": error.errors}, 400

        # Force a team_id if in team mode and unspecified
        if is_teams_mode():
            team_id = req.get("team_id")
            if team_id is None:
                user = Users.query.filter_by(id=req.get("user_id")).first_or_404()
                if user.team_id is None:
                    return (
                        {
                            "success": False,
                            "errors": {
                                "team_id": [
                                    "User doesn't have a team to associate award with"
                                ]
                            },
                        },
                        400,
                    )
                req["team_id"] = user.team_id

        schema = AwardSchema()

        response = schema.load(req, session=db.session)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        award = response.data
        if award.user_id is None or Users.query.get(award.user_id) is None:
            return {"success": False, "errors": {"user_id": ["Valid user required"]}}, 400
        if award.team_id is not None and Teams.query.get(award.team_id) is None:
            return {"success": False, "errors": {"team_id": ["Team does not exist"]}}, 400
        # Hash normalized values, not JSON ordering or server-generated date.
        payload = {field: getattr(award, field) for field in (
            "user_id", "team_id", "name", "description", "value", "category", "icon", "requirements"
        )}
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        key = request.headers.get("Idempotency-Key", fingerprint)
        if not key.strip() or len(key) > 128:
            return {"success": False, "errors": {"Idempotency-Key": ["Use 1 to 128 characters"]}}, 400
        request_key = hashlib.sha256("{}:{}".format(get_current_user().id, key).encode()).hexdigest()

        def replay(existing):
            if existing.request_hash != fingerprint:
                return {"success": False, "errors": {"Idempotency-Key": ["Key already used for another award"]}}, 409
            return {"success": True, "data": schema.dump(existing).data}

        existing = Awards.query.filter_by(request_key=request_key).first()
        if existing:
            return replay(existing)
        award.request_key = request_key
        award.request_hash = fingerprint
        try:
            db.session.add(award)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            existing = Awards.query.filter_by(request_key=request_key).first()
            if existing:
                return replay(existing)
            raise

        response = schema.dump(response.data)
        db.session.close()

        log_audit(
            action="award_create",
            data={
                "award_id": response.data.get("id"),
                "user_id": response.data.get("user_id"),
                "team_id": response.data.get("team_id"),
                "name": response.data.get("name"),
                "value": response.data.get("value"),
                "type": response.data.get("type"),
                "description": response.data.get("description"),
                "date": str(response.data.get("date")) if response.data.get("date") else None,
                "category": response.data.get("category"),
                "icon": response.data.get("icon"),
            },
        )

        # Delete standings cache because awards can change scores
        clear_standings()

        return {"success": True, "data": response.data}


@awards_namespace.route("/<award_id>")
@awards_namespace.param("award_id", "An Award ID")
class Award(Resource):
    @admins_only
    @awards_namespace.doc(description="Update an award; creation idempotency keys and date are immutable")
    def patch(self, award_id):
        req = request.get_json()
        if not isinstance(req, dict):
            return {"success": False, "errors": {"body": ["Expected a JSON object"]}}, 400
        editable = {"name", "description", "value", "category", "icon", "requirements", "user_id", "team_id"}
        if set(req) - editable:
            return {"success": False, "errors": {"body": ["Unsupported or immutable award fields"]}}, 400
        try:
            record_id = positive_id(award_id, "id")
            reference(req, "user_id", Users)
            reference(req, "team_id", Teams, nullable=True)
            if "value" in req:
                req["value"] = score_integer(req["value"], minimum=-2147483648)
        except ValidationError as error:
            return {"success": False, "errors": {field: error.messages for field in error.field_names}}, 400
        except ScoringValidationError as error:
            return {"success": False, "errors": error.errors}, 400
        award = Awards.query.filter_by(id=record_id).populate_existing().with_for_update().first_or_404()
        if is_teams_mode() and ("user_id" in req or "team_id" in req):
            user = Users.query.get(req.get("user_id", award.user_id))
            if user is None or user.team_id is None:
                return {"success": False, "errors": {"team_id": ["User must belong to a team"]}}, 400
            if req.get("team_id") not in (None, user.team_id):
                return {"success": False, "errors": {"team_id": ["Team must match the award user"]}}, 400
            req["team_id"] = user.team_id
        before = AwardSchema().dump(award).data
        schema = AwardSchema(instance=award, partial=True)
        response = schema.load(req, session=db.session)
        if response.errors:
            db.session.rollback()
            return {"success": False, "errors": response.errors}, 400
        db.session.commit()
        after = schema.dump(award).data
        log_audit(action="award_update", before=before, after=after,
                  data={"award_id": record_id, "name": after["name"]})
        clear_standings()
        return {"success": True, "data": after}

    @admins_only
    @awards_namespace.doc(
        description="Endpoint to get a specific Award object",
        responses={
            200: ("Success", "AwardDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def get(self, award_id):
        award = Awards.query.filter_by(id=award_id).first_or_404()
        response = AwardSchema().dump(award)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data}

    @admins_only
    @awards_namespace.doc(
        description="Endpoint to delete an Award object",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self, award_id):
        award = Awards.query.filter_by(id=award_id).first_or_404()
        award_info = {
            "award_id": award.id,
            "user_id": award.user_id,
            "team_id": award.team_id,
            "name": award.name,
            "value": award.value,
            "type": award.type,
            "description": award.description,
            "date": str(award.date) if award.date else None,
            "category": award.category,
            "icon": award.icon,
        }
        db.session.delete(award)
        db.session.commit()
        db.session.close()

        log_audit(
            action="award_delete",
            before=award_info,
            data={"award_id": int(award_id), "name": award_info["name"]},
        )

        # Delete standings cache because awards can change scores
        clear_standings()

        return {"success": True}
