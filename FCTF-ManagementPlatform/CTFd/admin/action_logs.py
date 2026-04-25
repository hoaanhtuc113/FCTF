import csv
from io import BytesIO
from io import StringIO

from flask import Response, render_template, request, stream_with_context, url_for, send_file

from CTFd.admin import admin
from CTFd.models import ActionLogs, Teams, Users
from CTFd.utils.decorators import admin_or_jury
from CTFd.utils import get_config


ACTION_TYPE_LABELS = {
	1: "ACCESS_CHALLENGE",
	2: "START_CHALLENGE",
	3: "CORRECT_FLAG",
	4: "INCORRECT_FLAG",
	5: "UNLOCK_HINT",
}


def _action_type_label(action_type):
	if action_type is None:
		return ""
	return ACTION_TYPE_LABELS.get(action_type, "UNKNOWN")


def _parse_int(value):
	try:
		return int(value)
	except (TypeError, ValueError):
		return None


def _escape_like_pattern(value):
	"""Escape special LIKE wildcard characters to prevent injection."""
	if not value:
		return value
	# Escape LIKE wildcards: % and _
	value = value.replace("\\", "\\\\")  # Escape backslash first
	value = value.replace("%", "\\%")
	value = value.replace("_", "\\_")
	return value


def _apply_user_team_filters(query, user_filter, team_filter):
	user_id = _parse_int(user_filter)

	if user_filter:
		if user_id is not None:
			query = query.filter(Users.id == user_id)
		else:
			escaped_filter = _escape_like_pattern(user_filter)
			search_pattern = f"%{escaped_filter}%"
			query = query.filter(Users.name.ilike(search_pattern, escape="\\"))

	# team_filter: filter via users_teams junction
	if team_filter:
		from CTFd.models import UsersTeams
		team_id = _parse_int(team_filter)
		if team_id is not None:
			user_ids_in_team = [
				ut.user_id for ut in UsersTeams.query.filter_by(team_id=team_id).all()
			]
			query = query.filter(ActionLogs.userId.in_(user_ids_in_team))
		else:
			from CTFd.models import Teams
			escaped_filter = _escape_like_pattern(team_filter)
			teams = Teams.query.filter(Teams.name.ilike(f"%{escaped_filter}%", escape="\\")).all()
			team_ids = [t.id for t in teams]
			if team_ids:
				from CTFd.models import UsersTeams
				user_ids = [ut.user_id for ut in UsersTeams.query.filter(UsersTeams.team_id.in_(team_ids)).all()]
				query = query.filter(ActionLogs.userId.in_(user_ids))
			else:
				from CTFd.models import db as _db
				query = query.filter(_db.false())

	return query


def _apply_action_type_filter(query, action_type_filter):
	action_type = _parse_int(action_type_filter)
	if action_type_filter and action_type is not None:
		query = query.filter(ActionLogs.actionType == action_type)
	return query


def _base_action_logs_query():
	return (
		ActionLogs.query.add_columns(
			Users.id.label("user_id"),
			Users.name.label("user_name"),
		)
		.join(Users, ActionLogs.userId == Users.id)
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
	action_type_filter = (request.args.get("action_type") or "").strip()

	query = _base_action_logs_query()
	query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
	query = _apply_action_type_filter(query, action_type_filter=action_type_filter)

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
		action_type_filter=action_type_filter,
		per_page=per_page,
		action_type_labels=ACTION_TYPE_LABELS,
	)


