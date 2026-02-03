from flask import render_template

from CTFd.admin import admin
from CTFd.utils.decorators import admin_or_jury


@admin.route("/admin/analytics", methods=["GET"])
@admin_or_jury
def analytics():
    """Competition Analytics page with custom query endpoint."""
    return render_template("admin/rewards.html")
