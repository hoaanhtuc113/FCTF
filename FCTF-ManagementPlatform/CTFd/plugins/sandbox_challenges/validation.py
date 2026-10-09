"""Validate a sandbox reference against the configured KYPO service before writes."""
from urllib.parse import urlsplit

import requests
from marshmallow import ValidationError

from CTFd.utils.kypo_config import get_kypo_base_url, get_kypo_verify_ssl
from CTFd.utils.validators.references import positive_id

KYPO_FIELDS = ("kypo_instance_id", "kypo_instance_type", "kypo_access_token", "kypo_base_url")


class KypoUnavailable(Exception):
    pass


def validate_config(data, existing=None):
    values = {key: data.get(key, getattr(existing, key, None)) for key in KYPO_FIELDS}
    values["kypo_instance_id"] = positive_id(values["kypo_instance_id"], "kypo_instance_id")
    kind = values["kypo_instance_type"] or ("linear" if "kypo_instance_type" not in data else None)
    if kind not in ("linear", "adaptive"):
        raise ValidationError("Instance type must be linear or adaptive", field_names=["kypo_instance_type"])
    values["kypo_instance_type"] = kind
    access_token = values["kypo_access_token"] if values["kypo_access_token"] is not None else ""
    if not isinstance(access_token, str) or len(access_token) > 64:
        raise ValidationError("Access token must be at most 64 characters", field_names=["kypo_access_token"])
    values["kypo_access_token"] = access_token

    # Metadata-only updates keep an existing reference; selecting/configuring
    # an instance always verifies it with KYPO. No user-supplied host is fetched.
    if existing is not None and not any(key in data for key in KYPO_FIELDS):
        return values
    base_url = get_kypo_base_url()
    if not isinstance(base_url, str) or not base_url.strip():
        raise KypoUnavailable("KYPO service is not configured")
    base_url = base_url.strip().rstrip("/")
    parsed = urlsplit(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or len(base_url) > 255:
        raise KypoUnavailable("KYPO service URL is invalid")
    supplied_base = data.get("kypo_base_url")
    if supplied_base is not None and (not isinstance(supplied_base, str) or supplied_base.rstrip("/") != base_url):
        raise ValidationError("Use the configured KYPO service URL", field_names=["kypo_base_url"])
    values["kypo_base_url"] = base_url

    from .routes import _get_kypo_token, _service_base
    try:
        token = _get_kypo_token()
        response = requests.get(
            "{}/training-instances/{}".format(_service_base(kind), values["kypo_instance_id"]),
            headers={"Authorization": "Bearer " + token}, timeout=15, verify=get_kypo_verify_ssl(),
            allow_redirects=False,
        )
        if response.status_code == 404:
            raise ValidationError("KYPO instance does not exist", field_names=["kypo_instance_id"])
        if response.status_code != 200:
            raise KypoUnavailable("Could not verify the KYPO instance")
        body = response.json()
        if not isinstance(body, dict) or str(body.get("id")) != str(values["kypo_instance_id"]):
            raise KypoUnavailable("KYPO returned an invalid instance response")
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raise KypoUnavailable("Could not verify the KYPO instance") from None
    return values
