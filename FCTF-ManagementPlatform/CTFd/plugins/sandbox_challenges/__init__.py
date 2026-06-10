from flask import Blueprint, jsonify

from CTFd.models import (
    ChallengeFiles,
    Challenges,
    Fails,
    Flags,
    Hints,
    KypoChallengeConfig,
    Solves,
    Tags,
    db,
)
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.challenges import CHALLENGE_CLASSES, BaseChallenge
from CTFd.utils.uploads import delete_file

# Fields that belong only to deploy-type challenges; must never be forwarded to
# the Challenges model constructor when creating a Sandbox challenge.
_DEPLOY_FIELDS = frozenset({
    "require_deploy", "deploy_status", "image_link", "deploy_file",
    "cpu_limit", "cpu_request", "memory_limit", "memory_request",
    "use_gvisor", "harden_container", "max_deploy_count", "shared_instant",
    "connection_protocol", "connection_info", "expose_port",
})

# Extra form-helper fields that are never DB columns.
_FORM_META_FIELDS = frozenset({
    "file_upload", "kypo_instance_select", "nonce", "kypo_flag",
})


class SandboxChallenge(Challenges):
    """
    Single-table inheritance: all data stays in the 'challenges' table.
    No extra DB table is created.
    """
    __mapper_args__ = {"polymorphic_identity": "sandbox"}

    kypo_config = db.relationship(
        "KypoChallengeConfig",
        foreign_keys="KypoChallengeConfig.challenge_id",
        primaryjoin="SandboxChallenge.id == KypoChallengeConfig.challenge_id",
        uselist=False,
        lazy="select",
        overlaps="challenge",
    )

    def __init__(self, *args, **kwargs):
        super(SandboxChallenge, self).__init__(**kwargs)


