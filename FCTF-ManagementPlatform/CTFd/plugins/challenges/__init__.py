from flask import Blueprint, jsonify, session
import json

from CTFd.models import (
    ChallengeFiles,
    Challenges,
    Fails,
    Flags,
    Hints,
    Solves,
    Tags,
    db,
)
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.flags import FlagException, get_flag_class
from CTFd.utils.uploads import delete_file
from CTFd.utils.user import get_ip


class BaseChallenge(object):
    id = None
    name = None
    templates = {}
    scripts = {}
    challenge_model = Challenges

    @classmethod
    def create(cls, request, extra_data=None):
        """
        This method is used to process the challenge creation request.

        :param request:
        :param extra_data: optional dict of server-validated fields (e.g. contest_id) to
                           merge into the request data before model creation.
        :return:
        """
        data = request.form or request.get_json()
        data = dict(data)
        # Strip fields that are not Challenges model columns
        data.pop("contest_token", None)
        data.pop("file_upload", None)
        # Form sends user_id but model column is created_by
        if "user_id" in data:
            data.setdefault("created_by", data.pop("user_id"))
        # Merge server-validated fields (higher priority than client data)
        if extra_data:
            data.update(extra_data)
        for key in ("cpu_limit", "cpu_request", "memory_limit", "memory_request", "max_deploy_count"):
            if key in data and data[key] is not None:
                try:
                    data[key] = int(data[key])
                except (TypeError, ValueError):
                    pass
        if "use_gvisor" in data:
            if isinstance(data["use_gvisor"], str):
                data["use_gvisor"] = data["use_gvisor"].lower() in ("true", "1", "yes", "on")
        if "harden_container" in data:
            if isinstance(data["harden_container"], str):
                data["harden_container"] = data["harden_container"].lower() in ("true", "1", "yes", "on")
        if "shared_instant" in data:
            if isinstance(data["shared_instant"], str):
                data["shared_instant"] = data["shared_instant"].lower() in ("true", "1", "yes", "on")
        # Handle difficulty: convert empty string to None, valid string to int
        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None
        # Remove any keys not present as model columns to avoid TypeError
        valid_columns = {c.name for c in cls.challenge_model.__table__.columns}
        data = {k: v for k, v in data.items() if k in valid_columns}
        if int(data.get("time_limit", 0)) >= -1:
            challenge = cls.challenge_model(**data)

            db.session.add(challenge)
            db.session.commit()
        else:
            return jsonify({"error": "Time limit must be greater than -1"}), 400
        return challenge

    @classmethod
    def read(cls, challenge):
        """
        This method is in used to access the data of a challenge in a format processable by the front end.

        :param challenge:
        :return: Challenge object, data dictionary to be returned to the user
        """
        data = {
            "id": challenge.id,
            "name": challenge.name,
            "value": challenge.value,
            "description": challenge.description,
            "connection_info": challenge.connection_info,
            "next_id": challenge.next_id,
            "category": challenge.category,
            "state": challenge.state,
            "max_attempts": challenge.max_attempts,
            "type": challenge.type,
            "require_deploy": challenge.require_deploy,
            "max_deploy_count": challenge.max_deploy_count,
            "shared_instant": challenge.shared_instant,
            "type_data": {
                "id": cls.id,
                "name": cls.name,
                "templates": cls.templates,
                "scripts": cls.scripts,
            },
        }
        return data

    @classmethod
    def update(cls, challenge, request):
        """
        This method is used to update the information associated with a challenge. This should be kept strictly to the
        Challenges table and any child tables.

        :param challenge:
        :param request:
        :return:
        """
        data = request.form or request.get_json()
        data = dict(data)

        for key in ("cpu_limit", "cpu_request", "memory_limit", "memory_request", "max_deploy_count"):
            if key in data and data[key] is not None:
                try:
                    data[key] = int(data[key])
                except (TypeError, ValueError):
                    pass
        if "use_gvisor" in data:
            if isinstance(data["use_gvisor"], str):
                data["use_gvisor"] = data["use_gvisor"].lower() in ("true", "1", "yes", "on")
        if "harden_container" in data:
            if isinstance(data["harden_container"], str):
                data["harden_container"] = data["harden_container"].lower() in ("true", "1", "yes", "on")
        if "shared_instant" in data:
            if isinstance(data["shared_instant"], str):
                data["shared_instant"] = data["shared_instant"].lower() in ("true", "1", "yes", "on")
        # Handle difficulty: convert empty string to None, valid string to int
        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None

        # Handle expose_port - store in image_link JSON
        if "expose_port" in data and data["expose_port"] is not None:
            try:
                expose_port_str = str(data["expose_port"])
                # Remove expose_port from data so it doesn't get set as a direct attribute
                del data["expose_port"]
                
                # Update image_link JSON with exposedPort
                image_obj = {}
                if challenge.image_link:
                    try:
                        parsed = json.loads(challenge.image_link)
                        if isinstance(parsed, dict):
                            image_obj = parsed
                        else:
                            image_obj = {"imageLink": challenge.image_link}
                    except (TypeError, ValueError, json.JSONDecodeError):
                        image_obj = {"imageLink": challenge.image_link}
                
                image_obj["exposedPort"] = expose_port_str
                challenge.image_link = json.dumps(image_obj)
            except (TypeError, ValueError):
                # Invalid expose_port, skip updating
                if "expose_port" in data:
                    del data["expose_port"]

        # Kiểm tra nếu 'time_limit' có trong dữ liệu và kiểm tra giá trị của nó
        if "time_limit" in data:
            if int(data["time_limit"]) >= -1:
                for attr, value in data.items():
                    setattr(challenge, attr, value)
                db.session.commit()
            else:
                return jsonify({"error": "Time limit must be greater than -1"}), 400
        else:
            for attr, value in data.items():
                setattr(challenge, attr, value)
            db.session.commit()

        return challenge


    @classmethod
    def delete(cls, challenge):
        """
        This method is used to delete the resources used by a challenge.

        :param challenge:
        :return:
        """
        Fails.query.filter_by(challenge_id=challenge.id).delete()
        Solves.query.filter_by(challenge_id=challenge.id).delete()
        Flags.query.filter_by(challenge_id=challenge.id).delete()
        files = ChallengeFiles.query.filter_by(challenge_id=challenge.id).all()
        for f in files:
            delete_file(f.id)
        ChallengeFiles.query.filter_by(challenge_id=challenge.id).delete()
        Tags.query.filter_by(challenge_id=challenge.id).delete()
        Hints.query.filter_by(challenge_id=challenge.id).delete()
        Challenges.query.filter_by(id=challenge.id).delete()
        cls.challenge_model.query.filter_by(id=challenge.id).delete()
        db.session.commit()

    @classmethod
    def attempt(cls, challenge, request):
        """
        This method is used to check whether a given input is right or wrong. It does not make any changes and should
        return a boolean for correctness and a string to be shown to the user. It is also in charge of parsing the
        user's input from the request itself.

        :param challenge: The Challenge object from the database
        :param request: The request the user submitted
        :return: (boolean, string)
        """
        data = request.form or request.get_json()
        submission = data["submission"].strip()
        flags = Flags.query.filter_by(challenge_id=challenge.id).all()

        team_id = None
        flags_list = list(flags)
        if any(f.type == "dynamic" for f in flags_list):
            team_id = cls._get_team_id()

        for flag in flags_list:
            try:
                if flag.type == "dynamic":
                    from CTFd.plugins.flags import CTFdDynamicFlag
                    if CTFdDynamicFlag.compare(flag, submission, team_id=team_id):
                        return True, "Correct"
                else:
                    if get_flag_class(flag.type).compare(flag, submission):
                        return True, "Correct"
            except FlagException as e:
                return False, str(e)
        return False, "Incorrect"

    @staticmethod
    def _get_team_id():
        from CTFd.utils.user import get_current_user
        user = get_current_user()
        return user.team_id if user else None

    @classmethod
    def solve(cls, user, team, challenge, request):
        """
        This method is used to insert Solves into the database in order to mark a challenge as solved.

        :param team: The Team object from the database
        :param chal: The Challenge object from the database
        :param request: The request the user submitted
        :return:
        """
        data = request.form or request.get_json()
        submission = data["submission"].strip()
        solve = Solves(
            user_id=user.id,
            team_id=team.id if team else None,
            challenge_id=challenge.id,
            ip=get_ip(req=request),
            provided=submission,
        )
        db.session.add(solve)
        db.session.commit()

    @classmethod
    def fail(cls, user, team, challenge, request):
        """
        This method is used to insert Fails into the database in order to mark an answer incorrect.

        :param team: The Team object from the database
        :param chal: The Challenge object from the database
        :param request: The request the user submitted
        :return:
        """
        data = request.form or request.get_json()
        submission = data["submission"].strip()
        wrong = Fails(
            user_id=user.id,
            team_id=team.id if team else None,
            challenge_id=challenge.id,
            ip=get_ip(request),
            provided=submission,
        )
        db.session.add(wrong)
        db.session.commit()


