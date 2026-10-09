from marshmallow import pre_load, validate
from marshmallow.exceptions import ValidationError
from marshmallow_sqlalchemy import field_for

from CTFd.models import Challenges, Users, ma
from CTFd.utils.validators.references import positive_id, reference, text_field
from CTFd.utils.validators.model_types import validate_type_payload
from CTFd.utils.validators.scoring import dynamic_config, score_integer, validate_score_fields, ScoringValidationError


class ChallengeRequirementsValidator(validate.Validator):
    default_message = "Error parsing challenge requirements"

    def __init__(self, error=None):
        self.error = error or self.default_message

    def __call__(self, value):
        if isinstance(value, dict) is False:
            raise ValidationError(self.default_message)

        prereqs = value.get("prerequisites", [])
        if not isinstance(prereqs, list):
            raise ValidationError("Prerequisites must be a list of challenge IDs")
        ids = [positive_id(item, "requirements") for item in prereqs]
        existing = {row.id for row in Challenges.query.with_entities(Challenges.id).filter(Challenges.id.in_(ids)).all()}
        if len(set(ids)) != len(ids) or existing != set(ids):
            raise ValidationError(
                "Prerequisites must contain unique, existing challenge IDs"
            )
        if "anonymize" in value and not isinstance(value["anonymize"], bool):
            raise ValidationError("Anonymize must be a boolean")
        value["prerequisites"] = ids

        return value


class ChallengeSchema(ma.ModelSchema):
    @pre_load
    def validate_type(self, data):
        validate_type_payload("challenges", data)
        if "state" in data and data["state"] not in ("visible", "hidden", "locked"):
            raise ValidationError("State must be visible, hidden or locked", field_names=["state"])
        reference(data, "user_id", Users, nullable=False)
        text_field(data, "name", required=not self.partial)
        text_field(data, "category", required=not self.partial)
        if not self.partial and "type" not in data:
            raise ValidationError("Challenge type is required", field_names=["type"])
        try:
            if "time_limit" in data:
                score_integer(data["time_limit"], "time_limit", minimum=-1)
            elif not self.partial and data.get("type") == "sandbox":
                data["time_limit"] = 60
            target_type = data.get("scoring-type-radio") or data.get("type")
            validate_score_fields(data, dynamic=target_type in (None, "dynamic"))
            if not self.partial and data.get("type") == "dynamic":
                dynamic_config(data)
        except ScoringValidationError as error:
            raise ValidationError(error.errors)

    class Meta:
        model = Challenges
        include_fk = True
        dump_only = ("id",)

    name = field_for(
        Challenges,
        "name",
        validate=[
            validate.Length(
                min=0,
                max=80,
                error="Challenge could not be saved. Challenge name too long",
            )
        ],
    )

    category = field_for(
        Challenges,
        "category",
        validate=[
            validate.Length(
                min=0,
                max=80,
                error="Challenge could not be saved. Challenge category too long",
            )
        ],
    )

    description = field_for(
        Challenges,
        "description",
        allow_none=True,
        validate=[
            validate.Length(
                min=0,
                max=65535,
                error="Challenge could not be saved. Challenge description too long",
            )
        ],
    )

    requirements = field_for(
        Challenges,
        "requirements",
        validate=[ChallengeRequirementsValidator()],
    )

    value = field_for(Challenges, "value", allow_none=False,
                      validate=[validate.Range(min=0, max=2147483647)])
    time_limit = field_for(Challenges, "time_limit", required=True, allow_none=False,
                           validate=[validate.Range(min=-1, max=2147483647)])
    max_attempts= field_for(
        Challenges,
        "max_attempts",
        allow_none= False,
        validate= [
            validate.Range(
                min=0, 
            )
        ]
    )
    cooldown = field_for(
        Challenges,
        "cooldown",
        allow_none=False,
        validate=[
            validate.Range(min=0, error="Cooldown must be greater than or equal to 0")
        ],
    )

    cpu_limit = field_for(
        Challenges,
        "cpu_limit",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                error="CPU limit must be greater than or equal to 1 (mCPU)",
            )
        ],
    )

    cpu_request = field_for(
        Challenges,
        "cpu_request",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                error="CPU request must be greater than or equal to 1 (mCPU)",
            )
        ],
    )

    memory_limit = field_for(
        Challenges,
        "memory_limit",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                error="Memory limit must be greater than or equal to 1 (Mi)",
            )
        ],
    )

    memory_request = field_for(
        Challenges,
        "memory_request",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                error="Memory request must be greater than or equal to 1 (Mi)",
            )
        ],
    )

    use_gvisor = field_for(
        Challenges,
        "use_gvisor",
        allow_none=True,
    )

    harden_container = field_for(
        Challenges,
        "harden_container",
        allow_none=True,
    )

    max_deploy_count = field_for(
        Challenges,
        "max_deploy_count",
        allow_none=True,
        validate=[
            validate.Range(
                min=0,
                error="Max deploy count must be greater than or equal to 0",
            )
        ],
    )

    difficulty = field_for(
        Challenges,
        "difficulty",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                max=5,
                error="Difficulty must be between 1 and 5",
            )
        ],
    )