@admin.route("/admin/action_logs/export/csv")
@admin_or_jury
def action_logs_export_csv():
	user_filter = (request.args.get("user") or "").strip()
	team_filter = (request.args.get("team") or "").strip()
	action_type_filter = (request.args.get("action_type") or "").strip()

	query = _base_action_logs_query()
	query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
	query = _apply_action_type_filter(query, action_type_filter=action_type_filter)

	def generate():
		sio = StringIO()
		writer = csv.writer(sio)
		writer.writerow(
			[
				"actionId",
				"actionDate",
				"actionType",
				"actionTypeLabel",
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
					_action_type_label(log.actionType),
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


def _sanitize_sheet_name(name: str) -> str:
	# Excel limits: 31 chars, no : \/ ? * [ ]
	if not name:
		name = "Unknown"
	for ch in [":", "\\", "/", "?", "*", "[", "]"]:
		name = name.replace(ch, "-")
	name = name.strip()[:31]
	return name or "Unknown"


def _unique_sheet_name(base_name: str, used_sheet_names: set[str]) -> str:
	name = _sanitize_sheet_name(base_name)
	if name not in used_sheet_names:
		used_sheet_names.add(name)
		return name

	suffix = 2
	while True:
		candidate = _sanitize_sheet_name(f"{name[:28]}-{suffix}")
		if candidate not in used_sheet_names:
			used_sheet_names.add(candidate)
			return candidate
		suffix += 1


def _group_action_log_rows(rows, user_mode: str):
	grouped = {}
	for r in rows:
		if user_mode == "users":
			key = ("user", r.user_id, r.user_name)
		else:
			key = ("team", r.team_id or 0, r.team_name or "No Team")
		grouped.setdefault(key, []).append(r)
	return grouped


def _write_action_logs_worksheet(ws, headers, group_rows, date_format):
	for col, h in enumerate(headers):
		ws.write(0, col, h)

	row_count = 0
	for idx, row in enumerate(group_rows, start=1):
		row_count = idx
		log = row.ActionLogs
		ws.write(idx, 0, log.actionId)
		if log.actionDate:
			ws.write_datetime(idx, 1, log.actionDate, date_format)
		else:
			ws.write(idx, 1, "")
		ws.write(idx, 2, log.actionType)
		ws.write(idx, 3, _action_type_label(log.actionType))
		ws.write(idx, 4, log.topicName or "")
		ws.write(idx, 5, log.actionDetail or "")
		ws.write(idx, 6, row.user_id)
		ws.write(idx, 7, row.user_name)
		ws.write(idx, 8, row.team_id or "")
		ws.write(idx, 9, row.team_name or "")

	ws.autofilter(0, 0, row_count if row_count else 0, len(headers) - 1)
	ws.freeze_panes(1, 0)


@admin.route("/admin/action_logs/export/xlsx")
@admin_or_jury
def action_logs_export_xlsx():
	"""Export action logs to an XLSX with one sheet per user (users mode) or per team (teams mode)."""
	try:
		import xlsxwriter  # type: ignore
	except Exception:
		return {"success": False, "error": "xlsxwriter library not installed"}, 500

	user_filter = (request.args.get("user") or "").strip()
	team_filter = (request.args.get("team") or "").strip()
	action_type_filter = (request.args.get("action_type") or "").strip()

	query = _base_action_logs_query()
	query = _apply_user_team_filters(query, user_filter=user_filter, team_filter=team_filter)
	query = _apply_action_type_filter(query, action_type_filter=action_type_filter)

	user_mode = (get_config("user_mode") or "teams").strip()

	# Materialize rows once; used to group in-memory
	rows = list(query.all())
	grouped = _group_action_log_rows(rows, user_mode=user_mode)

	output = BytesIO()
	workbook = xlsxwriter.Workbook(output, {"in_memory": True})
	date_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})

	headers = [
		"actionId",
		"actionDate",
		"actionType",
		"actionTypeLabel",
		"topicName",
		"actionDetail",
		"userId",
		"userName",
		"teamId",
		"teamName",
	]

	used_sheet_names = set()
	for (mode, entity_id, entity_name), group_rows in grouped.items():
		base = f"{entity_id}-{entity_name}" if entity_id else str(entity_name)
		sheet_name = _unique_sheet_name(base, used_sheet_names)
		ws = workbook.add_worksheet(sheet_name)
		_write_action_logs_worksheet(ws, headers, group_rows, date_format)

	workbook.close()
	output.seek(0)

	filename = f"action_logs_{user_mode}.xlsx"
	return send_file(
		output,
		as_attachment=True,
		download_name=filename,
		mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		max_age=-1,
	)