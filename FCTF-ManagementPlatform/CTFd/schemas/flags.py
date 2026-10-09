from marshmallow import ValidationError, pre_load

from CTFd.models import Flags, ma
from CTFd.utils import string_types
from CTFd.utils.validators.model_types import validate_type_payload
from CTFd.utils.validators.flags import validate_flag_content


class FlagSchema(ma.ModelSchema):
    @pre_load
    def validate_type(self, data):
        if "flag_type" in data:
            if "type" in data and data["type"] != data["flag_type"]:
                raise ValidationError("type and flag_type must match", field_names=["type"])
            data["type"] = data["flag_type"]
        validate_type_payload("flags", data)
        instance = self.instance
        flag_type = data.get("type", getattr(instance, "type", "static"))
        content = data.get("content", getattr(instance, "content", None))
        flag_data = data.get("data", getattr(instance, "data", None))
        try:
            validate_flag_content(flag_type, content, flag_data)
        except ValueError as error:
            raise ValidationError(str(error), field_names=["content"])

    class Meta:
        model = Flags
        include_fk = True
        dump_only = ("id",)

    def __init__(self, view=None, *args, **kwargs):
        if view:
            if isinstance(view, string_types):
                kwargs["only"] = self.views[view]
            elif isinstance(view, list):
                kwargs["only"] = view

        super(FlagSchema, self).__init__(*args, **kwargs)
