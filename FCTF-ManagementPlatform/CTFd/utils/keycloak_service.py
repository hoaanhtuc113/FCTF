"""
keycloak_service.py
Quản lý Keycloak accounts cho FCTF teams.
Dùng master admin token để tạo/xóa user trong realm CRCZP.

Config được đọc từ bảng DB `config` tại runtime (qua get_kypo_config),
với fallback về environment variables. Thay đổi giá trị trong DB sẽ có
hiệu lực ở lần refresh token tiếp theo (tối đa 240s).
"""
import hashlib
import logging
import secrets
import string
import time

import requests

logger = logging.getLogger(__name__)

# Cache token để tránh lấy lại liên tục.
# creds_hash tự invalidate cache khi admin credentials thay đổi.
_token_cache: dict = {"token": None, "expires_at": 0, "creds_hash": None}


def _get_admin_token() -> str:
    """Lấy master admin token, cache lại trong 240s (token sống 300s)."""
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    keycloak_url = get_kypo_config("kypo_keycloak_url")
    admin_user   = get_kypo_config("kypo_admin_username")
    admin_pass   = get_kypo_config("kypo_admin_password")
    verify_ssl   = get_kypo_verify_ssl()

    creds_hash = hashlib.md5(
        f"{keycloak_url}:{admin_user}:{admin_pass}".encode()
    ).hexdigest()

    now = time.time()
    if (
        _token_cache["token"]
        and now < _token_cache["expires_at"]
        and _token_cache["creds_hash"] == creds_hash
    ):
        return _token_cache["token"]

    url = f"{keycloak_url}/realms/master/protocol/openid-connect/token"
    resp = requests.post(
        url,
        data={
            "grant_type": "password",
            "client_id":  "admin-cli",
            "username":   admin_user,
            "password":   admin_pass,
        },
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"]      = data["access_token"]
    _token_cache["expires_at"] = now + 240
    _token_cache["creds_hash"] = creds_hash
    return _token_cache["token"]


def _generate_password(length: int = 16) -> str:
    """Generate password ngẫu nhiên đủ mạnh."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)
                and any(c in "!@#$%^&*" for c in pwd)):
            return pwd


def create_kypo_user(team_id: int, team_name: str) -> dict:
    """
    Tạo Keycloak user cho team.

    Returns:
        {
            "kypo_user_id": "uuid",
            "kypo_username": "fctf_team_25",
            "kypo_password": "plaintext password (chỉ trả về 1 lần)"
        }

    Raises:
        requests.HTTPError nếu gọi API thất bại
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    token      = _get_admin_token()
    realm      = get_kypo_config("kypo_realm")
    verify_ssl = get_kypo_verify_ssl()
    keycloak_url = get_kypo_config("kypo_keycloak_url")

    safe_name = "".join(c if c.isalnum() else "_" for c in team_name.lower())[:20]
    username  = f"fctf_{safe_name}_{team_id}"
    password  = _generate_password()

    url = f"{keycloak_url}/admin/realms/{realm}/users"
    resp = requests.post(
        url,
        json={
            "username":      username,
            "enabled":       True,
            "firstName":     team_name,
            "lastName":      "FCTF Team",
            "email":         f"{username}@fctf.local",
            "emailVerified": True,
            "credentials": [
                {"type": "password", "value": password, "temporary": False}
            ],
        },
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        verify=verify_ssl,
        timeout=10,
    )

    if resp.status_code == 409:
        raise ValueError(f"Keycloak user '{username}' đã tồn tại.")

    if not resp.ok:
        logger.error(
            "Keycloak create user failed: status=%s body=%s",
            resp.status_code, resp.text[:500],
        )
        resp.raise_for_status()

    location     = resp.headers.get("Location", "")
    kypo_user_id = location.rstrip("/").split("/")[-1]

    if not kypo_user_id:
        raise RuntimeError(
            f"Keycloak returned status {resp.status_code} but no Location header. "
            f"Headers: {dict(resp.headers)}"
        )

    logger.info("Created Keycloak user: %s (id=%s) for team %s", username, kypo_user_id, team_id)
    return {
        "kypo_user_id":  kypo_user_id,
        "kypo_username": username,
        "kypo_password": password,
    }


def delete_kypo_user(kypo_user_id: str) -> bool:
    """
    Xóa Keycloak user theo UUID.

    Returns:
        True nếu xóa thành công hoặc user không tồn tại
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    token      = _get_admin_token()
    realm      = get_kypo_config("kypo_realm")
    verify_ssl = get_kypo_verify_ssl()
    keycloak_url = get_kypo_config("kypo_keycloak_url")

    url  = f"{keycloak_url}/admin/realms/{realm}/users/{kypo_user_id}"
    resp = requests.delete(
        url,
        headers={"Authorization": f"Bearer {token}"},
        verify=verify_ssl,
        timeout=10,
    )
    if resp.status_code == 404:
        logger.warning(f"Keycloak user {kypo_user_id} not found (already deleted?)")
        return True
    resp.raise_for_status()
    logger.info(f"Deleted Keycloak user: {kypo_user_id}")
    return True


def reset_kypo_password(kypo_user_id: str) -> str:
    """
    Đổi password của Keycloak user, trả về password mới.
    Dùng sau mỗi contest để tránh team dùng lại credential.
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    token      = _get_admin_token()
    realm      = get_kypo_config("kypo_realm")
    verify_ssl = get_kypo_verify_ssl()
    keycloak_url = get_kypo_config("kypo_keycloak_url")

    new_pass = _generate_password()
    url      = f"{keycloak_url}/admin/realms/{realm}/users/{kypo_user_id}/reset-password"
    resp     = requests.put(
        url,
        json={"type": "password", "value": new_pass, "temporary": False},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()
    logger.info(f"Reset password for Keycloak user: {kypo_user_id}")
    return new_pass
