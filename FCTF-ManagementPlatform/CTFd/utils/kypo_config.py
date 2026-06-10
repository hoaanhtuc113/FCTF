"""
kypo_config.py
Read KYPO integration config from the DB `config` table,
falling back to environment variables when no DB row exists.

Usage (requires Flask app context):
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl
    base_url = get_kypo_config("kypo_base_url")
    verify   = get_kypo_verify_ssl()
"""
import logging

from CTFd.constants.envvars import (
    KYPO_BASE_URL,
    KYPO_USERNAME,
    KYPO_PASSWORD,
    KYPO_CLIENT_ID,
    KYPO_KEYCLOAK_URL,
    KYPO_REALM,
    KYPO_ADMIN_USERNAME,
    KYPO_ADMIN_PASSWORD,
    KYPO_VERIFY_SSL,
)

log = logging.getLogger(__name__)

_ENV_DEFAULTS: dict[str, object] = {
    "kypo_base_url":       KYPO_BASE_URL,
    "kypo_username":       KYPO_USERNAME,
    "kypo_password":       KYPO_PASSWORD,
    "kypo_client_id":      KYPO_CLIENT_ID,
    "kypo_keycloak_url":   KYPO_KEYCLOAK_URL,
    "kypo_realm":          KYPO_REALM,
    "kypo_admin_username": KYPO_ADMIN_USERNAME,
    "kypo_admin_password": KYPO_ADMIN_PASSWORD,
    "kypo_verify_ssl":     str(KYPO_VERIFY_SSL).lower(),
}

# Keys that are known KYPO config keys (used for seeding / UI validation)
KYPO_CONFIG_KEYS = list(_ENV_DEFAULTS.keys())


def get_kypo_config(key: str) -> str:
    """Return KYPO config value from DB, falling back to the env-var default."""
    from CTFd.utils import get_config
    db_val = get_config(key)
    if db_val is None or db_val == "":
        env_val = _ENV_DEFAULTS.get(key, "")
        # Ẩn giá trị password trong log
        display = "***" if "password" in key else env_val
        log.debug("[kypo_config] key=%s  source=ENV  value=%s", key, display)
        return env_val
    display = "***" if "password" in key else db_val
    log.debug("[kypo_config] key=%s  source=DB   value=%s", key, display)
    return db_val


def log_all_kypo_config() -> None:
    """Log toàn bộ KYPO config hiện tại (nguồn DB hay ENV). Gọi khi debug."""
    from CTFd.utils import get_config
    log.info("[kypo_config] ========== KYPO CONFIG SNAPSHOT ==========")
    for key in KYPO_CONFIG_KEYS:
        db_val = get_config(key)
        if db_val is None or db_val == "":
            source = "ENV"
            val = _ENV_DEFAULTS.get(key, "")
        else:
            source = "DB"
            val = db_val
        display = "***" if "password" in key else val
        log.info("[kypo_config]  %-25s  source=%-3s  value=%s", key, source, display)
    log.info("[kypo_config] ===========================================")


def get_kypo_verify_ssl() -> bool:
    """Return kypo_verify_ssl as a Python bool."""
    val = get_kypo_config("kypo_verify_ssl")
    if isinstance(val, bool):
        return val
    return str(val).lower() not in ("false", "0", "")
