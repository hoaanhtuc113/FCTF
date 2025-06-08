from flask import Blueprint, request, jsonify, session
from CTFd.cache import clear_team_session, clear_user_session
from CTFd.models import (
    Brackets,
    TeamFieldEntries,
    TeamFields,
    Tokens,
    UserFieldEntries,
    UserFields,
    Users,
    Teams,
    db,
)
from CTFd.plugins import bypass_csrf_protection
from CTFd.utils.crypto import verify_password, hash_password
from datetime import datetime, timedelta
from CTFd.utils.security.auth import generate_user_token
from CTFd.utils.security.csrf import generate_nonce
from CTFd.api.v1.users import validate_password
import re
from CTFd.utils.validators import ValidationError
from CTFd.utils import get_config, validators
from CTFd.utils.decorators.modes import require_team_mode
from CTFd.api.v1.users import authenticate_user
from CTFd.utils.decorators import ratelimit
from CTFd.constants.config import ConfigTypes, RegistrationVisibilityTypes
from CTFd.utils.dates import ctftime, ctf_ended
from datetime import datetime
from CTFd.utils.maps import add_character_to_map

LoginUser = Blueprint("login", __name__)


@LoginUser.route("/api/login-contestant", methods=["POST"])
@bypass_csrf_protection
def login():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    session["nonce"] = generate_nonce()

    if not username or not password:
        return jsonify({"msg": "Missing username or password"}), 400

    user = Users.query.filter_by(name=username).first()

    if user and verify_password(password, user.password) and user.type == "user":
        expiration = datetime.now() + timedelta(days=1)
        token = generate_user_token(
            user, expiration=expiration, description="Login token"
        )

        team = None
        if user.team_id:
            team = Teams.query.filter_by(id=user.team_id).first()
            session.regenerate()
        session["user_token"] = token.value
        if not team:
            return (
                jsonify(
                    {
                        "message": "you don't have a team yet",
                        "generatedToken": token.value,
                    }
                ),
                400,
            )

        user_data = {
            "id": user.id,
            "username": user.name,
            "email": user.email,
            "team": (
                {
                    "id": team.id if team else None,
                    "teamName": team.name if team else None,
                }
                if team
                else None
            ),
        }

        add_character_to_map(
            {
                "id": user.id,
                "name": user.name,
                "team": team.name if team else "No team",
                "time": datetime.now().strftime("%H:%M:%S"),
                "date": datetime.now().strftime("%Y-%m-%d"),
            }
        )

        return jsonify({"generatedToken": token.value, "user": user_data}), 200

    return jsonify({"msg": "Invalid credentials or unauthorized user type"}), 401


@LoginUser.route("/api/changepassword", methods=["POST"])
@bypass_csrf_protection
def change_password():
    data = request.form.to_dict()
    current_password = data.get("current_password")
    new_password = data.get("new_password")
    token = data.get("generatedToken")
    if not current_password or not new_password:
        return jsonify({"msg": "Missing current or new password"}), 400

    tokens = Tokens.query.filter_by(value=token).first_or_404()
    user = Users.query.filter_by(id=tokens.user_id).first()

    if user and verify_password(current_password, user.password):
        if len(new_password) < 8:
            return (
                jsonify({"msg": "New password must be at least 8 characters long"}),
                400,
            )

        if new_password == current_password:
            return (
                jsonify(
                    {"msg": "New password cannot be the same as the current password"}
                ),
                400,
            )

        user.password = hash_password(new_password)
        db.session.commit()
        return jsonify({"msg": "Password updated successfully"}), 200
    else:
        return jsonify({"msg": "Current password is incorrect"}), 401


def validate_email(email, email_regex):
    return bool(re.match(email, email_regex))


