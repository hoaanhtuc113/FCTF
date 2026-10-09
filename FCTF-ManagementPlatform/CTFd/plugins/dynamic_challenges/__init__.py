from flask import Blueprint
from sqlalchemy.orm import validates

from CTFd.models import Challenges, db
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.challenges import CHALLENGE_CLASSES, BaseChallenge
from CTFd.plugins.dynamic_challenges.decay import DECAY_FUNCTIONS
from CTFd.plugins.migrations import upgrade
from CTFd.utils.validators.scoring import dynamic_config, validate_score_fields, score_integer


class DynamicChallenge(Challenges):
    __mapper_args__ = {"polymorphic_identity": "dynamic"}
    id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True
    )
    initial = db.Column(db.Integer, default=0)
    minimum = db.Column(db.Integer, default=0)
    decay = db.Column(db.Integer, default=0)
    function = db.Column(db.String(32), default="logarithmic")

    def __init__(self, *args, **kwargs):
        kwargs.update(dynamic_config(kwargs))
        super(DynamicChallenge, self).__init__(**kwargs)
        self.value = kwargs["initial"]

    @validates("initial", "minimum", "decay", "function")
    def validate_scoring_field(self, key, value):
        validate_score_fields({key: value})
        return value if key == "function" else score_integer(value, key, minimum=1 if key == "decay" else 0)


class DynamicValueChallenge(BaseChallenge):
    id = "dynamic"  # Unique identifier used to register challenges
    name = "dynamic"  # Name of a challenge type
    templates = (
        {  # Handlebars templates used for each aspect of challenge editing & viewing
            "create": "/plugins/dynamic_challenges/assets/create.html",
            "update": "/plugins/dynamic_challenges/assets/update.html",
            "view": "/plugins/dynamic_challenges/assets/view.html",
        }
    )
    scripts = {  # Scripts that are loaded when a template is loaded
        "create": "/plugins/dynamic_challenges/assets/create.js",
        "update": "/plugins/dynamic_challenges/assets/update.js",
        "view": "/plugins/dynamic_challenges/assets/view.js",
    }
    # Route at which files are accessible. This must be registered using register_plugin_assets_directory()
    route = "/plugins/dynamic_challenges/assets/"
    # Blueprint used to access the static_folder directory.
    blueprint = Blueprint(
        "dynamic_challenges",
        __name__,
        template_folder="templates",
        static_folder="assets",
    )
    challenge_model = DynamicChallenge

    @classmethod
    def calculate_value(cls, challenge, commit=True):
        from CTFd.utils.scoring import lock_challenge

        if commit:
            challenge = lock_challenge(challenge.id)
        dynamic_config({}, challenge)
        db.session.flush()
        f = DECAY_FUNCTIONS[challenge.function]
        value = f(challenge)

        challenge.value = value
        if commit:
            db.session.commit()
        return challenge

    @classmethod
    def read(cls, challenge):
        """
        This method is in used to access the data of a challenge in a format processable by the front end.

        :param challenge:
        :return: Challenge object, data dictionary to be returned to the user
        """
        challenge = DynamicChallenge.query.filter_by(id=challenge.id).first()
        data = {
            "id": challenge.id,
            "name": challenge.name,
            "value": challenge.value,
            "initial": challenge.initial,
            "decay": challenge.decay,
            "minimum": challenge.minimum,
            "function": challenge.function,
            "description": challenge.description,
            "connection_info": challenge.connection_info,
            "next_id": challenge.next_id,
            "category": challenge.category,
            "state": challenge.state,
            "max_attempts": challenge.max_attempts,
            "type": challenge.type,
            "type_data": {
                "id": cls.id,
                "name": cls.name,
                "templates": cls.templates,
                "scripts": cls.scripts,
            },
        }
        return data

    @classmethod
    def update(cls, challenge, request, commit=True):
        """
        This method is used to update the information associated with a challenge. This should be kept strictly to the
        Challenges table and any child tables.

        :param challenge:
        :param request:
        :return:
        """
        from CTFd.utils.scoring import lock_challenge
        from CTFd.utils.validators.scoring import validate_score_fields

        if commit:
            challenge = lock_challenge(challenge.id)
        data = dict(request.form or request.get_json())
        validate_score_fields(data)
        data.update(dynamic_config(data, challenge))

        for attr, value in data.items():
            # Type transitions are handled by the API with the child table.
            if attr == "type":
                continue
            setattr(challenge, attr, value)

        DynamicValueChallenge.calculate_value(challenge, commit=False)
        if commit:
            db.session.commit()
        return challenge

    @classmethod
    def solve(cls, user, team, challenge, request):
        return super().solve(user, team, challenge, request)


def load(app):
    upgrade(plugin_name="dynamic_challenges")
    CHALLENGE_CLASSES["dynamic"] = DynamicValueChallenge
    register_plugin_assets_directory(
        app, base_path="/plugins/dynamic_challenges/assets/"
    )
