from flask import current_app
from marshmallow import fields, pre_load
from marshmallow.exceptions import ValidationError
from marshmallow_sqlalchemy import field_for

from CTFd.models import Configs, ma
from CTFd.utils import string_types

# Core config keys used by this application. Plugins may explicitly extend this
# set through app.config['CONFIG_API_KEYS'].
CONFIG_API_KEYS = set("""
account_visibility bracket_view_other contestant_registration_enabled captain_only_start_challenge captain_only_submit_challenge
challenge_visibility challenge_difficulty_visibility score_visibility team_creation
ctf_banner ctf_description ctf_logo ctf_name ctf_small_icon ctf_theme ctf_version
default_locale domain_whitelist end freeze hidden_categories html_sanitization
incorrect_submissions_per_min limit_challenges mail_password mail_port mail_server
mail_ssl mail_tls mail_useauth mail_username mailfrom_addr mailgun_api_key mailgun_base_url
name_changes next_update_check num_teams num_users oauth_api_endpoint oauth_authorization_endpoint
oauth_client_id oauth_client_secret oauth_token_endpoint password_change_alert_body
password_change_alert_subject password_reset_body password_reset_subject paused prevent_name_change
privacy_text privacy_url registration_visibility setup social_share_solve_template start
successful_registration_email_body successful_registration_email_subject team_disbanding
team_size theme_footer theme_header theme_settings tos_text tos_url user_creation_email_body
user_creation_email_subject user_mode verification_email_body verification_email_subject
verify_emails version_latest view_after_ctf robots_txt
kypo_base_url kypo_username kypo_password kypo_client_id kypo_keycloak_url
kypo_realm kypo_admin_username kypo_admin_password kypo_verify_ssl
""".split())
INTEGER_CONFIGS = {"team_size", "num_teams", "num_users", "incorrect_submissions_per_min", "limit_challenges", "mail_port", "start", "end", "freeze"}
CONFIG_FORM_METADATA = {"nonce", "submit", "start_timezone", "end_timezone", "freeze_timezone"}
BOOLEAN_CONFIGS = set("""bracket_view_other contestant_registration_enabled captain_only_start_challenge
captain_only_submit_challenge team_creation name_changes html_sanitization mail_ssl mail_tls mail_useauth
paused prevent_name_change setup verify_emails view_after_ctf kypo_verify_ssl""".split())
ENUM_CONFIGS = {
    "account_visibility": ("public", "private", "admins"),
    "challenge_visibility": ("public", "private", "admins"),
    "score_visibility": ("public", "private", "hidden"),
    "registration_visibility": ("public", "private", "mlc"),
    "challenge_difficulty_visibility": ("enabled", "disabled"),
    "user_mode": ("users", "teams"),
    "team_disbanding": ("inactive_only", "disabled"),
}


class ConfigValueField(fields.Field):
    """
    Custom value field for Configs so that we can perform validation of values
    """

    def _deserialize(self, value, attr, data, **kwargs):
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValidationError("Config value must be a scalar or null")
        if isinstance(value, str):
            # 65535 bytes is the size of a TEXT column in MySQL
            # You may be able to exceed this in other databases
            # but MySQL is our database of record
            try:
                byte_length = len(value.encode("utf-8"))
            except UnicodeEncodeError:
                raise ValidationError("Config value must be valid UTF-8")
            if byte_length > 65535:
                raise ValidationError("Config value is too long")
            return value
        else:
            return value


class ConfigSchema(ma.ModelSchema):
    @pre_load
    def validate_input(self, data):
        key = data.get("key", self.instance.key if self.instance else None)
        allowed = CONFIG_API_KEYS | set(current_app.config.get("CONFIG_API_KEYS", ()))
        if not isinstance(key, str) or key not in allowed:
            raise ValidationError("Unknown config key", field_names=["key"])
        value = data.get("value")
        if key == "ctf_theme" and value is not None:
            from CTFd.utils.config import get_themes
            if value not in get_themes():
                raise ValidationError("Unknown theme", field_names=["value"])
        if key in ENUM_CONFIGS and value not in ENUM_CONFIGS[key]:
            raise ValidationError("Invalid config option", field_names=["value"])
        if key in BOOLEAN_CONFIGS and value is not None:
            if not isinstance(value, (str, bool, int)) or value not in (True, False, 0, 1, "0", "1", "true", "false", "on"):
                raise ValidationError("Must be a boolean", field_names=["value"])
            data["value"] = "true" if value in (True, 1, "1", "true", "on") else "false"
        if key in CONFIG_API_KEYS - INTEGER_CONFIGS - BOOLEAN_CONFIGS - set(ENUM_CONFIGS) and value is not None:
            if not isinstance(value, str):
                raise ValidationError("Must be a string or null", field_names=["value"])
        if key in INTEGER_CONFIGS and "value" in data and data["value"] not in (None, ""):
            value = data["value"]
            if isinstance(value, bool) or not isinstance(value, (int, str)) or (isinstance(value, str) and (len(value) > 10 or not value.isdecimal())) or not 0 <= int(value) <= 2147483647:
                raise ValidationError("Must be a nonnegative integer", field_names=["value"])
            if key == "mail_port" and not 1 <= int(value) <= 65535:
                raise ValidationError("Mail port must be between 1 and 65535", field_names=["value"])
        if key == "theme_settings" and data.get("value") is not None:
            import json
            try:
                parsed = json.loads(data["value"])
                if not isinstance(parsed, dict):
                    raise ValueError()
            except (TypeError, ValueError):
                raise ValidationError("Theme settings must be a JSON string", field_names=["value"])

    class Meta:
        model = Configs
        include_fk = True
        dump_only = ("id",)

    views = {"admin": ["id", "key", "value"]}
    key = field_for(Configs, "key", required=True)
    value = ConfigValueField(allow_none=True, required=True)

    def __init__(self, view=None, *args, **kwargs):
        if view:
            if isinstance(view, string_types):
                kwargs["only"] = self.views[view]
            elif isinstance(view, list):
                kwargs["only"] = view

        super(ConfigSchema, self).__init__(*args, **kwargs)
