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

# Token riêng cho tài khoản admin KYPO (crczp-admin, realm CRCZP) — khác với
# _token_cache ở trên (Keycloak master realm, chỉ dùng cho Keycloak Admin REST API).
_crczp_token_cache: dict = {"token": None, "expires_at": 0, "creds_hash": None}

# Group mặc định mà KYPO tự động add user vào khi họ login qua UI (JIT-provisioning).
# Group này gắn sẵn role ROLE_USER_AND_GROUP_POWER_USER.
DEFAULT_GROUP_NAME = "USER-AND-GROUP_USER"

# Cache id của DEFAULT_GROUP_NAME — cố định trong 1 deployment.
_default_group_cache: dict = {"id": None, "base_url": None}


def _get_admin_token() -> str:
    """Lấy master admin token, cache lại trong 45s (token sống 60s)."""
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
    expires_in = data.get("expires_in", 60)
    _token_cache["token"]      = data["access_token"]
    _token_cache["expires_at"] = now + max(expires_in - 15, 10)
    _token_cache["creds_hash"] = creds_hash
    return _token_cache["token"]


def _get_crczp_admin_token() -> str:
    """
    Lấy token của tài khoản admin KYPO (crczp-admin, realm CRCZP, có sẵn role
    ROLE_USER_AND_GROUP_ADMINISTRATOR) — dùng để gọi user-and-group API.

    Khác với _get_admin_token() ở trên: đó là token Keycloak master realm, chỉ dùng
    được cho Keycloak Admin REST API (tạo/xóa Keycloak user), không có quyền gì trên
    các service nội bộ của KYPO (training, user-and-group, ...).
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    base_url   = get_kypo_config("kypo_base_url")
    realm      = get_kypo_config("kypo_realm")
    client_id  = get_kypo_config("kypo_client_id")
    username   = get_kypo_config("kypo_username")
    password   = get_kypo_config("kypo_password")
    verify_ssl = get_kypo_verify_ssl()

    creds_hash = hashlib.md5(f"{base_url}:{username}:{password}".encode()).hexdigest()

    now = time.time()
    if (
        _crczp_token_cache["token"]
        and now < _crczp_token_cache["expires_at"]
        and _crczp_token_cache["creds_hash"] == creds_hash
    ):
        return _crczp_token_cache["token"]

    url = f"{base_url}/keycloak/realms/{realm}/protocol/openid-connect/token"
    resp = requests.post(
        url,
        data={
            "grant_type": "password",
            "client_id":  client_id,
            "username":   username,
            "password":   password,
        },
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    expires_in = data.get("expires_in", 60)
    _crczp_token_cache["token"]      = data["access_token"]
    _crczp_token_cache["expires_at"] = now + max(expires_in - 15, 10)
    _crczp_token_cache["creds_hash"] = creds_hash
    return _crczp_token_cache["token"]


def _get_team_access_token(username: str, password: str) -> str:
    """ROPC login bằng chính username/password của team account (KYPO CRCZP realm)."""
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    base_url   = get_kypo_config("kypo_base_url")
    realm      = get_kypo_config("kypo_realm")
    client_id  = get_kypo_config("kypo_client_id")
    verify_ssl = get_kypo_verify_ssl()

    url = f"{base_url}/keycloak/realms/{realm}/protocol/openid-connect/token"
    resp = requests.post(
        url,
        data={
            "grant_type": "password",
            "client_id":  client_id,
            "username":   username,
            "password":   password,
        },
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _get_uag_own_user_id(team_token: str) -> int:
    """
    Gọi /user-and-group/api/v1/users/info bằng token của chính team account.
    Trả về id nội bộ (uag-service) của user đó; gọi API này cũng chính là bước
    trigger JIT-provisioning phía uag-service nếu user chưa từng được biết tới.
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    base_url   = get_kypo_config("kypo_base_url")
    verify_ssl = get_kypo_verify_ssl()

    url = f"{base_url}/user-and-group/api/v1/users/info"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {team_token}"},
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _get_default_group_id() -> int:
    """Tra id của group mặc định DEFAULT_GROUP_NAME, cache lại (cố định trong 1 deployment)."""
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    base_url = get_kypo_config("kypo_base_url")

    if _default_group_cache["id"] is not None and _default_group_cache["base_url"] == base_url:
        return _default_group_cache["id"]

    token      = _get_crczp_admin_token()
    verify_ssl = get_kypo_verify_ssl()

    url = f"{base_url}/user-and-group/api/v1/groups?size=100"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        verify=verify_ssl,
        timeout=10,
    )
    resp.raise_for_status()

    data = resp.json()
    groups = data.get("content", data) if isinstance(data, dict) else data

    for group in groups:
        if group.get("name") == DEFAULT_GROUP_NAME:
            group_id = group["id"]
            _default_group_cache["id"] = group_id
            _default_group_cache["base_url"] = base_url
            return group_id

    raise RuntimeError(f"Group '{DEFAULT_GROUP_NAME}' not found in KYPO user-and-group service")


