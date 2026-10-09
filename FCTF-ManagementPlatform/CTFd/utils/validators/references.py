"""Validate references before constructing or persisting ORM objects."""
from marshmallow import ValidationError


def positive_id(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValidationError("Must be a positive integer", field_names=[field])
    if isinstance(value, str) and (len(value) > 10 or not value.isdecimal()):
        raise ValidationError("Must be a positive integer", field_names=[field])
    value = int(value)
    if not 0 < value <= 2147483647:
        raise ValidationError("Must be a positive integer", field_names=[field])
    return value


def reference(data, field, model, required=False, nullable=False, **filters):
    if field not in data:
        if required:
            raise ValidationError("Missing required field", field_names=[field])
        return
    if nullable and data[field] is None:
        return
    value = positive_id(data[field], field)
    if model.query.filter_by(id=value, **filters).first() is None:
        raise ValidationError("Referenced record does not exist", field_names=[field])
    data[field] = value


def text_field(data, field, required=False):
    if field not in data and not required:
        return
    if not isinstance(data.get(field), str) or not data[field].strip():
        raise ValidationError("Must be a nonempty string", field_names=[field])
