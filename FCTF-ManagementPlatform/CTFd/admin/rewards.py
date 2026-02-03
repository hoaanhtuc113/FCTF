from flask import jsonify, request, render_template

from CTFd.admin import admin
from CTFd.plugins import bypass_csrf_protection
from CTFd.utils.decorators import admin_or_jury
from CTFd.utils.rewards.query_engine import QuerySpecError, execute_query, validate_query_spec


@admin.route("/admin/rewards/query", methods=["POST"])
@bypass_csrf_protection
@admin_or_jury
def rewards_query():
    payload = request.get_json() or {}
    try:
        spec = validate_query_spec(payload)
        response = execute_query(spec)
        return jsonify(response)
    except QuerySpecError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@admin.route("/admin/rewards", methods=["GET"])
@admin_or_jury
def rewards_page():
    return render_template("admin/rewards.html")
