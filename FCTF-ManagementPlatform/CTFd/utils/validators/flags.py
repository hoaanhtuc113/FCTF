import re


def validate_flag_content(flag_type, content, data=None):
    """Validate built-in flags without imposing their format on plugins."""
    if flag_type not in ("static", "regex"):
        return
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Flag content must be a non-empty string")
    if flag_type == "regex":
        try:
            re.compile(content, re.IGNORECASE if data == "case_insensitive" else 0)
        except re.error as error:
            raise ValueError("Invalid regular expression") from error
