from typing import List

from flask import request, session
from flask_restx import Namespace, Resource
from marshmallow import ValidationError
from CTFd.models import Challenges, Users, Teams
from CTFd.utils.validators.references import reference, text_field

from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.constants import RawEnum
from CTFd.models import (
    ChallengeComments,
    Comments,
    TeamComments,
    UserComments,
    db,
)
from CTFd.schemas.comments import CommentSchema
from CTFd.utils.decorators import admins_only
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.logging.audit_logger import log_audit

comments_namespace = Namespace("comments", description="Endpoint to retrieve Comments")


CommentModel = sqlalchemy_to_pydantic(Comments)


class CommentDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: CommentModel


class CommentListSuccessResponse(APIListSuccessResponse):
    data: List[CommentModel]


comments_namespace.schema_model(
    "CommentDetailedSuccessResponse", CommentDetailedSuccessResponse.apidoc()
)

comments_namespace.schema_model(
    "CommentListSuccessResponse", CommentListSuccessResponse.apidoc()
)


def get_comment_model(data):
    model = Comments
    if "challenge_id" in data:
        model = ChallengeComments
    elif "user_id" in data:
        model = UserComments
    elif "team_id" in data:
        model = TeamComments
    else:
        model = Comments
    return model


@comments_namespace.route("")
class CommentList(Resource):
    @admins_only
    @comments_namespace.doc(
        description="Endpoint to list Comment objects in bulk",
        responses={
            200: ("Success", "CommentListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    @validate_args(
        {
            "challenge_id": (int, None),
            "user_id": (int, None),
            "team_id": (int, None),
            "type": (RawEnum("CommentTypes", {name: name for name in ("standard", "challenge", "user", "team")}), None),
            "q": (str, None),
            "field": (RawEnum("CommentFields", {"content": "content"}), None),
        },
        location="query",
    )
    def get(self, query_args):
        if "type" in query_args:
            query_args["type"] = str(query_args["type"])
        target_fields = {"challenge": "challenge_id", "user": "user_id", "team": "team_id"}
        target = target_fields.get(str(query_args.get("type")))
        if target is None or target not in query_args or query_args[target] <= 0 or any(key in query_args for key in target_fields.values() if key != target):
            return {"success": False, "errors": {"type": ["Provide a comment type and its positive target ID"]}}, 400
        q = query_args.pop("q", None)
        field = str(query_args.pop("field", None))
        CommentModel = get_comment_model(data=query_args)
        filters = build_model_filters(model=CommentModel, query=q, field=field)

        comments = (
            CommentModel.query.filter_by(**query_args)
            .filter(*filters)
            .order_by(CommentModel.id.desc())
            .paginate(max_per_page=100, error_out=False)
        )
        schema = CommentSchema(many=True)
        response = schema.dump(comments.items)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {
            "meta": {
                "pagination": {
                    "page": comments.page,
                    "next": comments.next_num,
                    "prev": comments.prev_num,
                    "pages": comments.pages,
                    "per_page": comments.per_page,
                    "total": comments.total,
                }
            },
            "success": True,
            "data": response.data,
        }

    @admins_only
    @comments_namespace.doc(
        description="Endpoint to create a Comment object",
        responses={
            200: ("Success", "CommentDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def post(self):
        req = request.get_json()
        if not isinstance(req, dict):
            return {"success": False, "errors": {"_schema": ["Expected a JSON object"]}}, 400
        try:
            text_field(req, "content", required=True)
            targets = [key for key in ("challenge_id", "user_id", "team_id") if key in req]
            if len(targets) > 1 or set(req) - {"content", "challenge_id", "user_id", "team_id", "type", "author_id"}:
                raise ValidationError("Provide at most one target and supported fields only")
            for field, model in (("challenge_id", Challenges), ("user_id", Users), ("team_id", Teams)):
                reference(req, field, model)
            expected_type = targets[0].removesuffix("_id") if targets else "standard"
            if req.get("type", expected_type) != expected_type:
                raise ValidationError("Comment type must match its target", field_names=["type"])
            req["type"] = expected_type
        except ValidationError as error:
            return {"success": False, "errors": error.messages}, 400
        # Always force author IDs to be the actual user
        req["author_id"] = session["id"]
        CommentModel = get_comment_model(data=req)

        m = CommentModel(**req)
        db.session.add(m)
        db.session.commit()

        schema = CommentSchema()

        response = schema.dump(m)
        db.session.close()

        log_audit(
            action="comment_create",
            data={
                "comment_id": response.data.get("id"),
                "type": response.data.get("type"),
                "content": response.data.get("content"),
                "date": str(response.data.get("date")) if response.data.get("date") else None,
                "challenge_id": response.data.get("challenge_id"),
                "user_id": response.data.get("user_id"),
                "team_id": response.data.get("team_id"),
                "author_id": response.data.get("author_id"),
            },
        )

        return {"success": True, "data": response.data}


@comments_namespace.route("/<comment_id>")
class Comment(Resource):
    @admins_only
    @comments_namespace.doc(
        description="Endpoint to delete a specific Comment object",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self, comment_id):
        comment = Comments.query.filter_by(id=comment_id).first_or_404()

        comment_info = {
            "comment_id": comment.id,
            "type": comment.type,
            "content": comment.content,
            "date": str(comment.date) if comment.date else None,
            "author_id": comment.author_id,
            "challenge_id": comment.challenge_id if hasattr(comment, 'challenge_id') else None,
            "user_id": comment.user_id if hasattr(comment, 'user_id') else None,
            "team_id": comment.team_id if hasattr(comment, 'team_id') else None,
        }

        db.session.delete(comment)
        db.session.commit()
        db.session.close()

        log_audit(
            action="comment_delete",
            before=comment_info,
            data={"comment_id": int(comment_id)},
        )

        return {"success": True}
