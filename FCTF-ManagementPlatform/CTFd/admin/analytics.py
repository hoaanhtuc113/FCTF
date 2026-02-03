from flask import render_template, request, jsonify
from sqlalchemy import func, and_, or_

from CTFd.admin import admin
from CTFd.models import db, Submissions, Users, Teams, Challenges
from CTFd.utils.decorators import admin_or_jury
from CTFd.plugins import bypass_csrf_protection


@admin.route("/admin/analytics", methods=["GET"])
@admin_or_jury
def analytics():
    """Competition Analytics page with custom query endpoint."""
    return render_template("admin/analytics.html")


@admin.route("/admin/analytics/query", methods=["POST"])
@bypass_csrf_protection
@admin_or_jury
def analytics_query():
    """
    Dynamic analytics query endpoint for Submissions.
    Supports two modes:
    1. Regular: Accepts JSON with: mode, fields, filters, sort, limit
    2. Aggregation: Accepts JSON with: mode, groupBy, metric, target, filters, sort, limit
    """
    data = request.get_json()
    
    # Extract query mode
    mode = data.get("mode", "regular")
    
    if mode == "aggregation":
        return handle_aggregation_query(data)
    else:
        return handle_regular_query(data)


def handle_regular_query(data):
    """Handle regular query mode."""
    # Extract query parameters
    selected_fields = data.get("fields", [])
    filters = data.get("filters", [])
    sort_by = data.get("sort", {})
    limit = data.get("limit", 1000)
    
    try:
        # Map field names to SQLAlchemy columns
        field_map = {
            "submission_id": Submissions.id,
            "user_id": Submissions.user_id,
            "team_id": Submissions.team_id,
            "user_name": Users.name,
            "team_name": Teams.name,
            "challenge_id": Submissions.challenge_id,
            "challenge_name": Challenges.name,
            "category": Challenges.category,
            "point": Challenges.value,
            "type": Submissions.type,
            "date": Submissions.date
        }
        
        # Determine which tables need to be joined based on selected fields
        need_user_join = any(f in selected_fields for f in ["user_name"])
        need_team_join = any(f in selected_fields for f in ["team_name"])
        need_challenge_join = any(f in selected_fields for f in ["challenge_id", "challenge_name", "category", "point"])
        
        # Check if filters require joins
        for f in filters:
            field_name = f.get("field")
            if field_name in ["user_name"]:
                need_user_join = True
            elif field_name in ["team_name"]:
                need_team_join = True
            elif field_name in ["challenge_id", "challenge_name", "category", "point"]:
                need_challenge_join = True
        
        # Build select fields dynamically from selected_fields
        select_fields = []
        for field_name in selected_fields:
            if field_name in field_map:
                select_fields.append(field_map[field_name].label(field_name))
        
        # Build base query with only selected fields
        if not select_fields:
            # If no fields selected, default to basic query (for aggregates)
            query = db.session.query(Submissions.id.label("submission_id")).select_from(Submissions)
        else:
            query = db.session.query(*select_fields).select_from(Submissions)
        
        # Apply joins only if needed
        if need_user_join:
            query = query.join(Users, Submissions.user_id == Users.id)
        if need_team_join:
            query = query.outerjoin(Teams, Submissions.team_id == Teams.id)
        if need_challenge_join:
            query = query.join(Challenges, Submissions.challenge_id == Challenges.id)
        
        # Apply filters
        for f in filters:
            field_name = f.get("field")
            operator = f.get("operator")
            value = f.get("value")
            
            if field_name not in field_map:
                continue
                
            column = field_map[field_name]
            
            # Apply operator
            if operator == "=":
                query = query.filter(column == value)
            elif operator == ">":
                query = query.filter(column > value)
            elif operator == "<":
                query = query.filter(column < value)
            elif operator == ">=":
                query = query.filter(column >= value)
            elif operator == "<=":
                query = query.filter(column <= value)
            elif operator == "contains":
                query = query.filter(column.ilike(f"%{value}%"))
        
        # Apply sorting
        if sort_by:
            sort_field = sort_by.get("field")
            sort_order = sort_by.get("order", "asc")
            
            if sort_field in field_map:
                column = field_map[sort_field]
                if sort_order == "desc":
                    query = query.order_by(column.desc())
                else:
                    query = query.order_by(column.asc())
        
        # Apply limit
        query = query.limit(limit)
        
        # Execute query
        results = query.all()
        
        # Convert to list of dicts
        data_list = []
        for row in results:
            row_dict = {}
            for key, value in row._mapping.items():
                if hasattr(value, 'isoformat'):
                    row_dict[key] = value.isoformat()
                else:
                    row_dict[key] = value
            data_list.append(row_dict)
        
        return jsonify({
            "success": True,
            "data": data_list,
            "count": len(data_list)
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


def handle_aggregation_query(data):
    """Handle aggregation query mode with GROUP BY."""
    # Extract query parameters
    group_by_fields = data.get("groupBy", [])
    metric = data.get("metric", "count")
    target = data.get("target", "submission_id")
    filters = data.get("filters", [])
    sort_by = data.get("sort", {})
    limit = data.get("limit")  # Can be None for unlimited
    
    try:
        # Map field names to SQLAlchemy columns
        field_map = {
            "submission_id": Submissions.id,
            "user_id": Submissions.user_id,
            "team_id": Submissions.team_id,
            "user_name": Users.name,
            "team_name": Teams.name,
            "challenge_id": Submissions.challenge_id,
            "challenge_name": Challenges.name,
            "category": Challenges.category,
            "point": Challenges.value,
            "type": Submissions.type,
            "date": Submissions.date
        }
        
        # Determine which tables need to be joined based on group by fields
        need_user_join = any(f in group_by_fields for f in ["user_id", "user_name"])
        need_team_join = any(f in group_by_fields for f in ["team_id", "team_name"])
        need_challenge_join = any(f in group_by_fields for f in ["challenge_id", "challenge_name", "category", "point"])
        
        # Check if target field requires joins
        if target in ["user_name"]:
            need_user_join = True
        elif target in ["team_name"]:
            need_team_join = True
        elif target in ["challenge_id", "challenge_name", "category", "point"]:
            need_challenge_join = True
        
        # Check if filters require joins
        for f in filters:
            field_name = f.get("field")
            if field_name in ["user_name"]:
                need_user_join = True
            elif field_name in ["team_name"]:
                need_team_join = True
            elif field_name in ["challenge_id", "challenge_name", "category", "point"]:
                need_challenge_join = True
        
        # Build GROUP BY fields
        group_fields = []
        for field_name in group_by_fields:
            if field_name in field_map:
                group_fields.append(field_map[field_name].label(field_name))
        
        if not group_fields:
            return jsonify({
                "success": False,
                "error": "No valid GROUP BY fields provided"
            }), 400
        
        # Build aggregate function
        target_column = field_map.get(target, Submissions.id)
        
        if metric == "count":
            agg_func = func.count(target_column).label("metric_value")
        elif metric == "sum":
            agg_func = func.sum(target_column).label("metric_value")
        elif metric == "avg":
            agg_func = func.avg(target_column).label("metric_value")
        elif metric == "min":
            agg_func = func.min(target_column).label("metric_value")
        elif metric == "max":
            agg_func = func.max(target_column).label("metric_value")
        else:
            return jsonify({
                "success": False,
                "error": f"Invalid metric: {metric}"
            }), 400
        
        # Build query with GROUP BY
        query = db.session.query(*group_fields, agg_func).select_from(Submissions)
        
        # Apply joins only if needed
        if need_user_join:
            query = query.join(Users, Submissions.user_id == Users.id)
        if need_team_join:
            query = query.outerjoin(Teams, Submissions.team_id == Teams.id)
        if need_challenge_join:
            query = query.join(Challenges, Submissions.challenge_id == Challenges.id)
        
        # Apply filters
        for f in filters:
            field_name = f.get("field")
            operator = f.get("operator")
            value = f.get("value")
            
            if field_name not in field_map:
                continue
                
            column = field_map[field_name]
            
            # Apply operator
            if operator == "=":
                query = query.filter(column == value)
            elif operator == ">":
                query = query.filter(column > value)
            elif operator == "<":
                query = query.filter(column < value)
            elif operator == ">=":
                query = query.filter(column >= value)
            elif operator == "<=":
                query = query.filter(column <= value)
            elif operator == "contains":
                query = query.filter(column.ilike(f"%{value}%"))
        
        # Apply GROUP BY
        for field in group_fields:
            query = query.group_by(field)
        
        # Apply sorting
        if sort_by:
            sort_field = sort_by.get("field")
            sort_order = sort_by.get("order", "asc")
            
            # Validate: can only sort by group fields or metric_value
            if sort_field == "metric_value":
                if sort_order == "desc":
                    query = query.order_by(agg_func.desc())
                else:
                    query = query.order_by(agg_func.asc())
            elif sort_field in group_by_fields:
                # Only allow sorting by fields in GROUP BY
                column = field_map.get(sort_field)
                if column is not None:
                    if sort_order == "desc":
                        query = query.order_by(column.desc())
                    else:
                        query = query.order_by(column.asc())
            # else: ignore invalid sort field (not in GROUP BY)
        
        # Apply limit only if specified
        if limit is not None:
            query = query.limit(limit)
        
        # Execute query
        results = query.all()
        
        # Convert to list of dicts
        data_list = []
        for row in results:
            row_dict = {}
            for key, value in row._mapping.items():
                if hasattr(value, 'isoformat'):
                    row_dict[key] = value.isoformat()
                else:
                    row_dict[key] = value
            data_list.append(row_dict)
        
        return jsonify({
            "success": True,
            "data": data_list,
            "count": len(data_list)
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
