from flask import Blueprint, abort, current_app, redirect
from flask_restx import Api

from CTFd.utils.decorators import admins_only

from CTFd.api.v1.awards import awards_namespace
from CTFd.api.v1.brackets import brackets_namespace
from CTFd.api.v1.challenges import challenges_namespace
from CTFd.api.v1.comments import comments_namespace
from CTFd.api.v1.config import configs_namespace
from CTFd.api.v1.exports import exports_namespace
from CTFd.api.v1.files import files_namespace
from CTFd.api.v1.flags import flags_namespace
from CTFd.api.v1.hints import hints_namespace
from CTFd.api.v1.schemas import (
    APIDetailedSuccessResponse,
    APISimpleErrorResponse,
    APISimpleSuccessResponse,
)
from CTFd.api.v1.statistics import statistics_namespace
from CTFd.api.v1.submissions import submissions_namespace
from CTFd.api.v1.tags import tags_namespace
from CTFd.api.v1.teams import teams_namespace
from CTFd.api.v1.tokens import tokens_namespace
from CTFd.api.v1.topics import topics_namespace
from CTFd.api.v1.users import users_namespace
from CTFd.api.v1.action_logs import action_logs_namespace

api = Blueprint("api", __name__, url_prefix="/api/v1")


@api.route("")
@admins_only
def api_v1_root():
    """Redirect /api/v1 to the Swagger UI when enabled."""

    doc_endpoint = current_app.config.get("SWAGGER_UI_ENDPOINT")
    if doc_endpoint:
        if not doc_endpoint.startswith("/"):
            doc_endpoint = f"/{doc_endpoint}"
        return redirect(f"/api/v1{doc_endpoint}")
    abort(404)

CTFd_API_v1 = Api(
    api,
    version="v1",
    doc=current_app.config.get("SWAGGER_UI_ENDPOINT"),
    authorizations={
        "AccessToken": {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "Generate access token in the settings page of your user account.",
        },
        "ContentType": {
            "type": "apiKey",
            "in": "header",
            "name": "Content-Type",
            "description": "Must be set to `application/json`",
        },
    },
    security=["AccessToken", "ContentType"],
)

CTFd_API_v1.schema_model("APISimpleErrorResponse", APISimpleErrorResponse.schema())
CTFd_API_v1.schema_model(
    "APIDetailedSuccessResponse", APIDetailedSuccessResponse.schema()
)
CTFd_API_v1.schema_model("APISimpleSuccessResponse", APISimpleSuccessResponse.schema())

CTFd_API_v1.add_namespace(challenges_namespace, "/challenges")
CTFd_API_v1.add_namespace(tags_namespace, "/tags")
CTFd_API_v1.add_namespace(topics_namespace, "/topics")
CTFd_API_v1.add_namespace(awards_namespace, "/awards")
CTFd_API_v1.add_namespace(hints_namespace, "/hints")
CTFd_API_v1.add_namespace(flags_namespace, "/flags")
CTFd_API_v1.add_namespace(submissions_namespace, "/submissions")
CTFd_API_v1.add_namespace(teams_namespace, "/teams")
CTFd_API_v1.add_namespace(users_namespace, "/users")
CTFd_API_v1.add_namespace(statistics_namespace, "/statistics")
CTFd_API_v1.add_namespace(files_namespace, "/files")
CTFd_API_v1.add_namespace(configs_namespace, "/configs")
CTFd_API_v1.add_namespace(tokens_namespace, "/tokens")
CTFd_API_v1.add_namespace(comments_namespace, "/comments")
CTFd_API_v1.add_namespace(brackets_namespace, "/brackets")
CTFd_API_v1.add_namespace(exports_namespace, "/exports")
CTFd_API_v1.add_namespace(action_logs_namespace, "/action_logs")
