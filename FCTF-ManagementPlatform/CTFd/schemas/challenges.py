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

    points= field_for(
        Challenges, 
        "value",
        allow_none= False,
        validate= [
            validate.Range(
                min=1, 
                error= "Challenge can't not be saved, Value must greater than 0"
            )
        ]
            
    )
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
                max=500,
                error="CPU limit must be between 1 and 500 (mCPU)",
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
                max=500,
                error="CPU request must be between 1 and 500 (mCPU)",
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
                max=1024,
                error="Memory limit must be between 1 and 1024 (Mi)",
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
                max=1024,
                error="Memory request must be between 1 and 1024 (Mi)",
            )
        ],
    )

    use_gvisor = field_for(
        Challenges,
        "use_gvisor",
        allow_none=True,
    )
