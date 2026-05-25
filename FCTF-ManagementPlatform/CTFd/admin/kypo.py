from flask import redirect, render_template, url_for
from CTFd.admin import admin
from CTFd.models import Contests
from CTFd.utils.decorators import admins_only


@admin.route("/admin/contests/<int:contest_id>/kypo")
@admins_only
def kypo_resources(contest_id):
    return redirect(url_for("admin.kypo_pools", contest_id=contest_id))


@admin.route("/admin/contests/<int:contest_id>/kypo/pools")
@admins_only
def kypo_pools(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/contests/sections/kypo_pools.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/kypo/sandbox-definitions")
@admins_only
def kypo_sandbox_definitions(contest_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template("admin/contests/sections/kypo_sandbox_definitions.html", contest=contest)


@admin.route("/admin/contests/<int:contest_id>/kypo/sandbox-definitions/<int:definition_id>/topology")
@admins_only
def kypo_definition_topology(contest_id, definition_id):
    contest = Contests.query.filter_by(id=contest_id).first_or_404()
    return render_template(
        "admin/contests/sections/kypo_definition_topology.html",
        contest=contest,
        definition_id=definition_id,
    )
