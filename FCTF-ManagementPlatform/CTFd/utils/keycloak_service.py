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

from CTFd.utils.kypo_config import (
    get_kypo_admin_password,
    get_kypo_admin_username,
    get_kypo_keycloak_url,
    get_kypo_realm,
    get_kypo_verify_ssl,
)

logger = logging.getLogger(__name__)

# Cache token để tránh lấy lại liên tục
_token_cache: dict = {"token": None, "expires_at": 0}


def _get_admin_token(force_refresh: bool = False) -> str:
    """Lấy master admin token, cache lại trong 240s (token sống 300s)."""
    now = time.time()
    if not force_refresh and _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    keycloak_url = get_kypo_keycloak_url()
    admin_user   = get_kypo_admin_username()
    admin_pass   = get_kypo_admin_password()

    if not keycloak_url or not admin_user or not admin_pass:
        raise ValueError(
            f"[Keycloak] Missing config: keycloak_url={keycloak_url!r}, "
            f"admin_user={admin_user!r}, admin_pass={'***' if admin_pass else None!r}. "
            "Set kypo_keycloak_url / kypo_admin_username / kypo_admin_password in CTFd admin config."
        )

    url = f"{keycloak_url}/realms/master/protocol/openid-connect/token"
    logger.debug("[Keycloak] Fetching admin token from %s as user=%r", url, admin_user)
    resp = requests.post(
        url,
        data={
            "grant_type": "password",
            "client_id":  "admin-cli",
            "username":   admin_user,
            "password":   admin_pass,
        },
        verify=get_kypo_verify_ssl(),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + 240
    logger.debug("[Keycloak] Admin token refreshed (expires in 240s)")
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

    url = f"{get_kypo_keycloak_url()}/admin/realms/{get_kypo_realm()}/users"
    payload = {
        "username":      username,
        "enabled":       True,
        "firstName":     team_name,
        "lastName":      "FCTF Team",
        "email":         f"{username}@fctf.local",
        "emailVerified": True,
        "credentials": [
            {"type": "password", "value": password, "temporary": False}
        ],
    }
    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        verify=get_kypo_verify_ssl(),
        timeout=10,
    )

    # Token expired or not yet replicated across Keycloak nodes — wait 1s then retry
    if resp.status_code == 401:
        logger.warning("[Keycloak] 401 on create-user, refreshing token and retrying in 1s...")
        time.sleep(1)
        token = _get_admin_token(force_refresh=True)
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            verify=get_kypo_verify_ssl(),
            timeout=10,
        )

    if resp.status_code == 409:
        # User đã tồn tại — lấy UUID và reset password
        logger.warning(f"Keycloak user '{username}' đã tồn tại, lấy UUID và reset password.")
        r2 = requests.get(
            f"{get_kypo_keycloak_url()}/admin/realms/{get_kypo_realm()}/users?username={username}&exact=true",
            headers={"Authorization": f"Bearer {token}"},
            verify=get_kypo_verify_ssl(),
            timeout=10,
        )
        r2.raise_for_status()
        users = r2.json()
        if not users:
            raise ValueError(f"Keycloak user '{username}' tồn tại (409) nhưng không tìm được UUID.")
        kypo_user_id = users[0]["id"]
        # Reset password để đồng bộ với DB
        requests.put(
            f"{get_kypo_keycloak_url()}/admin/realms/{get_kypo_realm()}/users/{kypo_user_id}/reset-password",
            json={"type": "password", "value": password, "temporary": False},
            headers={"Authorization": f"Bearer {token}"},
            verify=get_kypo_verify_ssl(),
            timeout=10,
        ).raise_for_status()
        logger.info(f"Reused Keycloak user: {username} (id={kypo_user_id}) for team {team_id}")
    else:
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
    url   = f"{get_kypo_keycloak_url()}/admin/realms/{get_kypo_realm()}/users/{kypo_user_id}"
    resp  = requests.delete(
        url,
        headers={"Authorization": f"Bearer {token}"},
        verify=get_kypo_verify_ssl(),
        timeout=10,
    )
    if resp.status_code == 401:
        logger.warning("[Keycloak] 401 on delete-user, refreshing token and retrying in 1s...")
        time.sleep(1)
        token = _get_admin_token(force_refresh=True)
        resp  = requests.delete(
            url,
            headers={"Authorization": f"Bearer {token}"},
            verify=get_kypo_verify_ssl(),
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
    url      = f"{get_kypo_keycloak_url()}/admin/realms/{get_kypo_realm()}/users/{kypo_user_id}/reset-password"
    body     = {"type": "password", "value": new_pass, "temporary": False}
    resp     = requests.put(
        url,
        json=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        verify=get_kypo_verify_ssl(),
        timeout=10,
    )
    if resp.status_code == 401:
        logger.warning("[Keycloak] 401 on reset-password, refreshing token and retrying in 1s...")
        time.sleep(1)
        token = _get_admin_token(force_refresh=True)
        resp  = requests.put(
            url,
            json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            verify=get_kypo_verify_ssl(),
            timeout=10,
        )
    resp.raise_for_status()
    logger.info(f"Reset password for Keycloak user: {kypo_user_id}")
    return new_pass