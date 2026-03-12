from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Tuple

from sqlalchemy import inspect, text

from CTFd.models import db


ALLOWED_ENTITIES = {"team", "user", "solve"}
ALLOWED_METRICS = {
    "TEAM_TOTAL_SCORE",
    "TEAM_SOLVED_COUNT",
    "FIRST_BLOOD",
    "TEAM_FIRST_BLOOD_COUNT",
    "WRONG_SUBMISSION_COUNT",
    "TEAM_CATEGORY_CLEAR_COUNT",
    "TEAM_PERFECT_SOLVE_COUNT",
}

FILTER_FIELDS = {
    "category",
    "rank",
    "solved_count",
    "wrong_count",
    "solve_time",
    "first_blood",
    "hint_used",
    "total_score",
    "first_blood_count",
    "category_clear_count",
    "team_id",
    "challenge_id",
    "bracket_id",
    "full_clear_category",
    "first_clear_each_category",
}

FILTER_OPERATORS = {
    "=",
    "IN",
    "<=",
    ">=",
    "<",
    ">",
}

ORDER_FIELDS = {"entity_id", "entity_name", "metric_value", "last_solve_date"}
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


@lru_cache(maxsize=128)
def _table_columns(table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    return {col["name"] for col in inspector.get_columns(table_name)}


def _require_columns(table_name: str, columns: Iterable[str]) -> None:
    existing = _table_columns(table_name)
    missing = [col for col in columns if col not in existing]
    if missing:
        raise QuerySpecError(
            f"Schema mismatch: missing columns in {table_name}: {', '.join(missing)}"
        )


def _assert_schema(entity: str) -> None:
    _require_columns(
        "submissions",
        ["id", "team_id", "user_id", "challenge_id", "date", "type"],
    )
    _require_columns("solves", ["id"])
    _require_columns("challenges", ["id", "value", "category", "name"])
    _require_columns("unlocks", ["team_id", "user_id", "target", "type"])
    _require_columns("hints", ["id", "challenge_id"])
    _require_columns("awards", ["id", "team_id", "user_id", "value", "date"])

    if entity == "team":
        _require_columns("teams", ["id", "name"])
    if entity == "user":
        _require_columns("users", ["id", "name"])


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

    _assert_schema(entity)

    if entity == "solve" and metric not in {"FIRST_BLOOD", "WRONG_SUBMISSION_COUNT"}:
        raise QuerySpecError(f"Metric {metric} is not supported for solve entities")
    if entity in {"team", "user"} and metric in {"FIRST_BLOOD"}:
        raise QuerySpecError(f"Metric {metric} is not supported for {entity} entities")

    params: Dict[str, Any] = {}
    base_conditions = []
    agg_conditions = []
    rank_conditions = []
    bracket_filter = None
    full_clear_category = None
    first_clear_each_category = False

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
        elif f.field == "total_score":
            params[key] = f.value
            agg_conditions.append(f"total_score {f.operator} :{key}")
        elif f.field == "first_blood_count":
            params[key] = f.value
            agg_conditions.append(f"first_blood_count {f.operator} :{key}")
        elif f.field == "category_clear_count":
            params[key] = f.value
            agg_conditions.append(f"category_clear_count {f.operator} :{key}")
        elif f.field == "team_id":
            params[key] = int(f.value)
            base_conditions.append(f"sf.team_id = :{key}")
        elif f.field == "challenge_id":
            if f.operator == "IN":
                placeholders = []
                for j, v in enumerate(f.value):
                    p = f"{key}_{j}"
                    params[p] = int(v)
                    placeholders.append(f":{p}")
                base_conditions.append(f"sf.challenge_id IN ({', '.join(placeholders)})")
            else:
                params[key] = int(f.value)
                base_conditions.append(f"sf.challenge_id {f.operator} :{key}")
        elif f.field == "bracket_id":
            params[key] = int(f.value)
            bracket_filter = f":{key}"
        elif f.field == "full_clear_category":
            params[key] = f.value
            full_clear_category = f.value
            agg_conditions.append("full_clear_pass = 1")
        elif f.field == "first_clear_each_category":
            first_clear_each_category = bool(f.value)

    base_where = "" if not base_conditions else "WHERE " + " AND ".join(base_conditions)
    final_conditions = []
    final_conditions.extend(rank_conditions)
    final_conditions.extend(agg_conditions)

    # Hide entities that do not satisfy the selected metric at all.
    # This prevents zero-value rows (e.g., no no-hint solves) from appearing.
    if entity in {"team", "user"}:
        metric_non_zero_conditions = {
            "TEAM_TOTAL_SCORE": "total_score > 0",
            "TEAM_SOLVED_COUNT": "solved_count > 0",
            "TEAM_FIRST_BLOOD_COUNT": "first_blood_count > 0",
            "WRONG_SUBMISSION_COUNT": "wrong_count > 0",
            "TEAM_CATEGORY_CLEAR_COUNT": "category_clear_count > 0",
            "TEAM_PERFECT_SOLVE_COUNT": "perfect_solve_count > 0",
        }
        metric_condition = metric_non_zero_conditions.get(metric)
        if metric_condition:
            final_conditions.append(metric_condition)

    final_where = "" if not final_conditions else "WHERE " + " AND ".join(final_conditions)

    order_clause = "ORDER BY entity_id ASC"
    if spec.order.get("field"):
        direction = spec.order.get("direction", "asc")
        order_clause = f"ORDER BY {spec.order['field']} {direction.upper()}, entity_id ASC"

    # Team/user queries compute rank in SQL; always sort by rank for consistent display.
    ranked_order_clause = "ORDER BY rank ASC, entity_id ASC"

    params["limit"] = spec.limit
    params["full_clear_category"] = full_clear_category

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
category_totals AS (
    SELECT c.category, COUNT(DISTINCT c.id) AS total_challenges
    FROM challenges c
    GROUP BY c.category
),
team_awards AS (
    SELECT team_id, COALESCE(SUM(value), 0) AS award_value
    FROM awards
    WHERE team_id IS NOT NULL AND value != 0
    GROUP BY team_id
),
user_awards AS (
    SELECT user_id, COALESCE(SUM(value), 0) AS award_value
    FROM awards
    WHERE user_id IS NOT NULL AND value != 0
    GROUP BY user_id
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
            "TEAM_SOLVED_COUNT": "solved_count",
            "TEAM_FIRST_BLOOD_COUNT": "first_blood_count",
            "WRONG_SUBMISSION_COUNT": "wrong_count",
            "TEAM_CATEGORY_CLEAR_COUNT": "category_clear_count",
            "TEAM_PERFECT_SOLVE_COUNT": "perfect_solve_count",
        }[metric]

        if (
            full_clear_category
            and spec.order.get("field") == "last_solve_date"
            and spec.order.get("direction", "asc") == "asc"
        ):
            rank_order_expr = "ta.category_full_clear_date ASC, ta.entity_id ASC"
        elif metric == "TEAM_TOTAL_SCORE":
            rank_order_expr = "ta.total_score DESC, ta.solved_count DESC, ta.last_solve_date ASC, ta.entity_id ASC"
        elif metric == "TEAM_SOLVED_COUNT":
            rank_order_expr = "ta.solved_count DESC, ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC"
        elif metric == "TEAM_FIRST_BLOOD_COUNT":
            rank_order_expr = "ta.first_blood_count DESC, ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC"
        elif metric == "WRONG_SUBMISSION_COUNT":
            rank_order_expr = "ta.wrong_count DESC, ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC"
        elif metric == "TEAM_CATEGORY_CLEAR_COUNT":
            rank_order_expr = "ta.category_clear_count DESC, ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC"
        else:
            rank_order_expr = "ta.perfect_solve_count DESC, ta.total_score DESC, ta.last_solve_date ASC, ta.entity_id ASC"

        if first_clear_each_category:
            sql = f"""
{base_ctes},
team_category_completion AS (
    SELECT
        t.id AS entity_id,
        t.name AS entity_name,
        sf.category AS category,
        COUNT(DISTINCT sf.challenge_id) AS solved_count,
        MAX(sf.solve_date) AS full_clear_date,
        ct.total_challenges
    FROM teams t
    JOIN solves_filtered sf ON sf.team_id = t.id
    JOIN category_totals ct ON ct.category = sf.category
    {"WHERE t.bracket_id = " + bracket_filter if bracket_filter else ""}
    GROUP BY t.id, t.name, sf.category, ct.total_challenges
    HAVING COUNT(DISTINCT sf.challenge_id) >= ct.total_challenges
),
ranked AS (
    SELECT
        tcc.*,
        RANK() OVER (PARTITION BY tcc.category ORDER BY tcc.full_clear_date ASC, tcc.entity_id ASC) AS rank
    FROM team_category_completion tcc
)
SELECT entity_id, entity_name, category, solved_count AS metric_value, full_clear_date AS last_solve_date, rank
FROM ranked
WHERE rank = 1
ORDER BY category ASC, entity_id ASC
LIMIT :limit
"""
            return sql, params

        sql = f"""
{base_ctes},
team_agg AS (
    SELECT
        t.id AS entity_id,
        t.name AS entity_name,
        COUNT(sf.solve_id) AS solved_count,
        COUNT(DISTINCT CASE WHEN :full_clear_category IS NOT NULL AND sf.category = :full_clear_category THEN sf.challenge_id END) AS category_solved_count,
        COALESCE((SELECT ct.total_challenges FROM category_totals ct WHERE ct.category = :full_clear_category), 0) AS category_total_count,
        MAX(CASE WHEN :full_clear_category IS NOT NULL AND sf.category = :full_clear_category THEN sf.solve_date END) AS category_full_clear_date,
        COALESCE(SUM(sf.challenge_value), 0) + COALESCE(ta.award_value, 0) AS total_score,
        MIN(sf.solve_time) AS fastest_solve,
        AVG(sf.solve_time) AS avg_solve_time,
        COALESCE(SUM(CASE WHEN sf.is_first_blood THEN 1 ELSE 0 END), 0) AS first_blood_count,
        COUNT(DISTINCT sf.category) AS category_clear_count,
        COALESCE(
            SUM(CASE WHEN COALESCE(wb.wrong_before, 0) = 0 THEN 1 ELSE 0 END),
            0
        ) AS perfect_solve_count,
        COALESCE(wt.wrong_count, 0) AS wrong_count,
        MAX(sf.solve_date) AS last_solve_date
    FROM teams t
    LEFT JOIN solves_filtered sf ON sf.team_id = t.id
    LEFT JOIN wrong_team wt ON wt.team_id = t.id
    LEFT JOIN wrong_before wb ON wb.solve_id = sf.solve_id
    LEFT JOIN team_awards ta ON ta.team_id = t.id
    {"WHERE t.bracket_id = " + bracket_filter if bracket_filter else ""}
    GROUP BY t.id, t.name, wt.wrong_count, ta.award_value
),
ranked AS (
    SELECT
        ta.*,
        CASE
            WHEN :full_clear_category IS NULL THEN 1
            WHEN ta.category_total_count > 0 AND ta.category_solved_count >= ta.category_total_count THEN 1
            ELSE 0
        END AS full_clear_pass,
        RANK() OVER (ORDER BY {rank_order_expr}) AS rank
    FROM team_agg ta
)
SELECT entity_id, entity_name, {metric_expr} AS metric_value, COALESCE(category_full_clear_date, last_solve_date) AS last_solve_date, solved_count, rank
FROM ranked
{final_where}
{ranked_order_clause}
LIMIT :limit
"""
        return sql, params

    if entity == "user":
        metric_expr = {
            "TEAM_TOTAL_SCORE": "total_score",
            "TEAM_SOLVED_COUNT": "solved_count",
            "TEAM_FIRST_BLOOD_COUNT": "first_blood_count",
            "WRONG_SUBMISSION_COUNT": "wrong_count",
            "TEAM_CATEGORY_CLEAR_COUNT": "category_clear_count",
            "TEAM_PERFECT_SOLVE_COUNT": "perfect_solve_count",
        }[metric]

        if (
            full_clear_category
            and spec.order.get("field") == "last_solve_date"
            and spec.order.get("direction", "asc") == "asc"
        ):
            rank_order_expr = "ua.category_full_clear_date ASC, ua.entity_id ASC"
        elif metric == "TEAM_TOTAL_SCORE":
            rank_order_expr = "ua.total_score DESC, ua.solved_count DESC, ua.last_solve_date ASC, ua.entity_id ASC"
        elif metric == "TEAM_SOLVED_COUNT":
            rank_order_expr = "ua.solved_count DESC, ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC"
        elif metric == "TEAM_FIRST_BLOOD_COUNT":
            rank_order_expr = "ua.first_blood_count DESC, ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC"
        elif metric == "WRONG_SUBMISSION_COUNT":
            rank_order_expr = "ua.wrong_count DESC, ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC"
        elif metric == "TEAM_CATEGORY_CLEAR_COUNT":
            rank_order_expr = "ua.category_clear_count DESC, ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC"
        else:
            rank_order_expr = "ua.perfect_solve_count DESC, ua.total_score DESC, ua.last_solve_date ASC, ua.entity_id ASC"

        if first_clear_each_category:
            sql = f"""
{base_ctes},
user_category_completion AS (
    SELECT
        u.id AS entity_id,
        u.name AS entity_name,
        u.team_id,
        sf.category AS category,
        COUNT(DISTINCT sf.challenge_id) AS solved_count,
        MAX(sf.solve_date) AS full_clear_date,
        ct.total_challenges
    FROM users u
    JOIN solves_filtered sf ON sf.user_id = u.id
    JOIN category_totals ct ON ct.category = sf.category
    {"WHERE u.bracket_id = " + bracket_filter if bracket_filter else ""}
    GROUP BY u.id, u.name, u.team_id, sf.category, ct.total_challenges
    HAVING COUNT(DISTINCT sf.challenge_id) >= ct.total_challenges
),
ranked AS (
    SELECT
        ucc.*,
        RANK() OVER (PARTITION BY ucc.category ORDER BY ucc.full_clear_date ASC, ucc.entity_id ASC) AS rank
    FROM user_category_completion ucc
)
SELECT entity_id, entity_name, category, solved_count AS metric_value, full_clear_date AS last_solve_date, rank,
       (SELECT t.name FROM teams t WHERE t.id = ranked.team_id) AS team_name
FROM ranked
WHERE rank = 1
ORDER BY category ASC, entity_id ASC
LIMIT :limit
"""
            return sql, params

        sql = f"""
{base_ctes},
user_agg AS (
    SELECT
        u.id AS entity_id,
        u.name AS entity_name,
        u.team_id,
        COUNT(sf.solve_id) AS solved_count,
        COUNT(DISTINCT CASE WHEN :full_clear_category IS NOT NULL AND sf.category = :full_clear_category THEN sf.challenge_id END) AS category_solved_count,
        COALESCE((SELECT ct.total_challenges FROM category_totals ct WHERE ct.category = :full_clear_category), 0) AS category_total_count,
        MAX(CASE WHEN :full_clear_category IS NOT NULL AND sf.category = :full_clear_category THEN sf.solve_date END) AS category_full_clear_date,
        COALESCE(SUM(sf.challenge_value), 0) + COALESCE(ua.award_value, 0) AS total_score,
        MIN(sf.solve_time) AS fastest_solve,
        AVG(sf.solve_time) AS avg_solve_time,
        COALESCE(SUM(CASE WHEN sf.is_first_blood THEN 1 ELSE 0 END), 0) AS first_blood_count,
        COUNT(DISTINCT sf.category) AS category_clear_count,
        COALESCE(
            SUM(CASE WHEN COALESCE(wb.wrong_before, 0) = 0 THEN 1 ELSE 0 END),
            0
        ) AS perfect_solve_count,
        COALESCE(wu.wrong_count, 0) AS wrong_count,
        MAX(sf.solve_date) AS last_solve_date
    FROM users u
    LEFT JOIN solves_filtered sf ON sf.user_id = u.id
    LEFT JOIN wrong_user wu ON wu.user_id = u.id
    LEFT JOIN wrong_before wb ON wb.solve_id = sf.solve_id
    LEFT JOIN user_awards ua ON ua.user_id = u.id
    {"WHERE u.bracket_id = " + bracket_filter if bracket_filter else ""}
    GROUP BY u.id, u.name, u.team_id, wu.wrong_count, ua.award_value
),
ranked AS (
    SELECT
        ua.*,
        CASE
            WHEN :full_clear_category IS NULL THEN 1
            WHEN ua.category_total_count > 0 AND ua.category_solved_count >= ua.category_total_count THEN 1
            ELSE 0
        END AS full_clear_pass,
        RANK() OVER (ORDER BY {rank_order_expr}) AS rank
    FROM user_agg ua
)
SELECT entity_id, entity_name, {metric_expr} AS metric_value, COALESCE(category_full_clear_date, last_solve_date) AS last_solve_date, solved_count, rank,
       (SELECT t.name FROM teams t WHERE t.id = ranked.team_id) AS team_name
FROM ranked
{final_where}
{ranked_order_clause}
LIMIT :limit
"""
        return sql, params

    metric_expr = {
        "FIRST_BLOOD": "CASE WHEN is_first_blood THEN 1 ELSE 0 END",
        "WRONG_SUBMISSION_COUNT": "COALESCE(wrong_before, 0)",
    }[metric]

    sql = f"""
{base_ctes},
solve_rows AS (
    SELECT
        sf.solve_id AS entity_id,
        sf.challenge_name AS entity_name,
        sf.category AS category,
        sf.solve_time,
        sf.is_first_blood,
        sf.hint_used,
        sf.team_id,
        sf.user_id,
        COALESCE(wb.wrong_before, 0) AS wrong_before
    FROM solves_filtered sf
    LEFT JOIN wrong_before wb ON wb.solve_id = sf.solve_id
)
SELECT 
    sr.entity_id, 
    sr.entity_name, 
    sr.category, 
    {metric_expr} AS metric_value,
    t.name AS team_name,
    u.name AS user_name
FROM solve_rows sr
LEFT JOIN teams t ON t.id = sr.team_id
LEFT JOIN users u ON u.id = sr.user_id
{"WHERE t.bracket_id = " + bracket_filter if bracket_filter else ""}
{final_where.replace("WHERE", "AND") if bracket_filter and final_where else final_where}
{order_clause}
LIMIT :limit
"""
    return sql, params


def execute_query(spec: QuerySpec) -> Dict[str, Any]:
    sql, params = compile_query(spec)
    rows = db.session.execute(text(sql), params).fetchall()

    result_rows = []
    for row in rows:
        payload = {
            "entity_id": row.entity_id,
            "entity_name": row.entity_name,
            "metric_value": row.metric_value,
        }
        if "category" in row._mapping:
            payload["category"] = row._mapping.get("category")
        if "team_name" in row._mapping:
            payload["team_name"] = row._mapping.get("team_name")
        if "user_name" in row._mapping:
            payload["user_name"] = row._mapping.get("user_name")
        if "last_solve_date" in row._mapping:
            val = row._mapping.get("last_solve_date")
            payload["last_solve_date"] = str(val) if val else None
        if "solved_count" in row._mapping:
            payload["solved_count"] = row._mapping.get("solved_count")
        if "rank" in row._mapping:
            payload["rank"] = row._mapping.get("rank")
        result_rows.append(payload)

    return {
        "rule": spec.rule,
        "generated_sql": sql.strip(),
        "result": result_rows,
    }
