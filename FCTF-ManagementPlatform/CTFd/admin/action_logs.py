import csv
from io import StringIO

from flask import Response, render_template, request, stream_with_context, url_for

from CTFd.admin import admin
from CTFd.models import ActionLogs, Teams, Users
from CTFd.utils.decorators import admin_or_jury


def _parse_int(value):
	try:
		return int(value)
	except (TypeError, ValueError):
		return None


def _apply_user_team_filters(query, user_filter, team_filter):
	user_id = _parse_int(user_filter)
	team_id = _parse_int(team_filter)

	if user_filter:
		if user_id is not None:
			query = query.filter(Users.id == user_id)
		else:
			query = query.filter(Users.name.ilike(f"%{user_filter}%"))

	if team_filter:
		if team_id is not None:
			query = query.filter(Teams.id == team_id)
		else:
			query = query.filter(Teams.name.ilike(f"%{team_filter}%"))

	return query


def _base_action_logs_query():
	return (
		ActionLogs.query.add_columns(
			Users.id.label("user_id"),
			Users.name.label("user_name"),
			Teams.id.label("team_id"),
			Teams.name.label("team_name"),
		)
		.join(Users, ActionLogs.userId == Users.id)
		.outerjoin(Teams, Users.team_id == Teams.id)
		.order_by(ActionLogs.actionDate.desc())
	)


@admin.route("/admin/action_logs")
@admin_or_jury
def action_logs_listing():
	page = abs(request.args.get("page", 1, type=int))
	per_page = request.args.get("per_page", 50, type=int)
	per_page = max(1, min(per_page, 200))

	user_filter = (request.args.get("user") or "").strip()
	team_filter = (request.args.get("team") or "").strip()

	query = _base_action_logs_query()
	query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)

	logs = query.paginate(page=page, per_page=per_page, error_out=False)

	args = dict(request.args)
	args.pop("page", None)

	return render_template(
		"admin/action_logs/action_logs.html",
		logs=logs,
		prev_page=url_for(request.endpoint, page=logs.prev_num, **args),
		next_page=url_for(request.endpoint, page=logs.next_num, **args),
		user_filter=user_filter,
		team_filter=team_filter,
		per_page=per_page,
	)


@admin.route("/admin/action_logs/export/csv")
@admin_or_jury
def action_logs_export_csv():
	user_filter = (request.args.get("user") or "").strip()
	team_filter = (request.args.get("team") or "").strip()

	query = _base_action_logs_query()
	query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)

	def generate():
		sio = StringIO()
		writer = csv.writer(sio)
		writer.writerow(
			[
				"actionId",
				"actionDate",
				"actionType",
				"topicName",
				"actionDetail",
				"userId",
				"userName",
				"teamId",
				"teamName",
			]
		)
		yield sio.getvalue()
		sio.seek(0)
		sio.truncate(0)

		for row in query.yield_per(1000):
			log = row.ActionLogs
			writer.writerow(
				[
					log.actionId,
					log.actionDate.isoformat() if log.actionDate else "",
					log.actionType,
					log.topicName or "",
					log.actionDetail or "",
					row.user_id,
					row.user_name,
					row.team_id or "",
					row.team_name or "",
				]
			)
			yield sio.getvalue()
			sio.seek(0)
			sio.truncate(0)

	headers = {
		"Content-Disposition": 'attachment; filename="action_logs.csv"',
		"Content-Type": "text/csv; charset=utf-8",
	}
	return Response(stream_with_context(generate()), headers=headers)
