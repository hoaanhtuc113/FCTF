import json
import logging
from datetime import datetime
from flask import session

audit_logger = logging.getLogger("audit")
audit_logger.setLevel(logging.INFO)

def log_audit(action, before=None, after=None, data=None):
    entry = {
        "level": "Information",
        "type": "audit",
        "action": action,
        "userId": session.get("id"),
        "before": before,
        "after": after,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    }
    audit_logger.info(json.dumps(entry))
