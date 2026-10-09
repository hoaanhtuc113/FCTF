from marshmallow import pre_load
from CTFd.models import Challenges, Tags, ma
from CTFd.utils.validators.references import reference, text_field
from CTFd.utils import string_types


class TagSchema(ma.ModelSchema):
    @pre_load
    def validate_input(self, data):
        reference(data, "challenge_id", Challenges, required=self.instance is None and not self.partial)
        text_field(data, "value", required=self.instance is None and not self.partial)

    class Meta:
        model = Tags
        include_fk = True
        dump_only = ("id",)

    views = {"admin": ["id", "challenge", "value"], "user": ["value"]}

    def __init__(self, view=None, *args, **kwargs):
        if view:
            if isinstance(view, string_types):
                kwargs["only"] = self.views[view]
            elif isinstance(view, list):
                kwargs["only"] = view

        super(TagSchema, self).__init__(*args, **kwargs)
