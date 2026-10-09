from marshmallow import ValidationError, fields, pre_load
from CTFd.utils.validators.references import text_field

from CTFd.models import Fields, TeamFieldEntries, UserFieldEntries, db, ma


class FieldSchema(ma.ModelSchema):
    @pre_load
    def validate_input(self, data):
        creating = self.instance is None and not self.partial
        if creating or "type" in data:
            if data.get("type") not in ("user", "team"):
                raise ValidationError("Field type must be user or team", field_names=["type"])
            if self.instance is not None and data["type"] != self.instance.type:
                raise ValidationError("Cannot change field owner type", field_names=["type"])
        text_field(data, "name", required=creating)
        if creating or "field_type" in data:
            if data.get("field_type") not in ("text", "boolean", "select"):
                raise ValidationError("Invalid field input type", field_names=["field_type"])

    class Meta:
        model = Fields
        include_fk = True
        dump_only = ("id",)


class UserFieldEntriesSchema(ma.ModelSchema):
    class Meta:
        model = UserFieldEntries
        sqla_session = db.session
        include_fk = True
        load_only = ("id",)
        exclude = ("field", "user", "user_id")
        dump_only = ("user_id", "name", "description", "type")

    name = fields.Nested(FieldSchema, only=("name"), attribute="field")
    description = fields.Nested(FieldSchema, only=("description"), attribute="field")
    type = fields.Nested(FieldSchema, only=("field_type"), attribute="field")


class TeamFieldEntriesSchema(ma.ModelSchema):
    class Meta:
        model = TeamFieldEntries
        sqla_session = db.session
        include_fk = True
        load_only = ("id",)
        exclude = ("field", "team", "team_id")
        dump_only = ("team_id", "name", "description", "type")

    name = fields.Nested(FieldSchema, only=("name"), attribute="field")
    description = fields.Nested(FieldSchema, only=("description"), attribute="field")
    type = fields.Nested(FieldSchema, only=("field_type"), attribute="field")
