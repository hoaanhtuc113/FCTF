from flask import render_template
from CTFd.admin import admin
from CTFd.models import Contests
from CTFd.utils.decorators import admins_only


@admin.route("/admin/contests/<int:contest_id>/kypo")
@admins_only
def kypo_resources(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/contests/sections/kypo_resources.html", contest=contest)