def add_user_to_default_group(username: str, password: str) -> None:
    """
    Add tài khoản team vào group mặc định DEFAULT_GROUP_NAME (role
    ROLE_USER_AND_GROUP_POWER_USER gắn sẵn theo group này).

    Bước này bình thường KYPO tự làm khi user login qua UI (JIT-provisioning), nhưng
    team account của FCTF không bao giờ login qua UI (token được bơm thẳng vào browser
    qua bridge.html, dùng ROPC để lấy token) nên bước auto-add không bao giờ chạy.
    Thiếu group này không chặn start/submit level, nhưng làm training-service từ chối
    lúc bấm Finish training run ("Cannot retrieve information about another user"), vì
    lúc đó nó cần tự tra lại info của chính user đó qua uag-service.

    Best-effort: lỗi ở đây chỉ log warning, không raise — không được làm fail việc tạo
    tài khoản KYPO.
    """
    try:
        team_token  = _get_team_access_token(username, password)
        uag_user_id = _get_uag_own_user_id(team_token)
        group_id    = _get_default_group_id()

        from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

        base_url    = get_kypo_config("kypo_base_url")
        verify_ssl  = get_kypo_verify_ssl()
        admin_token = _get_crczp_admin_token()

        url = f"{base_url}/user-and-group/api/v1/groups/{group_id}/users"
        resp = requests.put(
            url,
            json={
                "ids_of_users_to_be_add": [uag_user_id],
                "ids_of_groups_of_imported_users": [],
            },
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            verify=verify_ssl,
            timeout=10,
        )
        resp.raise_for_status()
        logger.info(
            "Added Keycloak user '%s' (uag id=%s) to default group '%s' (id=%s)",
            username, uag_user_id, DEFAULT_GROUP_NAME, group_id,
        )
    except Exception:
        logger.warning(
            "Could not add Keycloak user '%s' to default group '%s' — Finish training run "
            "may fail later with 'Cannot retrieve information about another user'",
            username, DEFAULT_GROUP_NAME, exc_info=True,
        )


def _generate_password(length: int = 16) -> str:
    """Generate password ngẫu nhiên đủ mạnh."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)
                and any(c in "!@#$%^&*" for c in pwd)):
            return pwd


def create_kypo_user(team_id: int, team_name: str, contest_id: int = None) -> dict:
    """
    Tạo Keycloak user cho team.

    Username format:
        - Lần thử 1: fctf_c{contest_id}_{safe_name}_{team_id}   (hoặc bỏ c{contest_id} nếu None)
        - Lần thử 2+: thêm random suffix 4 hex để tránh 409 conflict khi nhiều
          instance FCTF chia sẻ cùng Keycloak (team_id local có thể trùng nhau).

    Returns:
        {
            "kypo_user_id": "uuid",
            "kypo_username": "fctf_c3_hust_team_42",
            "kypo_password": "plaintext password (chỉ trả về 1 lần)"
        }

    Raises:
        requests.HTTPError nếu gọi API thất bại
        RuntimeError nếu không tạo được username unique sau 5 lần thử
    """
    from CTFd.utils.kypo_config import get_kypo_config, get_kypo_verify_ssl

    token      = _get_admin_token()
    realm      = get_kypo_config("kypo_realm")
    verify_ssl = get_kypo_verify_ssl()
    keycloak_url = get_kypo_config("kypo_keycloak_url")

    safe_name = "".join(c if c.isalnum() else "_" for c in team_name.lower())[:12]
    if contest_id is not None:
        base_username = f"fctf_c{contest_id}_{safe_name}_{team_id}"
    else:
        base_username = f"fctf_{safe_name}_{team_id}"

    password = _generate_password()
    url = f"{keycloak_url}/admin/realms/{realm}/users"

    for attempt in range(5):
        username = base_username if attempt == 0 else f"{base_username}_{secrets.token_hex(4)}"

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
            logger.warning(
                "Keycloak username '%s' already exists (attempt %d/5), retrying with suffix",
                username, attempt + 1,
            )
            continue

        if not resp.ok:
            logger.error(
                "Keycloak create user failed: status=%s body=%s",
                resp.status_code, resp.text[:500],
            )
            resp.raise_for_status()

        # Success
        location     = resp.headers.get("Location", "")
        kypo_user_id = location.rstrip("/").split("/")[-1]

        if not kypo_user_id:
            raise RuntimeError(
                f"Keycloak returned status {resp.status_code} but no Location header. "
                f"Headers: {dict(resp.headers)}"
            )

        logger.info("Created Keycloak user: %s (id=%s) for team %s", username, kypo_user_id, team_id)
        add_user_to_default_group(username, password)
        return {
            "kypo_user_id":  kypo_user_id,
            "kypo_username": username,
            "kypo_password": password,
        }

    raise RuntimeError(
        f"Cannot create unique Keycloak username for team '{team_name}' (team_id={team_id}) "
        f"after 5 attempts. Last conflict on: '{username}'"
    )

    if resp.status_code == 409:
        # User đã tồn tại — lấy lại UUID và reset password
        logger.warning("Keycloak user '%s' already exists, fetching existing user.", username)
        search_url = f"{keycloak_url}/admin/realms/{realm}/users?username={username}&exact=true"
        search_resp = requests.get(
            search_url,
            headers={"Authorization": f"Bearer {token}"},
            verify=verify_ssl,
            timeout=10,
        )
        search_resp.raise_for_status()
        users_found = search_resp.json()
        if not users_found:
            raise ValueError(f"Keycloak user '{username}' reported as duplicate but could not be found.")
        kypo_user_id = users_found[0]["id"]

        # Reset password
        reset_url = f"{keycloak_url}/admin/realms/{realm}/users/{kypo_user_id}/reset-password"
        reset_resp = requests.put(
            reset_url,
            json={"type": "password", "value": password, "temporary": False},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            verify=verify_ssl,
            timeout=10,
        )
        reset_resp.raise_for_status()
        logger.info("Reused existing Keycloak user: %s (id=%s) for team %s", username, kypo_user_id, team_id)
        return {
            "kypo_user_id":  kypo_user_id,
            "kypo_username": username,
            "kypo_password": password,
        }

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
