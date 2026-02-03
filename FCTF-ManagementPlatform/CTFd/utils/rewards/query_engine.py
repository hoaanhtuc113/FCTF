from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Tuple

from sqlalchemy import text

from CTFd.models import db


ALLOWED_ENTITIES = {"team", "user", "solve"}
ALLOWED_METRICS = {
    "TEAM_TOTAL_SCORE",
    "TEAM_RANK",
    "TEAM_SOLVED_COUNT",
    "TEAM_FASTEST_SOLVE",
    "TEAM_AVG_SOLVE_TIME",
    "FIRST_BLOOD",
    "TEAM_FIRST_BLOOD_COUNT",
    "WRONG_SUBMISSION_COUNT",
    "CLEAN_SOLVE",
}

FILTER_FIELDS = {
    "category",
    "rank",
    "solved_count",
    "wrong_count",
    "solve_time",
    "first_blood",
    "hint_used",
}

FILTER_OPERATORS = {
    "=",
    "IN",
    "<=",
    ">=",
    "<",
    ">",
}

ORDER_FIELDS = {"entity_id", "entity_name", "metric_value"}
ORDER_DIRECTIONS = {"asc", "desc"}


@dataclass(frozen=True)
class FilterSpec:
    field: str
    operator: str
    value: Any


@dataclass(frozen=True)
class QuerySpec:
    rule: str
    entity: str
    metric: str
    filters: List[FilterSpec]
    limit: int
    order: Dict[str, str]


class QuerySpecError(ValueError):
    pass


def _parse_filters(filters: Iterable[Dict[str, Any]]) -> List[FilterSpec]:
    parsed = []
    for f in filters:
        field = f.get("field")
        operator = f.get("operator")
        value = f.get("value")

        if field not in FILTER_FIELDS:
            raise QuerySpecError(f"Invalid filter field: {field}")
        if operator not in FILTER_OPERATORS:
            raise QuerySpecError(f"Invalid filter operator: {operator}")
        if operator == "IN" and not isinstance(value, list):
            raise QuerySpecError("IN operator requires a list value")
        parsed.append(FilterSpec(field=field, operator=operator, value=value))
    return parsed


def validate_query_spec(payload: Dict[str, Any]) -> QuerySpec:
    rule = payload.get("rule")
    entity = payload.get("entity")
    metric = payload.get("metric")
    filters = payload.get("filters", [])
    limit = payload.get("limit", 500)
    order = payload.get("order", {})

    if not rule or not isinstance(rule, str):
        raise QuerySpecError("Missing or invalid rule")
    if entity not in ALLOWED_ENTITIES:
        raise QuerySpecError(f"Invalid entity: {entity}")
    if metric not in ALLOWED_METRICS:
        raise QuerySpecError(f"Invalid metric: {metric}")
    if not isinstance(filters, list):
        raise QuerySpecError("filters must be a list")
    if not isinstance(limit, int) or limit <= 0:
        raise QuerySpecError("limit must be a positive integer")

    order_field = order.get("field")
    order_dir = order.get("direction", "asc")
    if order_field is not None and order_field not in ORDER_FIELDS:
        raise QuerySpecError(f"Invalid order field: {order_field}")
    if order_dir not in ORDER_DIRECTIONS:
        raise QuerySpecError(f"Invalid order direction: {order_dir}")

    parsed_filters = _parse_filters(filters)

    return QuerySpec(
        rule=rule,
        entity=entity,
        metric=metric,
        filters=parsed_filters,
        limit=limit,
        order=order,
    )


