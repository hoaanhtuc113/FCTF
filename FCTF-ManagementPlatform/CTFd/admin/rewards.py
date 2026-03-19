from flask import jsonify, request, render_template

from CTFd.admin import admin
from CTFd.models import Brackets, Challenges, Teams, db
from CTFd.plugins import bypass_csrf_protection
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


@admin.route("/admin/rewards/details", methods=["POST"])
@admin_or_jury
def rewards_details():
    """Return solved challenges for a specific team, used by expandable rows."""
    from sqlalchemy import text as sa_text

    payload = request.get_json() or {}
    template_id = payload.get("template_id", "")
    entity_id = payload.get("entity_id")

    if not entity_id:
        return jsonify({"success": False, "error": "entity_id is required"}), 400

    entity_id = int(entity_id)

    # Always filter by team
    filter_col = "s.team_id"

    # Build extra conditions based on the template type
    extra_join = ""
    extra_where = ""

    if template_id == "category_masters":
        # Show all categories that this team has fully cleared
        sql = """
            SELECT
                sf.category,
                COUNT(DISTINCT sf.challenge_id) AS solved_count,
                ct.total_challenges,
                MAX(sf.solve_date) AS full_clear_date
            FROM (
                SELECT s.id AS solve_id, c.id AS challenge_id, c.name AS challenge_name,
                       c.category, c.value AS challenge_value, s.date AS solve_date
                FROM submissions s
                JOIN solves sol ON sol.id = s.id
                JOIN challenges c ON c.id = s.challenge_id
                WHERE s.type = 'correct' AND s.team_id = :entity_id
            ) sf
            JOIN (
                SELECT category, COUNT(*) AS total_challenges
                FROM challenges WHERE state = 'visible'
                GROUP BY category
            ) ct ON ct.category = sf.category
            GROUP BY sf.category, ct.total_challenges
            HAVING COUNT(DISTINCT sf.challenge_id) >= ct.total_challenges
            ORDER BY full_clear_date ASC
        """
        rows = db.session.execute(sa_text(sql), {"entity_id": entity_id}).fetchall()
        details = []
        for row in rows:
            details.append({
                "category": row.category,
                "solved_count": row.solved_count,
                "total_challenges": row.total_challenges,
                "full_clear_date": str(row.full_clear_date) if row.full_clear_date else None,
            })
        return jsonify({"success": True, "details": details, "detail_type": "category_clear"})

    if template_id == "first_blood_hunters":
        # Only show challenges where this entity got first blood
        extra_join = """
            JOIN (
                SELECT challenge_id, MIN(date) AS fb_date
                FROM submissions
                WHERE type = 'correct'
                GROUP BY challenge_id
            ) fb ON fb.challenge_id = s.challenge_id AND fb.fb_date = s.date
        """
    elif template_id == "perfect_solvers":
        # Only show challenges solved without any wrong submissions
        extra_where = """
            AND NOT EXISTS (
                SELECT 1 FROM submissions w
                WHERE w.challenge_id = s.challenge_id
                AND w.type = 'incorrect'
                AND w.date < s.date
                AND w.team_id = :entity_id
            )
        """
    elif template_id == "no_hints_solvers":
        # Only show challenges solved without using hints
        extra_where = """
            AND NOT EXISTS (
                SELECT 1 FROM unlocks u
                JOIN hints h ON h.id = u.target
                WHERE u.type = 'hints'
                AND h.challenge_id = s.challenge_id
                AND u.team_id = :entity_id
            )
        """

    sql = f"""
        SELECT
            c.id AS challenge_id,
            c.name AS challenge_name,
            c.category,
            c.value AS score,
            s.date AS solve_date
        FROM submissions s
        JOIN solves sol ON sol.id = s.id
        JOIN challenges c ON c.id = s.challenge_id
        {extra_join}
        WHERE s.type = 'correct'
        AND {filter_col} = :entity_id
        {extra_where}
        ORDER BY c.category, c.name
    """

    rows = db.session.execute(sa_text(sql), {"entity_id": entity_id}).fetchall()

    details = []
    for row in rows:
        details.append({
            "challenge_id": row.challenge_id,
            "challenge_name": row.challenge_name,
            "category": row.category,
            "score": row.score,
            "solve_date": str(row.solve_date) if row.solve_date else None,
        })

    return jsonify({"success": True, "details": details})


@admin.route("/admin/rewards/categories", methods=["GET"])
@bypass_csrf_protection
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
@bypass_csrf_protection
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
@bypass_csrf_protection
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


@admin.route("/admin/rewards/brackets", methods=["GET"])
@bypass_csrf_protection
@admin_or_jury
def rewards_brackets():
    """Get all brackets."""
    brackets = Brackets.query.order_by(Brackets.name).all()
    return jsonify({
        "success": True,
        "brackets": [
            {"id": b.id, "name": b.name, "description": b.description, "type": b.type}
            for b in brackets
        ],
    })