@LoginUser.route("/api/register-contestant", methods=["POST"])
@bypass_csrf_protection
def register():
    try:
        register_config = get_config(ConfigTypes.REGISTRATION_VISIBILITY)
        if register_config == RegistrationVisibilityTypes.PRIVATE:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "You are not allowed to register at this time.",
                    }
                ),
                400,
            )

        data = request.form.to_dict()
        username = data.get("username")
        email = data.get("email")
        password = data.get("password")

        print(username)
        print(email)
        print(password)

        if not username or not password or not email:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Missing one or more required fields!",
                    }
                ),
                400,
            )

        # Check if username or email already exists
        users = Users.query.filter_by(name=username).first()
        emails = Users.query.filter_by(email=email).first()

        email_regex = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"

        # Validate email
        if not re.match(email_regex, email):
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Email does not match the required format",
                    }
                ),
                400,
            )

        # Validate password
        if not validate_password(password):
            return (
                jsonify(
                    {"success": False, "message": "Password does not meet the criteria"}
                ),
                400,
            )

        # Check if username or email is already taken
        if users:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Username exists! Try a different username",
                    }
                ),
                400,
            )

        if emails:
            return (
                jsonify(
                    {"success": False, "message": "Email exists! Try a different email"}
                ),
                400,
            )

        # Optional fields
        website = data.get("website")
        affiliation = data.get("affiliation")
        country = data.get("country")
        registration_code = str(data.get("registration_code", ""))
        bracket_id = data.get("bracket_id", None)

        if country:
            try:
                validators.validate_country_code(country)
            except ValidationError:
                return (
                    jsonify({"success": False, "message": "Invalid country code"}),
                    400,
                )

        if website and not validators.validate_url(website):
            return jsonify({"success": False, "message": "Invalid website URL"}), 400

        if affiliation and len(affiliation) >= 128:
            return (
                jsonify({"success": False, "message": "Affiliation name is too long"}),
                400,
            )

        if bracket_id:
            bracket = Brackets.query.filter_by(id=bracket_id, type="users").first()
            if not bracket:
                return jsonify({"success": False, "message": "Invalid bracket ID"}), 400

        fields = {field.id: field for field in UserFields.query.all()}
        entries = {}
        for field_id, field in fields.items():
            value = data.get(f"fields[{field_id}]", "").strip()
            if field.required and not value:
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"Field '{field.name}' is required",
                        }
                    ),
                    400,
                )

            entries[field_id] = bool(value) if field.field_type == "boolean" else value

        # Create and save user
        user = Users(
            name=username,
            email=email,
            password=password,
            bracket_id=bracket_id,
        )

        if website:
            user.website = website
        if affiliation:
            user.affiliation = affiliation
        if country:
            user.country = country

        db.session.add(user)
        db.session.flush()

        # Save custom field entries
        for field_id, value in entries.items():
            entry = UserFieldEntries(field_id=field_id, value=value, user_id=user.id)
            db.session.add(entry)

        db.session.commit()

        return (
            jsonify({"success": True, "message": "Contestant registered successfully"}),
            201,
        )

    except Exception as e:

        print(f"Error during registration: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "message": "An unexpected error occurred. Please try again later.",
                }
            ),
            500,
        )


