from flask import render_template

from CTFd.admin import admin
from CTFd.models import Notifications
from CTFd.utils.decorators import admin_or_jury, admins_only


@admin.route("/admin/notifications")
@admin_or_jury
def notifications():
    notifs = Notifications.query.order_by(Notifications.id.desc()).all()
    return render_template("admin/notifications.html", notifications=notifs)
