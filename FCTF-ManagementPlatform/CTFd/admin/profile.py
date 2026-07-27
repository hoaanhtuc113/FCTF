from flask import render_template

from CTFd.admin import admin
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury
from CTFd.utils.user import get_current_user


@admin.route("/admin/profile", methods=["GET"])
@admin_or_challenge_writer_only_or_jury
def profile():
    user = get_current_user()
    return render_template("admin/profile.html", user=user)