def compile_query(spec: QuerySpec) -> Tuple[str, Dict[str, Any]]:
    metric = spec.metric
    entity = spec.entity

    if entity == "solve" and metric not in {"FIRST_BLOOD", "CLEAN_SOLVE", "WRONG_SUBMISSION_COUNT"}:
        raise QuerySpecError(f"Metric {metric} is not supported for solve entities")
    if entity in {"team", "user"} and metric in {"FIRST_BLOOD", "CLEAN_SOLVE"}:
        raise QuerySpecError(f"Metric {metric} is not supported for {entity} entities")

    params: Dict[str, Any] = {}
    base_conditions = []
    agg_conditions = []
    rank_conditions = []

    for idx, f in enumerate(spec.filters):
        key = f"param_{idx}"
        if f.field == "category":
            if f.operator == "IN":
                placeholders = []
                for j, v in enumerate(f.value):
                    p = f"{key}_{j}"
                    params[p] = v
                    placeholders.append(f":{p}")
                base_conditions.append(f"sf.category IN ({', '.join(placeholders)})")
            else:
                params[key] = f.value
                base_conditions.append(f"sf.category {f.operator} :{key}")
        elif f.field == "solve_time":
            params[key] = f.value
            base_conditions.append(f"sf.solve_time {f.operator} :{key}")
        elif f.field == "first_blood":
            params[key] = bool(f.value)
            base_conditions.append(f"sf.is_first_blood = :{key}")
        elif f.field == "hint_used":
            params[key] = bool(f.value)
            base_conditions.append(f"sf.hint_used = :{key}")
        elif f.field == "solved_count":
            params[key] = f.value
            agg_conditions.append(f"solved_count {f.operator} :{key}")
        elif f.field == "wrong_count":
            params[key] = f.value
            if entity == "solve":
                agg_conditions.append(f"wrong_before {f.operator} :{key}")
            else:
                agg_conditions.append(f"wrong_count {f.operator} :{key}")
        elif f.field == "rank":
            if entity not in {"team", "user"}:
                raise QuerySpecError("rank filter only supported for team or user entities")
            params[key] = f.value
            rank_conditions.append(f"rank {f.operator} :{key}")

    base_where = "" if not base_conditions else "WHERE " + " AND ".join(base_conditions)
    final_conditions = []
    final_conditions.extend(rank_conditions)
    final_conditions.extend(agg_conditions)
    final_where = "" if not final_conditions else "WHERE " + " AND ".join(final_conditions)

    order_clause = "ORDER BY entity_id ASC"
    if spec.order.get("field"):
        direction = spec.order.get("direction", "asc")
        order_clause = f"ORDER BY {spec.order['field']} {direction.upper()}, entity_id ASC"

    params["limit"] = spec.limit

    dialect = db.engine.dialect.name if db.engine else "postgresql"
    if dialect in {"mysql", "mariadb"}:
        solve_time_expr = "UNIX_TIMESTAMP(s.date)"
    else:
        solve_time_expr = "EXTRACT(EPOCH FROM s.date)"

    base_ctes = f"""
WITH base_solves AS (
    SELECT
        s.id AS solve_id,
        s.team_id,
        s.user_id,
        s.challenge_id,
        s.date AS solve_date,
        c.value AS challenge_value,
        c.category AS category,
        c.name AS challenge_name,
        {solve_time_expr} AS solve_time
    FROM submissions s
    JOIN solves sol ON sol.id = s.id
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.type = 'correct'
),
first_bloods AS (
    SELECT challenge_id, MIN(solve_date) AS first_blood_date
    FROM base_solves
    GROUP BY challenge_id
),
hint_usage AS (
    SELECT u.team_id, u.user_id, h.challenge_id
    FROM unlocks u
    JOIN hints h ON h.id = u.target
    WHERE u.type = 'hints'
    GROUP BY u.team_id, u.user_id, h.challenge_id
),
solves_enriched AS (
    SELECT
        b.*,
        (b.solve_date = fb.first_blood_date) AS is_first_blood,
        CASE WHEN hu.challenge_id IS NULL THEN FALSE ELSE TRUE END AS hint_used
    FROM base_solves b
    LEFT JOIN first_bloods fb ON fb.challenge_id = b.challenge_id
    LEFT JOIN hint_usage hu
        ON hu.challenge_id = b.challenge_id
        AND (hu.team_id = b.team_id OR hu.user_id = b.user_id)
),
solves_filtered AS (
    SELECT *
    FROM solves_enriched sf
    {base_where}
),
wrong_team AS (
    SELECT team_id, COUNT(*) AS wrong_count
    FROM submissions
    WHERE type = 'incorrect'
    GROUP BY team_id
),
wrong_user AS (
    SELECT user_id, COUNT(*) AS wrong_count
    FROM submissions
    WHERE type = 'incorrect'
    GROUP BY user_id
),
wrong_before AS (
    SELECT
        s.id AS solve_id,
        COUNT(w.id) AS wrong_before
    FROM submissions s
    JOIN solves sol ON sol.id = s.id
    LEFT JOIN submissions w
        ON w.challenge_id = s.challenge_id
        AND w.type = 'incorrect'
        AND w.date < s.date
        AND (w.team_id = s.team_id OR w.user_id = s.user_id)
    GROUP BY s.id
)
"""

    if entity == "team":
        metric_expr = {
            "TEAM_TOTAL_SCORE": "total_score",
            "TEAM_RANK": "rank",
            "TEAM_SOLVED_COUNT": "solved_count",
            "TEAM_FASTEST_SOLVE": "fastest_solve",
            "TEAM_AVG_SOLVE_TIME": "avg_solve_time",
            "TEAM_FIRST_BLOOD_COUNT": "first_blood_count",
            "WRONG_SUBMISSION_COUNT": "wrong_count",
        }[metric]

        sql = f"""
{base_ctes},
team_agg AS (
    SELECT
        t.id AS entity_id,
        t.name AS entity_name,
        COUNT(sf.solve_id) AS solved_count,
        COALESCE(SUM(sf.challenge_value), 0) AS total_score,
        MIN(sf.solve_time) AS fastest_solve,
        AVG(sf.solve_time) AS avg_solve_time,
        COALESCE(SUM(CASE WHEN sf.is_first_blood THEN 1 ELSE 0 END), 0) AS first_blood_count,
        COALESCE(wt.wrong_count, 0) AS wrong_count,
        MAX(sf.solve_date) AS last_solve_date
    FROM teams t
    LEFT JOIN solves_filtered sf ON sf.team_id = t.id
    LEFT JOIN wrong_team wt ON wt.team_id = t.id
    GROUP BY t.id, t.name, wt.wrong_count
),
ranked AS (
    SELECT
        ta.*,
        RANK() OVER (ORDER BY ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC) AS rank
    FROM team_agg ta
)
SELECT entity_id, entity_name, {metric_expr} AS metric_value
FROM ranked
{final_where}
{order_clause}
LIMIT :limit
"""
        return sql, params

    if entity == "user":
        metric_expr = {
            "TEAM_TOTAL_SCORE": "total_score",
            "TEAM_RANK": "rank",
            "TEAM_SOLVED_COUNT": "solved_count",
            "TEAM_FASTEST_SOLVE": "fastest_solve",
            "TEAM_AVG_SOLVE_TIME": "avg_solve_time",
            "TEAM_FIRST_BLOOD_COUNT": "first_blood_count",
            "WRONG_SUBMISSION_COUNT": "wrong_count",
        }[metric]

        sql = f"""
{base_ctes},
user_agg AS (
    SELECT
        u.id AS entity_id,
        u.name AS entity_name,
        COUNT(sf.solve_id) AS solved_count,
        COALESCE(SUM(sf.challenge_value), 0) AS total_score,
        MIN(sf.solve_time) AS fastest_solve,
        AVG(sf.solve_time) AS avg_solve_time,
        COALESCE(SUM(CASE WHEN sf.is_first_blood THEN 1 ELSE 0 END), 0) AS first_blood_count,
        COALESCE(wu.wrong_count, 0) AS wrong_count,
        MAX(sf.solve_date) AS last_solve_date
    FROM users u
    LEFT JOIN solves_filtered sf ON sf.user_id = u.id
    LEFT JOIN wrong_user wu ON wu.user_id = u.id
    GROUP BY u.id, u.name, wu.wrong_count
),
ranked AS (
    SELECT
        ua.*,
        RANK() OVER (ORDER BY ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC) AS rank
    FROM user_agg ua
)
SELECT entity_id, entity_name, {metric_expr} AS metric_value
FROM ranked
{final_where}
{order_clause}
LIMIT :limit
"""
        return sql, params

    metric_expr = {
        "FIRST_BLOOD": "CASE WHEN sf.is_first_blood THEN 1 ELSE 0 END",
        "CLEAN_SOLVE": "CASE WHEN COALESCE(wb.wrong_before, 0) = 0 THEN 1 ELSE 0 END",
        "WRONG_SUBMISSION_COUNT": "COALESCE(wb.wrong_before, 0)",
    }[metric]

    sql = f"""
{base_ctes},
solve_rows AS (
    SELECT
        sf.solve_id AS entity_id,
        sf.challenge_name AS entity_name,
        sf.solve_time,
        sf.is_first_blood,
        sf.hint_used,
        COALESCE(wb.wrong_before, 0) AS wrong_before
    FROM solves_filtered sf
    LEFT JOIN wrong_before wb ON wb.solve_id = sf.solve_id
)
SELECT entity_id, entity_name, {metric_expr} AS metric_value
FROM solve_rows
{final_where}
{order_clause}
LIMIT :limit
"""
    return sql, params


def execute_query(spec: QuerySpec) -> Dict[str, Any]:
    sql, params = compile_query(spec)
    rows = db.session.execute(text(sql), params).fetchall()

    result_rows = []
    for row in rows:
        result_rows.append(
            {
                "entity_id": row.entity_id,
                "entity_name": row.entity_name,
                "metric_value": row.metric_value,
            }
        )

    return {
        "rule": spec.rule,
        "generated_sql": sql.strip(),
        "result": result_rows,
    }
