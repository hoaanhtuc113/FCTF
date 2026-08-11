"""
kypo_config.py
Read KYPO integration config from the environment, falling back to the DB
`config` table only where the environment says nothing.

Which KYPO the platform talks to, and as what, describes the installation rather
than the contest: setting it means having deployed the platform, which is a
narrower thing than being able to write a row in the config table. It is also the
value that decides which host receives a contestant's Keycloak tokens, so the
looser of the two sources must not be the one that wins. kypo-config.sh
(manage.sh option 11) is what writes the environment.

The DB is still consulted, so an install made before these variables existed does
not lose its KYPO integration at the next rollout. Every such read is logged at
warning level, because it is a state to migrate out of rather than to settle in.

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

_ENV_VALUES: dict[str, object] = {
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

# Keys that are known KYPO config keys (used for display / UI validation)
KYPO_CONFIG_KEYS = list(_ENV_VALUES.keys())


def get_kypo_config(key: str) -> str:
    """Return the KYPO config value: environment first, DB only as a fallback."""
    env_val = _ENV_VALUES.get(key, "")
    if env_val not in (None, ""):
        display = "***" if "password" in key else env_val
        log.debug("[kypo_config] key=%s  source=ENV  value=%s", key, display)
        return env_val

    from CTFd.utils import get_config
    db_val = get_config(key)
    if db_val is None or db_val == "":
        return env_val

    display = "***" if "password" in key else db_val
    log.warning(
        "[kypo_config] key=%s read from the database because it is not set in the "
        "environment. Run manage.sh option 11 so the deployment owns this value.",
        key,
    )
    log.debug("[kypo_config] key=%s  source=DB   value=%s", key, display)
    return db_val


def get_kypo_config_source(key: str) -> str:
    """Where get_kypo_config would read this key from: 'env', 'db' or 'unset'."""
    if _ENV_VALUES.get(key, "") not in (None, ""):
        return "env"

    from CTFd.utils import get_config
    return "db" if get_config(key) not in (None, "") else "unset"


def log_all_kypo_config() -> None:
    """Log toàn bộ KYPO config hiện tại (nguồn ENV hay DB). Gọi khi debug."""
    log.info("[kypo_config] ========== KYPO CONFIG SNAPSHOT ==========")
    for key in KYPO_CONFIG_KEYS:
        source = get_kypo_config_source(key)
        val = get_kypo_config(key)
        display = "***" if "password" in key else val
        log.info("[kypo_config]  %-25s  source=%-5s  value=%s", key, source, display)
    log.info("[kypo_config] ===========================================")


def get_kypo_verify_ssl() -> bool:
    """Return kypo_verify_ssl as a Python bool."""
    val = get_kypo_config("kypo_verify_ssl")
    if isinstance(val, bool):
        return val
    return str(val).lower() not in ("false", "0", "")


def seed_kypo_configs_from_env() -> None:
    """
    No longer seeds anything. Kept so existing call sites keep working.

    Copying the environment into the config table made sense while the table was
    what got read. Now that the environment is read first, a copy in the table is
    a second value that can drift from the one in effect and be mistaken for it -
    and, for the credentials among them, a copy in a place more people can read
    than can deploy. Rows written by an earlier version are left alone: they are
    still the fallback for an install that has no environment set yet.
    """
    log.debug("[kypo_config] seeding skipped; the environment is read directly")
