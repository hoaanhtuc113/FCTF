import re

from flask import jsonify, request, render_template

from CTFd.admin import admin
from CTFd.models import Brackets, Challenges, ContestParticipant, Contests, Teams, db
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


class ContestScopeError(Exception):
    """Raised when the request does not name a contest the caller may read."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _require_contest_scope():
    """Resolve the contest a reward request runs against, and authorize it.

    These endpoints take contest_id from the request rather than the URL, so
    the /admin/contests/<id> path guards never see them. That left contest_id
    as an unchecked client-supplied number: omit it and the query ran across
    every contest on the platform, set someone else's and it ran against
    theirs. Both are refused here.

    Authorization reuses is_jury_for_contest — same rule the rest of the
    admin already scopes jury access by (platform admin/legacy jury bypass,
    everyone else needs a jury ContestParticipant row for this contest_id) —
    rather than a second, easily-diverging copy of it.
    """
    from CTFd.utils.user import is_conductor, is_jury_for_contest, get_current_user_attrs

    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        raw = payload.get("contest_id")
    else:
        raw = request.args.get("contest_id")

    if raw is None or raw == "":
        raise ContestScopeError("contest_id is required")

    try:
        contest_id = int(raw)
    except (TypeError, ValueError):
        raise ContestScopeError("contest_id must be an integer")

    if is_jury_for_contest(contest_id):
        return contest_id

    if is_conductor():
        user = get_current_user_attrs()
        contest = Contests.query.filter_by(id=contest_id).first()
        if user is not None and contest is not None and contest.owner_id == user.id:
            return contest_id

    raise ContestScopeError("You do not have access to this contest", status=403)


@admin.route("/admin/rewards/query", methods=["POST"])
@admin_or_jury
def rewards_query():
    """Legacy endpoint for raw query execution."""
    payload = request.get_json() or {}
    try:
        contest_id = _require_contest_scope()
        # The scope is re-stamped from the authorized value so a client cannot
        # smuggle a different contest through the rest of the payload.
        spec = validate_query_spec({**payload, "contest_id": contest_id})
        response = execute_query(spec)
        return jsonify(response)
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status
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
        contest_id = _require_contest_scope()
        query_config = build_query_from_template(template_id, params, contest_id=contest_id)
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
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status
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

    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

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
        executor = MultiCriteriaExecutor(query, contest_id=contest_id)
        result = executor.execute()
        result["success"] = True
        return jsonify(result)
    except Exception as exc:
        return jsonify({"success": False, "error": f"Execution error: {str(exc)}"}), 500


@admin.route("/admin/rewards", methods=["GET"])
@admin_or_jury
def rewards_page():
    """Standalone reward query page — not embedded in a single contest's
    admin area, so (unlike dynamic_reward.html) it has no contest handed to
    it by the URL. It has to ask the user which contest to query, from the
    same set is_jury_for_contest would allow (this route's own decorator
    already excludes anyone who isn't platform admin, legacy platform jury,
    or jury on at least one contest), or the page has nothing to scope its
    queries to.
    """
    from CTFd.utils.user import get_current_user_attrs

    user = get_current_user_attrs()
    if user is not None and user.type in ("admin", "jury"):
        contests = Contests.query.order_by(Contests.name).all()
    elif user is not None:
        contest_ids = (
            db.session.query(ContestParticipant.contest_id)
            .filter_by(user_id=user.id, role="jury")
            .subquery()
        )
        contests = (
            Contests.query.filter(Contests.id.in_(contest_ids))
            .order_by(Contests.name)
            .all()
        )
    else:
        contests = []

    return render_template("admin/rewards.html", contests=contests)


@admin.route("/admin/rewards/details", methods=["POST"])
@admin_or_jury
def rewards_details():
    """Return solved challenges for a specific team, used by expandable rows."""
    from sqlalchemy import text as sa_text

    def _serialize_utc_datetime(value):
        if value is None:
            return None

        if hasattr(value, "isoformat") and not isinstance(value, str):
            raw = value.isoformat()
        else:
            raw = str(value).strip()

        if not raw:
            return None

        normalized = raw.replace(" ", "T")
        if re.search(r"(?:Z|[+-]\d{2}(?::?\d{2})?)$", normalized, re.IGNORECASE):
            return normalized

        return f"{normalized}Z"

    payload = request.get_json() or {}
    template_id = payload.get("template_id", "")
    entity_id = payload.get("entity_id")

    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

    if not entity_id:
        return jsonify({"success": False, "error": "entity_id is required"}), 400

    entity_id = int(entity_id)

    # The team has to belong to the contest being asked about, otherwise the
    # detail rows for any team on the platform are one team id away.
    team = Teams.query.filter_by(id=entity_id, contest_id=contest_id).first()
    if team is None:
        return jsonify({"success": False, "error": "Team not found in this contest"}), 404

    # Always filter by team
    filter_col = "s.team_id"

    contest_ch_where = " AND ch.contest_id = :contest_id"
    contest_cat_where = " WHERE ch.contest_id = :contest_id"
    base_params: dict = {"entity_id": entity_id, "contest_id": contest_id}

    # Build extra conditions based on the template type
    extra_join = ""
    extra_where = ""

    if template_id == "category_masters":
        sql = f"""
            SELECT
                sf.category,
                COUNT(DISTINCT sf.challenge_id) AS solved_count,
                ct.total_challenges,
                MAX(sf.solve_date) AS full_clear_date
            FROM (
                SELECT s.id AS solve_id, ch.id AS challenge_id,
                       ch.name AS challenge_name, ch.category,
                       ch.value AS challenge_value, s.date AS solve_date
                FROM submissions s
                JOIN solves sol ON sol.id = s.id
                JOIN challenges ch ON ch.id = s.challenge_id
                WHERE s.type = 'correct' AND s.team_id = :entity_id{contest_ch_where}
            ) sf
            JOIN (
                SELECT ch.category, COUNT(*) AS total_challenges
                FROM challenges ch{contest_cat_where}
                GROUP BY ch.category
            ) ct ON ct.category = sf.category
            GROUP BY sf.category, ct.total_challenges
            HAVING COUNT(DISTINCT sf.challenge_id) >= ct.total_challenges
            ORDER BY full_clear_date ASC
        """
        rows = db.session.execute(sa_text(sql), base_params).fetchall()
        details = []
        for row in rows:
            details.append({
                "category": row.category,
                "solved_count": row.solved_count,
                "total_challenges": row.total_challenges,
                "full_clear_date": _serialize_utc_datetime(row.full_clear_date),
            })
        return jsonify({"success": True, "details": details, "detail_type": "category_clear"})

    if template_id == "first_blood_hunters":
        # First blood is decided among this contest's solves only — the
        # unscoped version let an earlier solve of a same-id challenge in
        # another contest decide who drew first blood here.
        extra_join = """
            JOIN (
                SELECT sub.challenge_id, MIN(sub.date) AS fb_date
                FROM submissions sub
                JOIN challenges fbch ON fbch.id = sub.challenge_id
                WHERE sub.type = 'correct' AND fbch.contest_id = :contest_id
                GROUP BY sub.challenge_id
            ) fb ON fb.challenge_id = s.challenge_id AND fb.fb_date = s.date
        """
    elif template_id == "perfect_solvers":
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
        extra_where = """
            AND NOT EXISTS (
                SELECT 1 FROM unlocks u
                JOIN hints h ON h.id = u.hint_id
                WHERE u.type = 'hints'
                AND h.challenge_id = s.challenge_id
                AND u.team_id = :entity_id
            )
        """

    sql = f"""
        SELECT
            ch.id AS challenge_id,
            ch.name AS challenge_name,
            ch.category,
            ch.value AS score,
            s.date AS solve_date
        FROM submissions s
        JOIN solves sol ON sol.id = s.id
        JOIN challenges ch ON ch.id = s.challenge_id
        {extra_join}
        WHERE s.type = 'correct'
        AND {filter_col} = :entity_id{contest_ch_where}
        {extra_where}
        ORDER BY ch.category, ch.name
    """

    rows = db.session.execute(sa_text(sql), base_params).fetchall()

    details = []
    for row in rows:
        details.append({
            "challenge_id": row.challenge_id,
            "challenge_name": row.challenge_name,
            "category": row.category,
            "score": row.score,
            "solve_date": _serialize_utc_datetime(row.solve_date),
        })

    return jsonify({"success": True, "details": details})


@admin.route("/admin/rewards/categories", methods=["GET"])
@bypass_csrf_protection
@admin_or_jury
def rewards_categories():
    """Get this contest's challenge categories."""
    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

    categories = (
        db.session.query(Challenges.category)
        .filter(Challenges.contest_id == contest_id)
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
    """Get this contest's challenges, optionally filtered by search term."""
    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

    search = request.args.get("search", "").strip()
    q = Challenges.query.filter(Challenges.contest_id == contest_id)
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
    """Get this contest's teams, optionally filtered by search term."""
    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

    search = request.args.get("search", "").strip()
    q = Teams.query.filter(Teams.contest_id == contest_id)
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
    """Get this contest's brackets."""
    try:
        contest_id = _require_contest_scope()
    except ContestScopeError as exc:
        return jsonify({"success": False, "error": exc.message}), exc.status

    brackets = (
        Brackets.query
        .filter(Brackets.contest_id == contest_id)
        .order_by(Brackets.name)
        .all()
    )
    return jsonify({
        "success": True,
        "brackets": [
            {"id": b.id, "name": b.name, "description": b.description, "type": b.type}
            for b in brackets
        ],
    })
