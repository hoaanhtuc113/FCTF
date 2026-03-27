# Notifications feature removed — this module is kept as a stub to avoid
# ImportError if any legacy code path tries to import from it.

from flask_restx import Namespace, Resource

notifications_namespace = Namespace(
    "notifications", description="Notifications (disabled)"
)


class NotificantionList(Resource):
    """Stub kept for backward-compatibility imports."""
    pass
