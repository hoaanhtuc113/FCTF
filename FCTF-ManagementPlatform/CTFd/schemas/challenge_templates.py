from marshmallow import validate
from marshmallow_sqlalchemy import field_for

from CTFd.models import Challenges, ma


class ChallengeTemplateSchema(ma.ModelSchema):
    """
    Schema for challenge_templates table.
    Excludes contest-specific fields (value, state, max_attempts, cooldown,
    time_limit, next_id) which belong to contests_challenges.
    """

    class Meta:
        model = Challenges
        include_fk = True
        dump_only = ("id",)
        exclude = (
            "value",
            "state",
            "max_attempts",
            "cooldown",
            "time_limit",
            "next_id",
        )

    name = field_for(
        Challenges,
        "name",
        validate=[
            validate.Length(
                min=0,
                max=80,
                error="Challenge template name too long",
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
                error="Challenge template category too long",
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
                error="Challenge template description too long",
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

    cpu_limit = field_for(
        Challenges,
        "cpu_limit",
        allow_none=True,
        validate=[
            validate.Range(
                min=1,
                error="CPU limit must be >= 1 (mCPU)",
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
                error="CPU request must be >= 1 (mCPU)",
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
                error="Memory limit must be >= 1 (Mi)",
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
                error="Memory request must be >= 1 (Mi)",
            )
        ],
    )

    use_gvisor = field_for(Challenges, "use_gvisor", allow_none=True)
    harden_container = field_for(Challenges, "harden_container", allow_none=True)
