"""
KYPO configuration helpers.

Đọc từ bảng configs (DB) trước, fallback về env var nếu chưa có.
Admin có thể cập nhật qua /api/v1/configs hoặc admin UI.

Keys trong DB:
  kypo_base_url, kypo_username, kypo_password, kypo_client_id,
  kypo_keycloak_url, kypo_realm, kypo_admin_username,
  kypo_admin_password, kypo_verify_ssl
"""

import logging

log = logging.getLogger(__name__)


def _get_and_log(key: str):
    from CTFd.utils import get_config
    val = get_config(key)
    if val is None:
        log.warning("[KYPO Config] key='%s' → NOT FOUND in DB (None)", key)
    else:
        masked = val if "password" not in key else "***"
        log.info("[KYPO Config] key='%s' → '%s'", key, masked)
    return val


from CTFd.constants.envvars import (
    KYPO_ADMIN_PASSWORD as _E_ADMIN_PWD,
    KYPO_ADMIN_USERNAME as _E_ADMIN_USER,
    KYPO_BASE_URL as _E_BASE_URL,
    KYPO_CLIENT_ID as _E_CLIENT_ID,
    KYPO_KEYCLOAK_URL as _E_KEYCLOAK_URL,
    KYPO_PASSWORD as _E_PASSWORD,
    KYPO_REALM as _E_REALM,
    KYPO_USERNAME as _E_USERNAME,
    KYPO_VERIFY_SSL as _E_VERIFY_SSL,
)


def get_kypo_base_url() -> str:
    return _get_and_log("kypo_base_url")


def get_kypo_username() -> str:
    return _get_and_log("kypo_username")


def get_kypo_password() -> str:
    return _get_and_log("kypo_password")


def get_kypo_client_id() -> str:
    return _get_and_log("kypo_client_id")


def get_kypo_keycloak_url() -> str:
    return _get_and_log("kypo_keycloak_url")


def get_kypo_realm() -> str:
    return _get_and_log("kypo_realm")


def get_kypo_admin_username() -> str:
    return _get_and_log("kypo_admin_username")


def get_kypo_admin_password() -> str:
    return _get_and_log("kypo_admin_password")


def get_kypo_verify_ssl() -> bool:
    val = _get_and_log("kypo_verify_ssl")
    if val is None:
        return _E_VERIFY_SSL
    if isinstance(val, bool):
        return val
    return str(val).lower() not in ("false", "0", "")


def seed_kypo_configs_from_env():
    """Seed DB với giá trị từ env var nếu chưa có. Gọi 1 lần khi app khởi động."""
    from CTFd.utils import get_config, set_config

    defaults = {
        "kypo_base_url":       _E_BASE_URL,
        "kypo_username":       _E_USERNAME,
        "kypo_password":       _E_PASSWORD,
        "kypo_client_id":      _E_CLIENT_ID,
        "kypo_keycloak_url":   _E_KEYCLOAK_URL,
        "kypo_realm":          _E_REALM,
        "kypo_admin_username": _E_ADMIN_USER,
        "kypo_admin_password": _E_ADMIN_PWD,
        "kypo_verify_ssl":     str(_E_VERIFY_SSL).lower(),
    }
    for key, value in defaults.items():
        if value is not None and get_config(key) is None:
            set_config(key, value)
