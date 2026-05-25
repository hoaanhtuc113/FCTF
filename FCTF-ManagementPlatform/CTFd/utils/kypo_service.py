"""
CTFd/utils/kypo_service.py

Service for calling the KYPO API using admin credentials (hardcoded for v1).
Token is automatically refreshed before it expires.
"""

import time
import requests
from flask import current_app

# Suppress SSL warnings when using verify=False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Hardcoded config for v1 ──────────────────────────────────────────────────
KYPO_BASE_URL     = "https://vuontre.iahn.hanoi.vn"
KYPO_REALM        = "CRCZP"
KYPO_CLIENT_ID    = "CRCZP-Client"
KYPO_ADMIN_USER   = "crczp-admin"
KYPO_ADMIN_PASS   = "CAUehoz449aGNy"


class KypoService:
    """
    Singleton service for calling the KYPO API.
    Uses grant_type=password with an admin account to obtain a token.
    Caches the token and auto-refreshes when less than 30 seconds remain.
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
        Fetch the list of sandbox definitions from KYPO.
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
        Fetch detail of a single sandbox definition.
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
        Create a new sandbox definition from a Git repository.
        POST /sandbox-service/api/v1/definitions
        """
        resp = requests.post(
            self._url("/sandbox-service/api/v1/definitions"),
            json={"url": git_url, "rev": revision},
            headers=self._headers(),
            verify=False,
            timeout=30,
        )
        if not resp.ok:
            current_app.logger.error("KYPO create_sandbox_definition error %s: %s", resp.status_code, resp.text)
        resp.raise_for_status()
        return resp.json()

    # ── Pool ─────────────────────────────────────────────────────────────────

    def list_pools(self, page: int = 0, size: int = 50) -> dict:
        """
        Fetch the list of all pools from KYPO.
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
        Fetch detail of a single pool.
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
        Create a new pool from a sandbox definition.
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
        Allocate sandboxes for a pool.
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
        Fetch the allocation unit status of a pool.
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
        Update the comment of a pool.
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
        Download the SSH config ZIP for a pool.
        GET /sandbox-service/api/v1/pools/{id}/management-ssh-access
        Returns raw bytes of the ZIP file.
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
        Lock/unlock the resource limit of a pool.
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
        Delete a pool from KYPO.
        DELETE /sandbox-service/api/v1/pools/{id}
        """
        resp = requests.delete(
            self._url(f"/sandbox-service/api/v1/pools/{pool_id}"),
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()

    def delete_sandbox_definition(self, definition_id: int) -> None:
        """
        Delete a sandbox definition from KYPO.
        DELETE /sandbox-service/api/v1/definitions/{id}
        """
        resp = requests.delete(
            self._url(f"/sandbox-service/api/v1/definitions/{definition_id}"),
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()

    def get_definition_topology(self, definition_id: int) -> dict:
        """
        Fetch topology data of a sandbox definition.
        GET /sandbox-service/api/v1/definitions/{id}/topology
        """
        resp = requests.get(
            self._url(f"/sandbox-service/api/v1/definitions/{definition_id}/topology"),
            headers=self._headers(),
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()


# Singleton — shared across the entire application
kypo_service = KypoService()