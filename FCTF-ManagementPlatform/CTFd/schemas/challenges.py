from marshmallow import validate
from marshmallow.exceptions import ValidationError
from marshmallow_sqlalchemy import field_for

from CTFd.models import Challenges, ma


class ChallengeRequirementsValidator(validate.Validator):
    default_message = "Error parsing challenge requirements"

    def __init__(self, error=None):
        self.error = error or self.default_message

    def __call__(self, value):
        if isinstance(value, dict) is False:
            raise ValidationError(self.default_message)

        prereqs = value.get("prerequisites", [])
        if all(prereqs) is False:
            raise ValidationError(
                "Challenge requirements cannot have a null prerequisite"
            )

        return value


class ChallengeSchema(ma.ModelSchema):
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
