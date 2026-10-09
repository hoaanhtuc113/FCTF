from CTFd.models import Brackets, ma
from marshmallow import ValidationError, pre_load
from CTFd.utils.validators.references import text_field


class BracketSchema(ma.ModelSchema):
    @pre_load
    def validate_input(self, data):
        creating = self.instance is None and not self.partial
        text_field(data, "name", required=creating)
        if "name" in data:
            data["name"] = data["name"].strip()
            if len(data["name"]) > 255:
                raise ValidationError("Name must be at most 255 characters", field_names=["name"])
        if creating or "type" in data:
            if data.get("type") not in ("users", "teams"):
                raise ValidationError("Bracket type must be users or teams", field_names=["type"])

    class Meta:
        model = Brackets
        include_fk = True
        dump_only = ("id",)
