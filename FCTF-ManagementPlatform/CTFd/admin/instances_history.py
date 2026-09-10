import csv
from datetime import datetime, timedelta
from io import StringIO

from flask import Response, render_template, request, stream_with_context, url_for

from CTFd.admin import admin
from CTFd.models import ChallengeInstance
from CTFd.utils.decorators import admin_or_jury


def _parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError:
        return None


def _parse_quick_range(value):
    ranges = {"15m": timedelta(minutes=15), "30m": timedelta(minutes=30), "1h": timedelta(hours=1), "6h": timedelta(hours=6), "12h": timedelta(hours=12), "24h": timedelta(hours=24)}
    return ranges.get(value)


def _query_instances(team_filter, challenge_filter, start_date, end_date):
    query = ChallengeInstance.query
    if team_filter:
        if team_filter.isdigit():
            query = query.filter(ChallengeInstance.instance_owner_team_id == int(team_filter))
        else:
            escaped_team = team_filter.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(ChallengeInstance.owner_team_name_snapshot.ilike("%" + escaped_team + "%", escape="\\"))
    if challenge_filter:
        if challenge_filter.isdigit():
            query = query.filter(ChallengeInstance.challenge_id == int(challenge_filter))
        else:
            escaped_challenge = challenge_filter.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(ChallengeInstance.challenge_name_snapshot.ilike("%" + escaped_challenge + "%", escape="\\"))
    if start_date:
        query = query.filter(ChallengeInstance.requested_at >= start_date)
    if end_date:
        query = query.filter(ChallengeInstance.requested_at <= end_date)
    return query.order_by(ChallengeInstance.requested_at.desc())


def _filters():
    team = (request.args.get("team") or "").strip()
    challenge = (request.args.get("challenge") or "").strip()
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    quick = (request.args.get("quick") or "").strip()
    start_date, end_date = _parse_datetime(start), _parse_datetime(end)
    if quick and _parse_quick_range(quick):
        end_date = datetime.utcnow()
        start_date = end_date - _parse_quick_range(quick)
    return team, challenge, start, end, quick, start_date, end_date


@admin.route("/admin/instances_history")
@admin_or_jury
def instances_history_listing():
    page = max(1, request.args.get("page", 1, type=int))
    per_page = max(1, min(request.args.get("per_page", 50, type=int), 200))
    team, challenge, start, end, quick, start_date, end_date = _filters()
    logs = _query_instances(team, challenge, start_date, end_date).paginate(page=page, per_page=per_page, error_out=False)
    args = dict(request.args)
    args.pop("page", None)
    return render_template(
        "admin/instances_history/instances_history.html", logs=logs,
        prev_page=url_for(request.endpoint, page=logs.prev_num, **args),
        next_page=url_for(request.endpoint, page=logs.next_num, **args),
        team_filter=team, challenge_filter=challenge, start_filter=start, end_filter=end,
        quick_filter=quick, timezone_offset="", per_page=per_page,
    )


@admin.route("/admin/instances_history/export/csv")
@admin_or_jury
def instances_history_export_csv():
    team, challenge, _, _, _, start_date, end_date = _filters()
    query = _query_instances(team, challenge, start_date, end_date)

    def generate():
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(["instance_id", "requested_at", "stopped_at", "namespace", "lifecycle_state", "challenge_id", "challenge_name", "team_id", "team_name"])
        yield output.getvalue()
        output.seek(0); output.truncate(0)
        for item in query.yield_per(1000):
            writer.writerow([item.instance_id, item.requested_at.isoformat() if item.requested_at else "", item.stopped_at.isoformat() if item.stopped_at else "", item.namespace, item.lifecycle_state, item.challenge_id, item.challenge_name_snapshot, item.instance_owner_team_id or "", item.owner_team_name_snapshot or ""])
            yield output.getvalue()
            output.seek(0); output.truncate(0)
    return Response(stream_with_context(generate()), headers={"Content-Disposition": 'attachment; filename="instances_history.csv"', "Content-Type": "text/csv; charset=utf-8"})
