from CTFd.models import Awards, ma
from CTFd.utils import string_types
from marshmallow import ValidationError, pre_load
from marshmallow_sqlalchemy import field_for


class AwardSchema(ma.ModelSchema):
    name = field_for(Awards, "name", required=True, allow_none=False)

    @pre_load
    def validate_name(self, data):
        if "name" not in data and self.partial:
            return
        name = data.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            raise ValidationError("Name must contain 1 to 80 characters", field_names=["name"])
        data["name"] = name.strip()

    class Meta:
        model = Awards
        include_fk = True
        dump_only = ("id", "date", "request_key", "request_hash")
        exclude = ("request_key", "request_hash")

    views = {
        "admin": [
            "category",
            "user_id",
            "name",
            "description",
            "value",
            "team_id",
            "user",
            "team",
            "date",
            "requirements",
            "id",
            "icon",
        ],
        "user": [
            "category",
            "user_id",
            "name",
            "description",
            "value",
            "team_id",
            "user",
            "team",
            "date",
            "id",
            "icon",
        ],
    }

    def __init__(self, view=None, *args, **kwargs):
        if view:
            if isinstance(view, string_types):
                kwargs["only"] = self.views[view]
            elif isinstance(view, list):
                kwargs["only"] = view

        super(AwardSchema, self).__init__(*args, **kwargs)
