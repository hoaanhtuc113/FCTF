from flask import render_template, request, url_for

from CTFd.admin import admin
from CTFd.utils.decorators import admin_or_jury, admins_only


@admin.route("/admin/notifications")
@admin_or_jury
def notifications():
    # Notifications feature disabled
    from flask import abort
    abort(404)
