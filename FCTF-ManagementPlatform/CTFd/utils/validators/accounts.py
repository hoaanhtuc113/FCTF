from marshmallow import ValidationError


def validate_account_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 128:
        raise ValidationError("Name must contain between 1 and 128 characters")
    if any(c in "<>" or ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValidationError("Name cannot contain markup or control characters")


def validate_nonempty_password(value):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError("Password must not be empty or whitespace")
    if len(value) > 128:
        raise ValidationError("Password must be at most 128 characters")