@LoginUser.route("/api/team/create", methods=["POST", "GET"])
@bypass_csrf_protection
@require_team_mode
def create_team():
    errors = []
    if ctftime():
        return (
            jsonify(
                {
                    "success": False,
                    "message": "You are not allowed to join a team at this time",
                }
            ),
            400,
        )
    if ctf_ended:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "You are not allowed to join a team at this time",
                }
            ),
            400,
        )
    data = request.form.to_dict() or request.get_json()
    user = authenticate_user()

    if not user:
        return jsonify({"success": False, "message": "You must log in first"}), 400

    if not get_config("team_creation", default=True):
        return (
            jsonify(
                {
                    "success": False,
                    "errors": [
                        "Team creation is currently disabled. Please join an existing team."
                    ],
                }
            ),
            400,
        )

    num_teams_limit = int(get_config("num_teams", default=0))
    num_teams = Teams.query.filter_by(banned=False, hidden=False).count()
    if num_teams_limit and num_teams >= num_teams_limit:
        return (
            jsonify(
                {
                    "success": False,
                    "errors": [
                        f"Reached the maximum number of teams ({num_teams_limit}). Please join an existing team."
                    ],
                }
            ),
            400,
        )

    if user.team_id:
        return jsonify({"success": False, "message": "You are already in a team"}), 400

    teamname = data.get("teamName", "").strip()
    passphrase = data.get("teamPassword", "").strip()
    website = data.get("website")
    affiliation = data.get("affiliation")
    country = data.get("country")
    bracket_id = data.get("bracket_id")

    # Validate team name
    if not teamname:
        errors.append("Team name is required")
    elif Teams.query.filter_by(name=teamname).first():
        errors.append("That team name is already taken")

    # Validate additional fields
    fields = {field.id: field for field in TeamFields.query.all()}
    entries = {}
    for field_id, field in fields.items():
        value = data.get(f"fields[{field_id}]", "").strip()
        if field.required and not value:
            errors.append("Please provide all required fields")
            break
        entries[field_id] = bool(value) if field.field_type == "boolean" else value

    # Additional validations
    if website and not validators.validate_url(website):
        errors.append("Websites must be a proper URL starting with http or https")
    if affiliation and len(affiliation) >= 128:
        errors.append("Affiliation must be shorter than 128 characters")
    if country:
        try:
            validators.validate_country_code(country)
        except ValidationError:
            errors.append("Invalid country")
    if bracket_id:
        valid_bracket = (
            Brackets.query.filter_by(id=bracket_id, type="teams").first() is not None
        )
    else:
        valid_bracket = not Brackets.query.filter_by(type="teams").count()
    if not valid_bracket:
        errors.append("Please provide a valid bracket")

    if errors:
        return jsonify({"success": False, "errors": errors}), 400

    # Hide the team if the creator is an admin
    hidden = user.type == "admin"

    # Create the team
    team = Teams(
        name=teamname,
        password=passphrase,
        captain_id=user.id,
        hidden=hidden,
        bracket_id=bracket_id,
        website=website or None,
        affiliation=affiliation or None,
        country=country or None,
    )
    db.session.add(team)
    db.session.commit()

    # Add custom field entries
    for field_id, value in entries.items():
        entry = TeamFieldEntries(field_id=field_id, value=value, team_id=team.id)
        db.session.add(entry)
    db.session.commit()

    # Assign team to user
    user.team_id = team.id
    db.session.commit()

    # Clear sessions
    clear_user_session(user_id=user.id)
    clear_team_session(team_id=team.id)

    return (
        jsonify(
            {
                "success": True,
                "message": "Team created successfully",
                "team_id": team.id,
            }
        ),
        201,
    )


@LoginUser.route("/api/team/join", methods=["GET", "POST"])
@bypass_csrf_protection
@require_team_mode
@ratelimit(method="POST", limit=10, interval=5)
def joinTeam():
    try:
        if ctftime():
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "You are not allowed to join a team at this time",
                    }
                ),
                400,
            )
        if ctf_ended:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "You are not allowed to create a team at this time",
                    }
                ),
                400,
            )

        data = request.form.to_dict() or request.get_json()
        user = authenticate_user()
        if not user:
            return jsonify({"success": False, "message": "You must login first"}), 400

        if user.team_id:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "You are already in a team",
                        "team": user.team_id,
                    }
                ),
                400,
            )

        teamname = data.get("teamName", "").strip()
        password = data.get("teamPassword", "").strip()

        team = Teams.query.filter_by(name=teamname).first()
        if team and verify_password(password, team.password):
            team_size_limit = get_config("team_size", default=0)
            if team_size_limit and len(team.members) >= team_size_limit:
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"{team.name} has already reached the team size limit of {team_size_limit}",
                        }
                    ),
                    400,
                )

            team.members.append(user)
            db.session.commit()
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Successfully joined the team!",
                        "team": team.name,
                    }
                ),
                200,
            )

        return (
            jsonify({"success": False, "message": "Wrong team name or password"}),
            400,
        )

    except Exception as e:

        return (
            jsonify(
                {
                    "success": False,
                    "message": "An unexpected error occurred",
                    "error": str(e),
                }
            ),
            500,
        )
