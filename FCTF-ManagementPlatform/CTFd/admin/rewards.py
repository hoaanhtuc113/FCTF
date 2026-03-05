from flask import jsonify, request, render_template

from CTFd.admin import admin
from CTFd.models import Challenges, Teams, db
from CTFd.utils.decorators import admin_or_jury
from CTFd.utils.rewards.query_engine import QuerySpecError, execute_query, validate_query_spec
from CTFd.utils.rewards.reward_templates import (
    build_query_from_template,
    get_template,
    get_template_categories,
    list_templates,
)
from CTFd.utils.rewards.multi_criteria import (
    create_multi_criteria_query,
    get_multi_criteria_preset,
    list_multi_criteria_presets,
    MultiCriteriaExecutor,
)


@admin.route("/admin/rewards/query", methods=["POST"])
@admin_or_jury
def rewards_query():
    """Legacy endpoint for raw query execution."""
    payload = request.get_json() or {}
    try:
        spec = validate_query_spec(payload)
        response = execute_query(spec)
        return jsonify(response)
    except QuerySpecError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@admin.route("/admin/rewards/templates", methods=["GET"])
@admin_or_jury
def list_reward_templates():
    """List all available reward templates."""
    category = request.args.get("category")
    templates = list_templates(category=category)
    
    return jsonify({
        "success": True,
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "icon": t.icon,
                "customizable_params": t.customizable_params,
                "example_usage": t.example_usage,
            }
            for t in templates
        ],
        "categories": get_template_categories(),
    })


@admin.route("/admin/rewards/templates/<template_id>", methods=["GET"])
@admin_or_jury
def get_reward_template(template_id):
    """Get details of a specific reward template."""
    template = get_template(template_id)
    if not template:
        return jsonify({"success": False, "error": "Template not found"}), 404
    
    return jsonify({
        "success": True,
        "template": {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "category": template.category,
            "icon": template.icon,
            "customizable_params": template.customizable_params,
            "example_usage": template.example_usage,
            "query_config": template.query_config,
        },
    })


@admin.route("/admin/rewards/preview", methods=["POST"])
@admin_or_jury
def preview_reward():
    """Preview results for a reward template with custom parameters."""
    payload = request.get_json() or {}
    template_id = payload.get("template_id")
    params = payload.get("params", {})
    
    if not template_id:
        return jsonify({"success": False, "error": "template_id is required"}), 400
    
    try:
        query_config = build_query_from_template(template_id, params)
        if not query_config:
            return jsonify({"success": False, "error": "Template not found"}), 404
        
        spec = validate_query_spec(query_config)
        response = execute_query(spec)
        
        # Add template info to response
        template = get_template(template_id)
        response["template"] = {
            "id": template.id,
            "name": template.name,
            "description": template.description,
        }
        response["success"] = True
        
        return jsonify(response)
    except QuerySpecError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": f"Unexpected error: {str(exc)}"}), 500


@admin.route("/admin/rewards/multi-criteria/presets", methods=["GET"])
@admin_or_jury
def list_multi_criteria():
    """List all multi-criteria presets."""
    presets = list_multi_criteria_presets()
    return jsonify({
        "success": True,
        "presets": presets
    })


@admin.route("/admin/rewards/multi-criteria/preview", methods=["POST"])
@admin_or_jury
def preview_multi_criteria():
    """Preview results for a multi-criteria query."""
    payload = request.get_json() or {}
    
    # Check if using preset
    preset_id = payload.get("preset_id")
    if preset_id:
        query = get_multi_criteria_preset(preset_id)
        if not query:
            return jsonify({"success": False, "error": "Preset not found"}), 404
    else:
        # Custom multi-criteria query
        rules = payload.get("rules", [])
        logic = payload.get("logic", "AND")
        combine_method = payload.get("combine_method", "intersection")
        description = payload.get("description", "")
        
        if not rules:
            return jsonify({"success": False, "error": "No rules provided"}), 400
        
        try:
            query = create_multi_criteria_query(
                rules=rules,
                logic=logic,
                combine_method=combine_method,
                description=description
            )
        except Exception as exc:
            return jsonify({"success": False, "error": f"Invalid query: {str(exc)}"}), 400
    
    # Execute the query
    try:
        executor = MultiCriteriaExecutor(query)
        result = executor.execute()
        result["success"] = True
        return jsonify(result)
    except Exception as exc:
        return jsonify({"success": False, "error": f"Execution error: {str(exc)}"}), 500


@admin.route("/admin/rewards", methods=["GET"])
@admin_or_jury
def rewards_page():
    return render_template("admin/rewards.html")


@admin.route("/admin/rewards/categories", methods=["GET"])
@admin_or_jury
def rewards_categories():
    """Get all challenge categories from the database."""
    categories = (
        db.session.query(Challenges.category)
        .distinct()
        .order_by(Challenges.category)
        .all()
    )
    return jsonify({
        "success": True,
        "categories": [c[0] for c in categories if c[0]],
    })


@admin.route("/admin/rewards/challenges", methods=["GET"])
@admin_or_jury
def rewards_challenges():
    """Get all challenges, optionally filtered by search term."""
    search = request.args.get("search", "").strip()
    q = Challenges.query
    if search:
        q = q.filter(Challenges.name.ilike(f"%{search}%"))
    challenges = q.order_by(Challenges.name).all()
    return jsonify({
        "success": True,
        "challenges": [
            {"id": c.id, "name": c.name, "category": c.category}
            for c in challenges
        ],
    })


@admin.route("/admin/rewards/teams", methods=["GET"])
@admin_or_jury
def rewards_teams():
    """Get all teams, optionally filtered by search term."""
    search = request.args.get("search", "").strip()
    q = Teams.query
    if search:
        q = q.filter(Teams.name.ilike(f"%{search}%"))
    teams = q.order_by(Teams.name).all()
    return jsonify({
        "success": True,
        "teams": [{"id": t.id, "name": t.name} for t in teams],
    })