class SandboxChallengeClass(BaseChallenge):
    id = "sandbox"
    name = "sandbox"
    templates = {
        "create": "/plugins/sandbox_challenges/assets/create.html",
        "update": "/plugins/sandbox_challenges/assets/update.html",
        "view": "/plugins/sandbox_challenges/assets/view.html",
    }
    scripts = {
        "create": "/plugins/sandbox_challenges/assets/create.js",
        "update": "/plugins/sandbox_challenges/assets/update.js",
        "view": "/plugins/sandbox_challenges/assets/view.js",
    }
    route = "/plugins/sandbox_challenges/assets/"
    blueprint = Blueprint(
        "sandbox_challenges",
        __name__,
        template_folder="templates",
        static_folder="assets",
    )
    challenge_model = SandboxChallenge

    @classmethod
    def create(cls, request, extra_data=None):
        data = request.form or request.get_json()
        data = dict(data)
        if extra_data:
            data.update(extra_data)

        # Remove KYPO-specific fields before passing to the Challenges model
        kypo_instance_id = data.pop("kypo_instance_id", None)
        kypo_access_token = data.pop("kypo_access_token", None)
        kypo_instance_type = data.pop("kypo_instance_type", "linear")
        kypo_base_url = data.pop("kypo_base_url", "https://vuontre.iahn.hanoi.vn")

        # Remove deploy-related and form-meta fields not relevant to sandbox
        for field in _DEPLOY_FIELDS | _FORM_META_FIELDS:
            data.pop(field, None)
        data.pop("contest_token", None)

        # Normalize difficulty
        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None

        try:
            time_limit = int(data.get("time_limit", 60))
        except (TypeError, ValueError):
            time_limit = 60

        # Filter to only valid model columns to avoid TypeError on unknown fields
        valid_columns = {c.name for c in cls.challenge_model.__table__.columns}
        data = {k: v for k, v in data.items() if k in valid_columns}

        if time_limit >= -1:
            challenge = cls.challenge_model(**data)
            db.session.add(challenge)
            db.session.flush()

            if kypo_instance_id:
                kypo_config = KypoChallengeConfig(
                    challenge_id=challenge.id,
                    kypo_instance_id=int(kypo_instance_id),
                    kypo_access_token=kypo_access_token or "",
                    kypo_instance_type=kypo_instance_type or "linear",
                    kypo_base_url=kypo_base_url or "https://vuontre.iahn.hanoi.vn",
                )
                db.session.add(kypo_config)

            db.session.commit()
        else:
            return jsonify({"error": "Time limit must be greater than -1"}), 400

        return challenge

    @classmethod
    def read(cls, challenge):
        kypo_config = KypoChallengeConfig.query.filter_by(challenge_id=challenge.id).first()

        return {
            "id": challenge.id,
            "name": challenge.name,
            "description": challenge.description,
            "category": challenge.category,
            "difficulty": challenge.difficulty,
            "state": challenge.state,
            "type": challenge.type,
            "value": challenge.value,
            "time_limit": challenge.time_limit,
            "max_attempts": challenge.max_attempts,
            "kypo_instance_id": kypo_config.kypo_instance_id if kypo_config else None,
            "kypo_access_token": kypo_config.kypo_access_token if kypo_config else None,
            "kypo_instance_type": kypo_config.kypo_instance_type if kypo_config else None,
            "kypo_base_url": kypo_config.kypo_base_url if kypo_config else None,
            "type_data": {
                "id": cls.id,
                "name": cls.name,
                "templates": cls.templates,
                "scripts": cls.scripts,
            },
        }

    @classmethod
    def update(cls, challenge, request):
        data = request.form or request.get_json()
        data = dict(data)

        # Extract KYPO fields before touching the challenge row
        kypo_instance_id = data.pop("kypo_instance_id", None)
        kypo_access_token = data.pop("kypo_access_token", None)
        kypo_instance_type = data.pop("kypo_instance_type", None)
        kypo_base_url = data.pop("kypo_base_url", None)

        # Drop deploy and form-meta fields
        for field in _DEPLOY_FIELDS | _FORM_META_FIELDS:
            data.pop(field, None)

        if "difficulty" in data:
            diff_val = data["difficulty"]
            if diff_val is None or (isinstance(diff_val, str) and diff_val.strip() == ""):
                data["difficulty"] = None
            else:
                try:
                    data["difficulty"] = int(diff_val)
                except (TypeError, ValueError):
                    data["difficulty"] = None

        if "time_limit" in data:
            if int(data["time_limit"]) >= -1:
                for attr, value in data.items():
                    setattr(challenge, attr, value)
                db.session.commit()
        else:
            for attr, value in data.items():
                setattr(challenge, attr, value)
            db.session.commit()

        # Sync KypoChallengeConfig when a new instance is selected
        if kypo_instance_id:
            kypo_config = KypoChallengeConfig.query.filter_by(challenge_id=challenge.id).first()
            if kypo_config:
                kypo_config.kypo_instance_id = int(kypo_instance_id)
                if kypo_access_token:
                    kypo_config.kypo_access_token = kypo_access_token
                if kypo_instance_type:
                    kypo_config.kypo_instance_type = kypo_instance_type
                if kypo_base_url:
                    kypo_config.kypo_base_url = kypo_base_url
            else:
                kypo_config = KypoChallengeConfig(
                    challenge_id=challenge.id,
                    kypo_instance_id=int(kypo_instance_id),
                    kypo_access_token=kypo_access_token or "",
                    kypo_instance_type=kypo_instance_type or "linear",
                    kypo_base_url=kypo_base_url or "https://vuontre.iahn.hanoi.vn",
                )
                db.session.add(kypo_config)
            db.session.commit()

        return challenge

    @classmethod
    def delete(cls, challenge):
        Fails.query.filter_by(challenge_id=challenge.id).delete()
        Solves.query.filter_by(challenge_id=challenge.id).delete()
        Flags.query.filter_by(challenge_id=challenge.id).delete()
        files = ChallengeFiles.query.filter_by(challenge_id=challenge.id).all()
        for f in files:
            delete_file(f.id)
        ChallengeFiles.query.filter_by(challenge_id=challenge.id).delete()
        Tags.query.filter_by(challenge_id=challenge.id).delete()
        Hints.query.filter_by(challenge_id=challenge.id).delete()
        KypoChallengeConfig.query.filter_by(challenge_id=challenge.id).delete()
        Challenges.query.filter_by(id=challenge.id).delete()
        db.session.commit()

    @classmethod
    def attempt(cls, challenge, request):
        return False, "Sandbox challenges are scored by the KYPO system."

    @classmethod
    def solve(cls, user, team, challenge, request):
        pass

    @classmethod
    def fail(cls, user, team, challenge, request):
        pass


def load(app):
    CHALLENGE_CLASSES["sandbox"] = SandboxChallengeClass
    register_plugin_assets_directory(
        app, base_path="/plugins/sandbox_challenges/assets/"
    )

    from .routes import sandbox_kypo_api
    app.register_blueprint(sandbox_kypo_api)

    with app.app_context():
        from CTFd.utils.kypo_config import log_all_kypo_config
        log_all_kypo_config()
