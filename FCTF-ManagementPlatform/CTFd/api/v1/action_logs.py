from typing import List
from flask import request
from flask_restx import Namespace, Resource
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ValidationError
from flask import jsonify
from CTFd.models import Tokens, Users, Challenges
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.models import ActionLogs, db
from CTFd.utils.decorators import admins_only
from CTFd.utils.user import get_current_user
from CTFd.utils.connector.multiservice_connector import get_token_from_header
from CTFd.models import (
    Tokens,
    Users,
)
from CTFd.utils.action_logs import (
    send_action_logs_to_client,
    send_challenge_selected_event,
    get_topic_name,
)

action_logs_namespace = Namespace(
    "action_logs", description="Endpoint for action logging"
)

# Convert SQLAlchemy model to Pydantic schema for validation
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


@action_logs_namespace.route("")
class ActionLogList(Resource):
    def get(self):
        """Retrieve action logs"""
        try:
            # Join ActionLogs, Users, and Challenges to get userName and challengeId
            logs_with_details = (
                db.session.query(
                    ActionLogs,
                    Users.name.label("userName"),
                )
                .join(Users, ActionLogs.userId == Users.id)
                .order_by(ActionLogs.actionDate.desc())
                .all()
            )

            if not logs_with_details:
                return {"success": False, "error": "No logs found"}, 404

            # Add challengeId to the response
            response = [
                {
                    **log.ActionLogs.to_dict(),
                    "userName": log.userName,
                }
                for log in logs_with_details
            ]
            return {"success": True, "data": response}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

    def post(self):
        """Create a new action log"""
        try:
            user = get_current_user()
            print(user)
            if not user:
                generatedToken = get_token_from_header()
                print("da nhan token")
                if not generatedToken:
                    return {
                        "success": False,
                        "error": "No account or account has been banned",
                    }, 403
                token = Tokens.query.filter_by(value=generatedToken).first()
                if token is None:
                    return {"success": False, "error": "Token not found"}, 404
                user = Users.query.filter_by(id=token.user_id).first()

            req_data = request.get_json()
            print("Request Data:", req_data)

            if not req_data or "challenge_id" not in req_data:
                return {"success": False, "error": "Invalid request data"}, 400

            challenge_id = req_data.get("challenge_id")
            topic_name = get_topic_name(challenge_id)

            challenge = Challenges.query.filter_by(id=challenge_id).first()
            challenge_name = challenge.name if challenge else "Unknown"

            validated_data = ActionLogCreateSchema.parse_obj(req_data)

            log = ActionLogs(
                userId=user.id,
                actionDate=datetime.now(timezone.uct).isoformat(),
                actionType=validated_data.actionType,
                actionDetail=validated_data.actionDetail,
                topicName=topic_name,
            )
            db.session.add(log)
            db.session.commit()

            logs_with_usernames = (
                db.session.query(ActionLogs, Users.name.label("userName"))
                .join(Users, ActionLogs.userId == Users.id)
                .order_by(ActionLogs.actionDate.desc())
                .all()
            )

            logs_with_usernames = [
                {**log.ActionLogs.to_dict(), "userName": log.userName}
                for log in logs_with_usernames
            ]
            send_action_logs_to_client(logs_with_usernames)
            send_challenge_selected_event(
                user_id=user.id,
                topic_name=topic_name,
                challenge_id=challenge_id,
                challenge_name=challenge_name,
                action_type=validated_data.actionType,
                action_date=datetime.now().isoformat(),
            )

            return {"success": True, "data": log.to_dict()}, 200
        except ValidationError as e:
            return {"success": False, "error": e.errors()}, 400
        except Exception as e:
            return {"success": False, "error": str(e)}, 500


@action_logs_namespace.route("/<int:log_id>")
class ActionLog(Resource):
    def get(self, log_id):
        """Retrieve a specific action log"""
        try:
            user = get_current_user()
            if not user:
                generatedToken = get_token_from_header()
                if not generatedToken:
                    return {
                        "success": False,
                        "error": "No account or account has been banned",
                    }, 403
                token = Tokens.query.filter_by(value=generatedToken).first()
                if token is None:
                    return {"success": False, "error": "Token not found"}, 404
                user = Users.query.filter_by(id=token.user_id).first()

            log = ActionLogs.query.filter_by(actionId=log_id).first()
            if not log:
                return {"success": False, "error": "Action log not found"}, 404

            if log.userId != user.id and user.type != "admin":
                return {"success": False, "error": "Permission denied"}, 403

            return {"success": True, "data": log.to_dict()}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

    @admins_only
    def delete(self, log_id):
        """Delete a specific action log"""
        try:
            log = ActionLogs.query.filter_by(actionId=log_id).first()
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
            user = get_current_user()
            if not user:
                generatedToken = get_token_from_header()
                if not generatedToken:
                    return {
                        "success": False,
                        "error": "No account or account has been banned",
                    }, 403
                token = Tokens.query.filter_by(value=generatedToken).first()
                if token is None:
                    return {"success": False, "error": "Token not found"}, 404
                user = Users.query.filter_by(id=token.user_id).first()

            logs = ActionLogs.query.filter_by(userId=user_id).all()
            if not logs:
                return {
                    "success": False,
                    "error": "No action logs found for this user",
                }, 404

            if user.type != "admin" and user.id != user_id:
                return {"success": False, "error": "Permission denied"}, 403

            logs_data = [log.to_dict() for log in logs]
            return {"success": True, "data": logs_data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 500