class CTFdSandboxChallenge(BaseChallenge):
    id = "sandbox"
    name = "sandbox"
    templates = {
        "create": "/plugins/challenges/assets/create.html",
        "update": "/plugins/challenges/assets/update.html",
        "view": "/plugins/challenges/assets/view.html",
    }
    scripts = {
        "create": "/plugins/challenges/assets/create.js",
        "update": "/plugins/challenges/assets/update.js",
        "view": "/plugins/challenges/assets/view.js",
    }
    route = "/plugins/challenges/assets/"

    @classmethod
    def create(cls, request, extra_data=None):
        from CTFd.models import SandboxChallenge, db as _db
        import json as _json

        data = request.form or request.get_json()
        data = dict(data)
        data.pop("contest_token", None)
        data.pop("file_upload", None)
        if "user_id" in data:
            data.setdefault("created_by", data.pop("user_id"))
        if extra_data:
            data.update(extra_data)

        # Extract pool_id before column filtering
        pool_id = None
        if "pool_id" in data:
            try:
                pool_id = int(data["pool_id"])
            except (TypeError, ValueError):
                pool_id = None

        # Convert numeric fields
        for key in ("cpu_limit", "cpu_request", "memory_limit", "memory_request", "max_deploy_count"):
            if key in data and data[key] is not None:
                try:
                    data[key] = int(data[key])
                except (TypeError, ValueError):
                    pass

        # Convert booleans
        for bool_key in ("use_gvisor", "harden_container", "shared_instant"):
            if bool_key in data and isinstance(data[bool_key], str):
                data[bool_key] = data[bool_key].lower() in ("true", "1", "yes", "on")

        # Handle difficulty
        if "difficulty" in data:
            v = data["difficulty"]
            if v is None or (isinstance(v, str) and v.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(v)
                except (TypeError, ValueError):
                    data["difficulty"] = None

        # Allow columns from both challenges (parent) + sandbox_challenge (child)
        parent_cols = {c.name for c in Challenges.__table__.columns}
        child_cols  = {c.name for c in SandboxChallenge.__table__.columns}
        valid_cols  = (parent_cols | child_cols) - {"id"}   # exclude PK (auto)

        data = {k: v for k, v in data.items() if k in valid_cols}

        # Force correct type and pool_id
        data["type"]    = "sandbox"
        data["pool_id"] = pool_id

        if int(data.get("time_limit", 0)) >= -1:
            challenge = SandboxChallenge(**data)
            _db.session.add(challenge)
            _db.session.commit()
        else:
            from flask import jsonify
            return jsonify({"error": "Time limit must be greater than -1"}), 400

        return challenge


class CTFdStandardChallenge(BaseChallenge):
    id = "standard"  # Unique identifier used to register challenges
    name = "standard"  # Name of a challenge type
    templates = {  # Templates used for each aspect of challenge editing & viewing
        "create": "/plugins/challenges/assets/create.html",
        "update": "/plugins/challenges/assets/update.html",
        "view": "/plugins/challenges/assets/view.html",
    }
    scripts = {  # Scripts that are loaded when a template is loaded
        "create": "/plugins/challenges/assets/create.js",
        "update": "/plugins/challenges/assets/update.js",
        "view": "/plugins/challenges/assets/view.js",
    }
    # Route at which files are accessible. This must be registered using register_plugin_assets_directory()
    route = "/plugins/challenges/assets/"
    # Blueprint used to access the static_folder directory.
    blueprint = Blueprint(
        "standard", __name__, template_folder="templates", static_folder="assets"
    )
    challenge_model = Challenges


def get_chal_class(class_id):
    """
    Utility function used to get the corresponding class from a class ID.

    :param class_id: String representing the class ID
    :return: Challenge class
    """
    cls = CHALLENGE_CLASSES.get(class_id)
    if cls is None:
        raise KeyError
    return cls


"""
Global dictionary used to hold all the Challenge Type classes used by CTFd. Insert into this dictionary to register
your Challenge Type.
"""
CHALLENGE_CLASSES = {
    "standard": CTFdStandardChallenge,
    "sandbox":  CTFdSandboxChallenge,
}


def load(app):
    register_plugin_assets_directory(app, base_path="/plugins/challenges/assets/")
