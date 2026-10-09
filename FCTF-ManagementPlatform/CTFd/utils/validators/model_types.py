"""Supported discriminator values, resolved after plugins have been loaded."""

USER_TYPES = frozenset(("user", "admin", "challenge_writer", "jury"))
FILE_TYPES = frozenset(("standard", "challenge"))


def supported_types(kind):
    if kind == "users":
        return USER_TYPES
    if kind == "files":
        return FILE_TYPES
    if kind == "challenges":
        from CTFd.plugins.challenges import CHALLENGE_CLASSES

        return set(CHALLENGE_CLASSES)
    if kind == "flags":
        from CTFd.plugins.flags import FLAG_CLASSES

        return set(FLAG_CLASSES)
    raise ValueError("Unknown model kind")


def require_supported_type(kind, value):
    if not isinstance(value, str) or value not in supported_types(kind):
        choices = ", ".join(sorted(supported_types(kind)))
        raise ValueError("Invalid type. Supported values: {}".format(choices))
    return value


def missing_challenge_type_data(value, challenge_id):
    from CTFd.models import Challenges, db
    from CTFd.plugins.challenges import CHALLENGE_CLASSES

    handler = CHALLENGE_CLASSES.get(value)
    if handler is None:
        return False
    table = handler.challenge_model.__table__
    if table is Challenges.__table__:
        return False
    return db.session.query(table.c.id).filter(table.c.id == challenge_id).first() is None


def validate_type_payload(kind, data):
    from marshmallow import ValidationError

    if "type" in data:
        try:
            require_supported_type(kind, data["type"])
        except ValueError as error:
            raise ValidationError(str(error), field_names=["type"])
