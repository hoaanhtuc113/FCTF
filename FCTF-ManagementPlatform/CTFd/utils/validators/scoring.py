"""Scoring inputs shared by schemas, plugins and imports."""

import re

MAX_SCORE = 2147483647


class ScoringValidationError(ValueError):
    def __init__(self, field, message):
        self.errors = {field: [message]}
        super().__init__(message)


def score_integer(value, field="value", minimum=0):
    if isinstance(value, bool) or not (
        isinstance(value, int)
        or isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip())
    ):
        raise ScoringValidationError(field, "Must be an integer")
    value = int(value)
    if not minimum <= value <= MAX_SCORE:
        raise ScoringValidationError(field, "Must be between {} and {}".format(minimum, MAX_SCORE))
    return value


def validate_score_fields(data, dynamic=True):
    for field in (("value", "initial", "minimum", "decay") if dynamic else ("value",)):
        if field in data:
            score_integer(data[field], field, minimum=1 if field == "decay" else 0)
    if dynamic and "function" in data and data["function"] not in ("linear", "logarithmic"):
        raise ScoringValidationError("function", "Must be linear or logarithmic")


def dynamic_config(data, challenge=None):
    defaults = {"initial": 100, "minimum": 10, "decay": 50, "function": "logarithmic"}
    config = {key: data.get(key, getattr(challenge, key, default))
              for key, default in defaults.items()}
    validate_score_fields(config)
    for key in ("initial", "minimum", "decay"):
        config[key] = score_integer(config[key], key, minimum=1 if key == "decay" else 0)
    if config["minimum"] > config["initial"]:
        raise ScoringValidationError("minimum", "Cannot exceed initial")
    return config
