"""
CTFd/utils/kypo_service.py

Service gọi KYPO API dùng admin credentials (hardcode cho v1).
Token tự động refresh trước khi hết hạn.
"""

import time
import requests
from flask import current_app

# Tắt warning SSL khi dùng verify=False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Config hardcode cho v1 ───────────────────────────────────────────────────
KYPO_BASE_URL     = "https://vuontre.iahn.hanoi.vn"
KYPO_REALM        = "CRCZP"
KYPO_CLIENT_ID    = "CRCZP-Client"
KYPO_ADMIN_USER   = "crczp-admin"
KYPO_ADMIN_PASS   = "CAUehoz449aGNy"


class KypoService:
    """
    Singleton service gọi KYPO API.
    Dùng grant_type=password với admin account để lấy token.
    Cache token, tự refresh khi còn 30s nữa hết hạn.
    """

    def __init__(self):
        self._token = None
        self._expires_at = 0

    # ── Auth ─────────────────────────────────────────────────────────────────

    def _get_token(self) -> str:
        if self._token and time.time() < self._expires_at - 30:
            return self._token

        resp = requests.post(
            f"{KYPO_BASE_URL}/keycloak/realms/{KYPO_REALM}"
            f"/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": KYPO_CLIENT_ID,
                "username": KYPO_ADMIN_USER,
                "password": KYPO_ADMIN_PASS,
            },
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._expires_at = time.time() + data.get("expires_in", 300)
        return self._token

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{KYPO_BASE_URL}{path}"

    # ── Sandbox Definition ───────────────────────────────────────────────────

    def list_sandbox_definitions(self) -> dict:
        """
        Lấy danh sách sandbox definitions từ KYPO.
        GET /sandbox-service/api/v1/definitions
        """
        resp = requests.get(
            self._url("/sandbox-service/api/v1/definitions"),
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def get_sandbox_definition(self, definition_id: int) -> dict:
        """
        Lấy chi tiết 1 sandbox definition.
        GET /sandbox-service/api/v1/definitions/{id}
        """
        resp = requests.get(
            self._url(f"/sandbox-service/api/v1/definitions/{definition_id}"),
            headers=self._headers(),
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def create_sandbox_definition(self, git_url: str, revision: str = "main") -> dict:
        """
        Tạo sandbox definition mới từ Git repo.
        POST /sandbox-service/api/v1/definitions
        """
        resp = requests.post(
            self._url("/sandbox-service/api/v1/definitions"),
            json={"url": git_url, "rev": revision},
            headers=self._headers(),
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Pool ─────────────────────────────────────────────────────────────────

    def list_pools(self, page: int = 0, size: int = 50) -> dict:
        """
        Lấy danh sách tất cả pools từ KYPO.
        GET /sandbox-service/api/v1/pools
        """
        resp = requests.get(
            self._url("/sandbox-service/api/v1/pools"),
            params={"page": page, "size": size},
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def get_pool(self, pool_id: int) -> dict:
        """
        Lấy chi tiết 1 pool.
        GET /sandbox-service/api/v1/pools/{id}
        """
        resp = requests.get(
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}"),
            headers=self._headers(),
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def create_pool(self, definition_id: int, max_size: int,
                    comment: str = "") -> dict:
        """
        Tạo pool mới từ sandbox definition.
        POST /sandbox-service/api/v1/pools
        """
        resp = requests.post(
            self._url("/sandbox-service/api/v1/pools"),
            json={
                "definition_id": definition_id,
                "max_size": max_size,
                "comment": comment,
                "visible": True,
            },
            headers=self._headers(),
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def allocate_sandboxes(self, pool_id: int, count: int = 1) -> dict:
        """
        Allocate sandboxes cho pool.
        POST /sandbox-service/api/v1/pools/{id}/sandbox-allocation-units
        """
        resp = requests.post(
            self._url(
                f"/sandbox-service/api/v1/pools/{pool_id}"
                f"/sandbox-allocation-units"
            ),
            params={"count": count},
            headers=self._headers(),
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def get_pool_allocation_units(self, pool_id: int) -> dict:
        """
        Lấy trạng thái allocation units của pool.
        GET /sandbox-service/api/v1/pools/{id}/sandbox-allocation-units
        """
        resp = requests.get(
            self._url(
                f"/sandbox-service/api/v1/pools/{pool_id}"
                f"/sandbox-allocation-units"
            ),
            headers=self._headers(),
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()


    def edit_pool(self, pool_id: int, comment: str = "") -> dict:
        """
        Cập nhật comment của pool.
        PATCH /sandbox-service/api/v1/pools/{id}
        """
        resp = requests.patch(
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}"),
            json={"comment": comment},
            headers=self._headers(),
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json() if resp.content else {"updated": True}

    def download_pool_ssh_config(self, pool_id: int) -> bytes:
        """
        Download SSH config ZIP của pool.
        GET /sandbox-service/api/v1/pools/{id}/management-ssh-access
        Trả về raw bytes của file ZIP.
        """
        resp = requests.get(
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}/management-ssh-access"),
            headers=self._headers(),
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.content

    def toggle_pool_lock(self, pool_id: int, lock: bool = True) -> dict:
        """
        Lock/unlock resource limit của pool.
        POST /sandbox-service/api/v1/pools/{id}/lock
        DELETE /sandbox-service/api/v1/pools/{id}/lock
        """
        method = "POST" if lock else "DELETE"
        resp = requests.request(
            method,
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}/lock"),
            headers=self._headers(),
            verify=False,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json() if resp.content else {"locked": lock}

    def delete_pool(self, pool_id: int) -> None:
        """
        Xóa pool khỏi KYPO.
        DELETE /sandbox-service/api/v1/pools/{id}
        """
        resp = requests.delete(
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}"),
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()


# Singleton — dùng chung toàn app
kypo_service = KypoService()