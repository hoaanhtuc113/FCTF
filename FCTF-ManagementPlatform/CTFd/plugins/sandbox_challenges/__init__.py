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
from .validation import KYPO_FIELDS, validate_config

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
    def create(cls, request):
        data = request.form or request.get_json()
        data = dict(data)

        # Remove KYPO-specific fields before passing to the Challenges model
        kypo_values = validate_config(data)
        for key in KYPO_FIELDS:
            data.pop(key, None)

        # Remove deploy-related and form-meta fields not relevant to sandbox
        for field in _DEPLOY_FIELDS | _FORM_META_FIELDS:
            data.pop(field, None)

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

        from CTFd.utils.validators.scoring import score_integer

        time_limit = score_integer(data.get("time_limit", 60), "time_limit", minimum=-1)
        data["time_limit"] = time_limit

        if time_limit >= -1:
            challenge = cls.challenge_model(**data)
            db.session.add(challenge)
            db.session.flush()

            db.session.add(KypoChallengeConfig(challenge_id=challenge.id, **kypo_values))

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
        kypo_config = KypoChallengeConfig.query.filter_by(challenge_id=challenge.id).first()
        kypo_values = validate_config(data, existing=kypo_config)
        for key in KYPO_FIELDS:
            data.pop(key, None)

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

        for attr, value in data.items():
            setattr(challenge, attr, value)
        if kypo_config is None:
            kypo_config = KypoChallengeConfig(challenge_id=challenge.id, **kypo_values)
            db.session.add(kypo_config)
        else:
            for key, value in kypo_values.items():
                setattr(kypo_config, key, value)
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
