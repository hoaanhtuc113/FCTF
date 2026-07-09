from typing import List
from flask import request
from flask_restx import Namespace, Resource
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ValidationError
from CTFd.models import Tokens, Users, Challenges
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.models import ActionLogs, db
from CTFd.utils.decorators import admins_only
from CTFd.utils.user import get_current_user
from CTFd.utils.connector.multiservice_connector import get_token_from_header
from CTFd.utils.action_logs import (
    send_action_logs_to_client,
    send_challenge_selected_event,
    get_topic_name,
)

action_logs_namespace = Namespace(
    "action_logs", description="Endpoint for action logging"
)

ActionLogModel = sqlalchemy_to_pydantic(ActionLogs)


class ActionLogDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: ActionLogModel


class ActionLogListSuccessResponse(APIListSuccessResponse):
    data: List[ActionLogModel]


action_logs_namespace.schema_model(
    "ActionLogDetailedSuccessResponse", ActionLogDetailedSuccessResponse.apidoc()
)
action_logs_namespace.schema_model(
    "ActionLogListSuccessResponse", ActionLogListSuccessResponse.apidoc()
)


class ActionLogCreateSchema(BaseModel):
    actionType: int = Field(..., description="Type of action", ge=0)
    actionDetail: str = Field(
        ..., description="Details of the action", min_length=1, max_length=500
    )


def _to_camel(log_row, user_name: str) -> dict:
    """Map snake_case ActionLogs columns to camelCase keys expected by the frontend."""
    return {
        "actionId": log_row.id,
        "userId": log_row.user_id,
        "actionDate": log_row.date.isoformat() if log_row.date else None,
        "actionType": log_row.type,
        "actionDetail": log_row.detail,
        "topicName": log_row.topic_name,
        "userName": user_name,
    }


def _get_user_from_request():
    user = get_current_user()
    if user:
        return user, None
    token_val = get_token_from_header()
    if not token_val:
        return None, ({"success": False, "error": "No account or account has been banned"}, 403)
    token = Tokens.query.filter_by(value=token_val).first()
    if token is None:
        return None, ({"success": False, "error": "Token not found"}, 404)
    user = Users.query.filter_by(id=token.user_id).first()
    return user, None


@action_logs_namespace.route("")
class ActionLogList(Resource):
    def get(self):
        """Retrieve team action logs"""
        try:
            rows = (
                db.session.query(ActionLogs, Users.name.label("userName"))
                .join(Users, ActionLogs.user_id == Users.id)
                .order_by(ActionLogs.date.desc())
                .all()
            )
            if not rows:
                return {"success": False, "error": "No logs found"}, 404
            data = [_to_camel(row.ActionLogs, row.userName) for row in rows]
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

    def post(self):
        """Create a new action log"""
        try:
            user, err = _get_user_from_request()
            if err:
                return err

            req_data = request.get_json()
            if not req_data or "challenge_id" not in req_data:
                return {"success": False, "error": "Invalid request data"}, 400

            challenge_id = req_data.get("challenge_id")
            topic_name = get_topic_name(challenge_id)

            challenge = Challenges.query.filter_by(id=challenge_id).first()
            challenge_name = challenge.name if challenge else "Unknown"

            validated_data = ActionLogCreateSchema.parse_obj(req_data)

            log = ActionLogs(
                user_id=user.id,
                date=datetime.now(timezone.utc),
                type=validated_data.actionType,
                detail=validated_data.actionDetail,
                topic_name=topic_name,
            )
            db.session.add(log)
            db.session.commit()

            all_rows = (
                db.session.query(ActionLogs, Users.name.label("userName"))
                .join(Users, ActionLogs.user_id == Users.id)
                .order_by(ActionLogs.date.desc())
                .all()
            )
            serialized = [_to_camel(row.ActionLogs, row.userName) for row in all_rows]
            send_action_logs_to_client(serialized)
            send_challenge_selected_event(
                user_id=user.id,
                topic_name=topic_name,
                challenge_id=challenge_id,
                challenge_name=challenge_name,
                action_type=validated_data.actionType,
                action_date=datetime.now(timezone.utc).isoformat(),
            )

            return {"success": True, "data": _to_camel(log, user.name)}, 200
        except ValidationError as e:
            return {"success": False, "error": e.errors()}, 400
        except Exception as e:
            return {"success": False, "error": str(e)}, 500


@action_logs_namespace.route("/<int:log_id>")
class ActionLog(Resource):
    def get(self, log_id):
        """Retrieve a specific action log"""
        try:
            user, err = _get_user_from_request()
            if err:
                return err

            log = ActionLogs.query.filter_by(id=log_id).first()
            if not log:
                return {"success": False, "error": "Action log not found"}, 404
            if log.user_id != user.id and user.type != "admin":
                return {"success": False, "error": "Permission denied"}, 403

            return {"success": True, "data": _to_camel(log, user.name)}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

    @admins_only
    def delete(self, log_id):
        """Delete a specific action log"""
        try:
            log = ActionLogs.query.filter_by(id=log_id).first()
            if not log:
                return {"success": False, "error": "Action log not found"}, 404
            db.session.delete(log)
            db.session.commit()
            return {"success": True}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500


@action_logs_namespace.route("/user/<int:user_id>")
class UserActionLog(Resource):
    def get(self, user_id):
        """Retrieve action logs of a specific user"""
        try:
            user, err = _get_user_from_request()
            if err:
                return err

            if user.type != "admin" and user.id != user_id:
                return {"success": False, "error": "Permission denied"}, 403

            rows = (
                db.session.query(ActionLogs, Users.name.label("userName"))
                .join(Users, ActionLogs.user_id == Users.id)
                .filter(ActionLogs.user_id == user_id)
                .order_by(ActionLogs.date.desc())
                .all()
            )
            if not rows:
                return {"success": False, "error": "No action logs found for this user"}, 404

            return {"success": True, "data": [_to_camel(r.ActionLogs, r.userName) for r in rows]}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500
