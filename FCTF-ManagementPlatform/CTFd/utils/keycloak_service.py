"""
keycloak_service.py
Quản lý Keycloak accounts cho FCTF teams.
Dùng master admin token để tạo/xóa user trong realm CRCZP.
"""
import logging
import secrets
import string
import time

import requests

from CTFd.constants.envvars import (
    KYPO_KEYCLOAK_URL   as KEYCLOAK_BASE_URL,
    KYPO_REALM          as KEYCLOAK_REALM,
    KYPO_ADMIN_USERNAME as KEYCLOAK_ADMIN_USER,
    KYPO_ADMIN_PASSWORD as KEYCLOAK_ADMIN_PASS,
    KYPO_VERIFY_SSL     as KEYCLOAK_VERIFY_SSL,
)

logger = logging.getLogger(__name__)

# Cache token để tránh lấy lại liên tục
_token_cache: dict = {"token": None, "expires_at": 0}


def _get_admin_token() -> str:
    """Lấy master admin token, cache lại trong 240s (token sống 300s)."""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    url = f"{KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token"
    resp = requests.post(
        url,
        data={
            "grant_type": "password",
            "client_id":  "admin-cli",
            "username":   KEYCLOAK_ADMIN_USER,
            "password":   KEYCLOAK_ADMIN_PASS,
        },
        verify=KEYCLOAK_VERIFY_SSL,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + 240
    return _token_cache["token"]


def _generate_password(length: int = 16) -> str:
    """Generate password ngẫu nhiên đủ mạnh."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        # Đảm bảo có ít nhất 1 chữ hoa, 1 số, 1 ký tự đặc biệt
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
    token = _get_admin_token()

    # Tạo username slug từ team_name, fallback về team_id
    safe_name = "".join(c if c.isalnum() else "_" for c in team_name.lower())[:20]
    username  = f"fctf_{safe_name}_{team_id}"
    password  = _generate_password()

    url = f"{KEYCLOAK_BASE_URL}/admin/realms/{KEYCLOAK_REALM}/users"
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
        verify=KEYCLOAK_VERIFY_SSL,
        timeout=10,
    )

    if resp.status_code == 409:
        raise ValueError(f"Keycloak user '{username}' đã tồn tại.")
    resp.raise_for_status()

    # Keycloak trả về Location header chứa UUID của user mới
    location = resp.headers.get("Location", "")
    kypo_user_id = location.rstrip("/").split("/")[-1]

    logger.info(f"Created Keycloak user: {username} (id={kypo_user_id}) for team {team_id}")
    return {
        "kypo_user_id": kypo_user_id,
        "kypo_username": username,
        "kypo_password": password,
    }


def delete_kypo_user(kypo_user_id: str) -> bool:
    """
    Xóa Keycloak user theo UUID.

    Returns:
        True nếu xóa thành công hoặc user không tồn tại
    """
    token = _get_admin_token()
    url   = f"{KEYCLOAK_BASE_URL}/admin/realms/{KEYCLOAK_REALM}/users/{kypo_user_id}"
    resp  = requests.delete(
        url,
        headers={"Authorization": f"Bearer {token}"},
        verify=KEYCLOAK_VERIFY_SSL,
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
    token    = _get_admin_token()
    new_pass = _generate_password()
    url      = f"{KEYCLOAK_BASE_URL}/admin/realms/{KEYCLOAK_REALM}/users/{kypo_user_id}/reset-password"
    resp     = requests.put(
        url,
        json={"type": "password", "value": new_pass, "temporary": False},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        verify=KEYCLOAK_VERIFY_SSL,
        timeout=10,
    )
    resp.raise_for_status()
    logger.info(f"Reset password for Keycloak user: {kypo_user_id}")
    return new_pass