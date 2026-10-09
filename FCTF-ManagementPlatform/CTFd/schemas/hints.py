from marshmallow import ValidationError, pre_load
from CTFd.models import Challenges, Hints, ma
from CTFd.utils.validators.references import reference, text_field
from CTFd.utils import string_types


class HintSchema(ma.ModelSchema):
    @pre_load
    def validate_input(self, data):
        reference(data, "challenge_id", Challenges, required=self.instance is None and not self.partial)
        text_field(data, "content", required=self.instance is None and not self.partial)
        if "cost" in data and (type(data["cost"]) is not int or not 0 <= data["cost"] <= 2147483647):
            raise ValidationError("Cost must be a nonnegative integer", field_names=["cost"])

    class Meta:
        model = Hints
        include_fk = True
        dump_only = ("id", "type", "html")

    views = {
        "locked": ["id", "type", "challenge", "challenge_id", "cost"],
        "unlocked": [
            "id",
            "type",
            "challenge",
            "challenge_id",
            "content",
            "html",
            "cost",
        ],
        "admin": [
            "id",
            "type",
            "challenge",
            "challenge_id",
            "content",
            "html",
            "cost",
            "requirements",
        ],
    }

    def __init__(self, view=None, *args, **kwargs):
        if view:
            if isinstance(view, string_types):
                kwargs["only"] = self.views[view]
            elif isinstance(view, list):
                kwargs["only"] = view

        super(HintSchema, self).__init__(*args, **kwargs)
