import csv
import re
from datetime import datetime, timedelta
from io import StringIO

from flask import Response, render_template, request, stream_with_context, url_for

from CTFd.admin import admin
from CTFd.models import ChallengeStartTracking, Challenges, Teams, Users, db
from CTFd.utils.decorators import admin_or_jury


def _parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _escape_like_pattern(value):
    if not value:
        return value
    value = value.replace("\\", "\\\\")
    value = value.replace("%", "\\%")
    value = value.replace("_", "\\_")
    return value


def _parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError:
        return None


def _parse_quick_range(value):
    if not value:
        return None
    match = re.match(r"^(\d+)(m|h)$", value.strip())
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        return None
    if unit == "m":
        return timedelta(minutes=amount)
    if unit == "h":
        return timedelta(hours=amount)
    return None


def _apply_user_team_filters(query, user_filter, team_filter):
    user_id = _parse_int(user_filter)
    team_id = _parse_int(team_filter)

    if user_filter:
        if user_id is not None:
            query = query.filter(Users.id == user_id)
        else:
            escaped_filter = _escape_like_pattern(user_filter)
            search_pattern = f"%{escaped_filter}%"
            query = query.filter(Users.name.ilike(search_pattern, escape="\\"))

    if team_filter:
        if team_id is not None:
            query = query.filter(Teams.id == team_id)
        else:
            escaped_filter = _escape_like_pattern(team_filter)
            search_pattern = f"%{escaped_filter}%"
            query = query.filter(Teams.name.ilike(search_pattern, escape="\\"))

    return query


def _apply_challenge_filter(query, challenge_filter):
    challenge_id = _parse_int(challenge_filter)
    if challenge_filter:
        if challenge_id is not None:
            query = query.filter(Challenges.id == challenge_id)
        else:
            escaped_filter = _escape_like_pattern(challenge_filter)
            search_pattern = f"%{escaped_filter}%"
            query = query.filter(Challenges.name.ilike(search_pattern, escape="\\"))
    return query


def _apply_date_filters(query, start_date, end_date):
    if start_date:
        query = query.filter(ChallengeStartTracking.started_at >= start_date)
    if end_date:
        query = query.filter(ChallengeStartTracking.started_at <= end_date)
    return query


def _base_instances_query():
    return (
        db.session.query(
            ChallengeStartTracking,
            Users.id.label("user_id"),
            Users.name.label("user_name"),
            Teams.id.label("team_id"),
            Teams.name.label("team_name"),
            Challenges.id.label("challenge_id"),
            Challenges.name.label("challenge_name"),
        )
        .outerjoin(Users, ChallengeStartTracking.user_id == Users.id)
        .outerjoin(Teams, ChallengeStartTracking.team_id == Teams.id)
        .join(Challenges, ChallengeStartTracking.challenge_id == Challenges.id)
        .order_by(ChallengeStartTracking.started_at.desc())
    )


@admin.route("/admin/instances_history")
@admin_or_jury
def instances_history_listing():
    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 50, type=int)
    per_page = max(1, min(per_page, 200))

    user_filter = (request.args.get("user") or "").strip()
    team_filter = (request.args.get("team") or "").strip()
    challenge_filter = (request.args.get("challenge") or "").strip()
    start_filter = (request.args.get("start") or "").strip()
    end_filter = (request.args.get("end") or "").strip()
    quick_filter = (request.args.get("quick") or "").strip()

    start_date = _parse_datetime(start_filter)
    end_date = _parse_datetime(end_filter)
    quick_range = _parse_quick_range(quick_filter)
    if quick_range:
        end_date = datetime.utcnow()
        start_date = end_date - quick_range

    query = _base_instances_query()
    query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
    query = _apply_challenge_filter(query, challenge_filter=challenge_filter)
    query = _apply_date_filters(query, start_date=start_date, end_date=end_date)

    logs = query.paginate(page=page, per_page=per_page, error_out=False)

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/instances_history/instances_history.html",
        logs=logs,
        prev_page=url_for(request.endpoint, page=logs.prev_num, **args),
        next_page=url_for(request.endpoint, page=logs.next_num, **args),
        user_filter=user_filter,
        team_filter=team_filter,
        challenge_filter=challenge_filter,
        start_filter=start_filter,
        end_filter=end_filter,
        quick_filter=quick_filter,
        per_page=per_page,
    )


@admin.route("/admin/instances_history/export/csv")
@admin_or_jury
def instances_history_export_csv():
    user_filter = (request.args.get("user") or "").strip()
    team_filter = (request.args.get("team") or "").strip()
    challenge_filter = (request.args.get("challenge") or "").strip()
    start_filter = (request.args.get("start") or "").strip()
    end_filter = (request.args.get("end") or "").strip()
    quick_filter = (request.args.get("quick") or "").strip()

    start_date = _parse_datetime(start_filter)
    end_date = _parse_datetime(end_filter)
    quick_range = _parse_quick_range(quick_filter)
    if quick_range:
        end_date = datetime.utcnow()
        start_date = end_date - quick_range

    query = _base_instances_query()
    query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
    query = _apply_challenge_filter(query, challenge_filter=challenge_filter)
    query = _apply_date_filters(query, start_date=start_date, end_date=end_date)

    def generate():
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(
            [
                "id",
                "started_at",
                "challenge_id",
                "challenge_name",
                "user_id",
                "user_name",
                "team_id",
                "team_name",
            ]
        )
        yield sio.getvalue()
        sio.seek(0)
        sio.truncate(0)

        for row in query.yield_per(1000):
            tracking = row.ChallengeStartTracking
            writer.writerow(
                [
                    tracking.id,
                    tracking.started_at.isoformat() if tracking.started_at else "",
                    row.challenge_id,
                    row.challenge_name or "",
                    row.user_id or "",
                    row.user_name or "",
                    row.team_id or "",
                    row.team_name or "",
                ]
            )
            yield sio.getvalue()
            sio.seek(0)
            sio.truncate(0)

    headers = {
        "Content-Disposition": 'attachment; filename="instances_history.csv"',
        "Content-Type": "text/csv; charset=utf-8",
    }
    return Response(stream_with_context(generate()), headers=headers)
