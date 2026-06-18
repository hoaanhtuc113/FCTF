import logging
import urllib3
from flask import Blueprint, jsonify, request
import requests

from CTFd.utils.kypo_config import (
    get_kypo_base_url,
    get_kypo_client_id,
    get_kypo_password,
    get_kypo_username,
)
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury
from CTFd.utils.kypo_poller import (
    get_all_cached_progress,
    get_cached_progress,
    run_poll_cycle_now,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

log = logging.getLogger(__name__)

sandbox_kypo_api = Blueprint("sandbox_kypo_api", __name__, url_prefix="/api/v1")

# ── Auth ───────────────────────────────────────────────────────────────────


def _get_kypo_token():
    """Authenticate with Keycloak and return a Bearer token string."""
    base_url = get_kypo_base_url()
    token_url = (
        f"{base_url}/keycloak/realms/CRCZP/protocol/openid-connect/token"
    )
    resp = requests.post(
        token_url,
        data={
            "grant_type": "password",
            "client_id": get_kypo_client_id(),
            "username": get_kypo_username(),
            "password": get_kypo_password(),
        },
        timeout=15,
        verify=False,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _service_base(instance_type):
    base_url = get_kypo_base_url()
    if instance_type == "adaptive":
        return f"{base_url}/adaptive-training/api/v1"
    return f"{base_url}/training/api/v1"


# ── Instance list ──────────────────────────────────────────────────────────

def _extract_definition_id(item):
    """Try every known field name variant for training_definition_id."""
    for key in (
        "training_definition_id",
        "trainingDefinitionId",
        "training_definition",       # might be nested object with id
        "trainingDefinition",
    ):
        val = item.get(key)
        if val is None:
            continue
        # Support nested: {"training_definition": {"id": 5}}
        if isinstance(val, dict):
            val = val.get("id")
        if val is not None:
            return int(val)
    return None


def _fetch_instances(token, kind):
    """Fetch all pages of training instances; includes definition_id when available."""
    base_url = f"{_service_base(kind)}/training-instances"
    headers = {"Authorization": f"Bearer {token}"}
    results = []
    page = 0

    while True:
        resp = requests.get(
            base_url,
            params={"page": page, "size": 50},
            headers=headers,
            timeout=15,
            verify=False,
        )
        resp.raise_for_status()
        body = resp.json()
        content = body.get("content", [])

        for item in content:
            results.append({
                "id": item["id"],
                "title": item.get("title", f"Instance {item['id']}"),
                "access_token": item.get("access_token", ""),
                "instance_type": kind,
                # Capture definition ID from the list response (may be None)
                "training_definition_id": _extract_definition_id(item),
            })

        if body.get("last", True) or len(content) == 0:
            break
        page += 1

    return results


# ── Score extraction ────────────────────────────────────────────────────────

def _extract_score(definition):
    """
    Walk a training definition dict and sum max_score across all scorable levels.
    Handles both 'levels' (linear) and 'phases' (adaptive) keys.
    """
    levels = definition.get("levels") or definition.get("phases") or []
    total = 0

    for level in levels:
        level_type = (
            level.get("level_type")
            or level.get("levelType")
            or level.get("phase_type")
            or level.get("phaseType")
            or ""
        ).upper()

        max_score = int(level.get("max_score") or level.get("maxScore") or 0)

        if "TRAINING" in level_type:
            total += max_score
        elif "ASSESSMENT" in level_type:
            for q in level.get("questions", []):
                total += int(q.get("points", 0) or 0)

    return total


def _fetch_definition_score(token, base, definition_id):
    """
    Try to retrieve the training definition and return its total max_score.
    Attempts both the standard GET and the export endpoint as fallback.
    Returns (score: int, error: str|None).
    """
    headers = {"Authorization": f"Bearer {token}"}

    # Attempt 1: standard definition endpoint
    for url in (
        f"{base}/training-definitions/{definition_id}",
        f"{base}/training-definitions/{definition_id}/export",
    ):
        try:
            r = requests.get(url, headers=headers, timeout=15, verify=False)
            if r.status_code == 200:
                body = r.json()
                score = _extract_score(body)
                log.info("[KYPO] Got definition %s from %s → score=%s", definition_id, url, score)
                return score, None
            log.warning("[KYPO] %s → HTTP %s", url, r.status_code)
        except Exception as exc:
            log.warning("[KYPO] %s failed: %s", url, exc)

    return 0, f"Could not fetch definition {definition_id} (tried standard + export endpoints)"


# ── Endpoints ──────────────────────────────────────────────────────────────


@sandbox_kypo_api.route("/kypo/instances", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_kypo_instances():
    """Return merged list of linear + adaptive KYPO training instances."""
    try:
        token = _get_kypo_token()
    except Exception as exc:
        return jsonify({"success": False, "error": f"KYPO authentication failed: {exc}"}), 503

    instances = []
    errors = []

    for kind in ("linear", "adaptive"):
        try:
            instances.extend(_fetch_instances(token, kind))
        except Exception as exc:
            errors.append(f"{kind}: {exc}")

    return jsonify({"success": True, "data": instances, "errors": errors})


@sandbox_kypo_api.route("/kypo/instances/<int:instance_id>/details", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_kypo_instance_details(instance_id):
    """
    Fetch max_score for a specific KYPO training instance.

    Query params:
        instance_type      – 'linear' (default) or 'adaptive'
        definition_id      – (optional) skip the instance GET and use this directly
    """
    instance_type = request.args.get("instance_type", "linear")
    # definition_id may be passed directly from the instance list response
    definition_id = request.args.get("definition_id", type=int)

    try:
        token = _get_kypo_token()
    except Exception as exc:
        return jsonify({"success": False, "error": f"KYPO auth failed: {exc}"}), 503

    base = _service_base(instance_type)
    headers = {"Authorization": f"Bearer {token}"}

    # ── Step 1: Resolve definition_id ──────────────────────────────────────
    if not definition_id:
        # Try to get it from the single-instance endpoint
        inst_url = f"{base}/training-instances/{instance_id}"
        try:
            inst_resp = requests.get(inst_url, headers=headers, timeout=15, verify=False)
            if inst_resp.status_code == 200:
                instance_data = inst_resp.json()
                definition_id = _extract_definition_id(instance_data)
                log.info("[KYPO] Instance %s → definition_id=%s", instance_id, definition_id)
            else:
                log.warning("[KYPO] GET %s → HTTP %s", inst_url, inst_resp.status_code)
        except Exception as exc:
            log.warning("[KYPO] GET %s failed: %s", inst_url, exc)

    if not definition_id:
        # Last resort: scan the paginated list for this instance
        try:
            page = 0
            found = False
            while not found:
                list_resp = requests.get(
                    f"{base}/training-instances",
                    params={"page": page, "size": 50},
                    headers=headers,
                    timeout=15,
                    verify=False,
                )
                list_resp.raise_for_status()
                body = list_resp.json()
                for item in body.get("content", []):
                    if item["id"] == instance_id:
                        definition_id = _extract_definition_id(item)
                        found = True
                        break
                if found or body.get("last", True):
                    break
                page += 1
        except Exception as exc:
            log.warning("[KYPO] List scan failed: %s", exc)

    if not definition_id:
        return jsonify({
            "success": False,
            "error": (
                f"Could not find training_definition_id for instance {instance_id}. "
                "The KYPO API did not return this field in any response."
            ),
        }), 404

    # ── Step 2: Fetch definition and extract score ─────────────────────────
    max_score, err = _fetch_definition_score(token, base, definition_id)

    if err and max_score == 0:
        return jsonify({"success": False, "error": err}), 503

    return jsonify({
        "success": True,
        "data": {
            "max_score": max_score,
            "definition_id": definition_id,
        },
    })


@sandbox_kypo_api.route("/kypo/challenge/<int:challenge_id>/config", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_kypo_challenge_config(challenge_id):
    """Return the stored KypoChallengeConfig for a specific challenge (used by update form)."""
    from CTFd.models import KypoChallengeConfig

    config = KypoChallengeConfig.query.filter_by(challenge_id=challenge_id).first()

    return jsonify({
        "success": True,
        "data": {
            "kypo_instance_id": config.kypo_instance_id if config else None,
            "kypo_access_token": config.kypo_access_token if config else None,
            "kypo_instance_type": config.kypo_instance_type if config else None,
            "kypo_base_url": config.kypo_base_url if config else None,
        },
    })


@sandbox_kypo_api.route("/kypo/challenge/<int:challenge_id>/progress", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def get_challenge_progress(challenge_id):
    """
    Return cached KYPO progress for all teams on a challenge.

    Query params:
        team_id  – (optional) filter to a single team
    """
    team_id = request.args.get("team_id", type=int)

    if team_id is not None:
        data = get_cached_progress(challenge_id, team_id)
        return jsonify({
            "success": True,
            "data": [data] if data else [],
        })

    return jsonify({
        "success": True,
        "data": get_all_cached_progress(challenge_id),
    })


@sandbox_kypo_api.route("/kypo/sync", methods=["POST"])
@admin_or_challenge_writer_only_or_jury
def trigger_kypo_sync():
    """Manually trigger a KYPO progress sweep (runs synchronously in request)."""
    from flask import current_app
    try:
        run_poll_cycle_now(current_app._get_current_object())
        return jsonify({"success": True, "message": "KYPO sync completed."})
    except Exception as exc:
        log.error("[KYPO] Manual sync failed: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500
