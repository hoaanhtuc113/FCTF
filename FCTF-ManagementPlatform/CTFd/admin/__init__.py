import csv  # noqa: I001
import datetime
import os
from io import StringIO
import json

from flask import Blueprint, abort, g
from flask import current_app as app
from flask import (
    flash,
    jsonify,
    redirect,
    render_template,
    render_template_string,
    request,
    send_file,
    url_for,
)
from CTFd.utils.crypto import verify_password,hash_password
from CTFd.utils.email import user_created_notification
import io, csv, secrets, string
from sqlalchemy.orm import joinedload
admin = Blueprint("admin", __name__)

# isort:imports-firstparty
from CTFd.admin import rewards  # noqa: F401,I001
from CTFd.admin import challenges  # noqa: F401,I001
from CTFd.admin import notifications  # noqa: F401,I001
from CTFd.admin import pages  # noqa: F401,I001
from CTFd.admin import scoreboard  # noqa: F401,I001
from CTFd.admin import statistics  # noqa: F401,I001
from CTFd.admin import submissions  # noqa: F401,I001
from CTFd.admin import teams  # noqa: F401,I001
from CTFd.admin import users  # noqa: F401,I001
from CTFd.admin import Ticket
from CTFd.admin import monitors
from CTFd.admin import exports
from CTFd.admin import estimation
from CTFd.admin import action_logs  # noqa: F401
from CTFd.admin import admin_audit  # noqa: F401
from CTFd.admin import instances_history  # noqa: F401

from CTFd.cache import (
    cache,
    clear_all_team_sessions,
    clear_all_user_sessions,
    clear_challenges,
    clear_config,
    clear_pages,
    clear_standings,
)
from CTFd.models import (
    Awards,
    Challenges,
    Configs,
    Notifications,
    Pages,
    Solves,
    Submissions,
    Teams,
    Tracking,
    Unlocks,
    Users,
    db,
)
from CTFd.utils import config as ctf_config
from CTFd.utils import get_app_config, get_config, set_config
from CTFd.utils.csv import dump_csv, load_challenges_csv, load_teams_csv, load_users_csv, load_users_and_teams_csv
from CTFd.utils.decorators import admins_only
from CTFd.utils.exports import background_import_ctf
from CTFd.utils.exports import export_ctf as export_ctf_util
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.security.auth import logout_user
from CTFd.utils.uploads import delete_file
from CTFd.utils.user import is_admin,is_challenge_writer,is_jury


@admin.route("/admin", methods=["GET"])
def view():
    if is_challenge_writer() or is_admin() or is_jury():
        return redirect(url_for("admin.statistics"))
    return redirect(url_for("auth.login"))


@admin.route("/admin/plugins/<plugin>", methods=["GET", "POST"])
@admins_only
def plugin(plugin):
    if request.method == "GET":
        plugins_path = os.path.join(app.root_path, "plugins")

        config_html_plugins = [
            name
            for name in os.listdir(plugins_path)
            if os.path.isfile(os.path.join(plugins_path, name, "config.html"))
        ]

        if plugin in config_html_plugins:
            config_html = open(
                os.path.join(app.root_path, "plugins", plugin, "config.html")
            ).read()
            return render_template_string(config_html)
        abort(404)
    elif request.method == "POST":
        for k, v in request.form.items():
            if k == "nonce":
                continue
            set_config(k, v)
        with app.app_context():
            clear_config()
        return "1"


@admin.route("/admin/import", methods=["GET", "POST"])
@admins_only
def import_ctf():
    if request.method == "GET":
        start_time = cache.get("import_start_time")
        end_time = cache.get("import_end_time")
        import_status = cache.get("import_status")
        import_error = cache.get("import_error")
        return render_template(
            "admin/import.html",
            start_time=start_time,
            end_time=end_time,
            import_status=import_status,
            import_error=import_error,
        )
    elif request.method == "POST":
        backup = request.files["backup"]
        background_import_ctf(backup)
        return redirect(url_for("admin.import_ctf"))


@admin.route("/admin/export", methods=["GET", "POST"])
@admins_only
def export_ctf():
    backup = export_ctf_util()
    ctf_name = ctf_config.ctf_name()
    day = datetime.datetime.now().strftime("%Y-%m-%d_%T")
    full_name = "{}.{}.zip".format(ctf_name, day)
    return send_file(backup, as_attachment=True, download_name=full_name, max_age=-1)


@admin.route("/admin/import/template/<name>", methods=["GET"])
@admins_only
def download_template(name):
    """Serve CSV import templates stored in the admin theme templates folder."""
    allowed = {
        "users_template.csv",
        "teams_template.csv",
        "users_and_teams_template.csv",
    }
    if name not in allowed:
        abort(404)
    template_path = os.path.join(
        app.root_path, "themes", "admin", "templates", "import_templates", name
    )
    return send_file(template_path, as_attachment=True, download_name=name)


@admin.route("/admin/import/csv", methods=["POST"])
@admins_only
def import_csv():
    wants_json = (
        request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or request.accept_mimetypes["application/json"]
        >= request.accept_mimetypes["text/html"]
    )

    csv_type = request.form["csv_type"]
    raw = request.files["csv_file"].stream.read()
    try:
        csvdata = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            csvdata = raw.decode("cp1252")
        except UnicodeDecodeError:
            csvdata = raw.decode("latin-1")
    csvfile = StringIO(csvdata)
    reader = csv.DictReader(csvfile)

    def normalize_row(row):
        # Allow templates to use Titlecase headers (e.g. Name/Email/Password)
        # while schemas expect lowercase (name/email/password)
        return {
            (k.strip().lower() if isinstance(k, str) else k): v
            for k, v in (row or {}).items()
        }

    normalized_reader = (normalize_row(row) for row in reader)
    result = None

    def format_import_errors(res):
        # Expected shapes:
        # - True
        # - [(row_index, {field: [errors]})] from load_users_csv/load_teams_csv
        # - other objects
        if isinstance(res, list):
            # If the importer uses 0-based indexes for first data row, convert to CSV line numbers.
            # CSV line number = header (1) + data row index (0-based) + 1
            has_zero_based = any(
                isinstance(e, tuple)
                and len(e) == 2
                and isinstance(e[0], int)
                and e[0] == 0
                for e in res
            )
            offset = 2 if has_zero_based else 0

            lines = []
            for entry in res[:50]:
                if isinstance(entry, tuple) and len(entry) == 2:
                    row_index, err = entry
                    row_display = row_index + offset if isinstance(row_index, int) else row_index
                    if isinstance(err, (dict, list)):
                        err_text = json.dumps(err, ensure_ascii=False)
                    else:
                        err_text = str(err)
                    lines.append(f"Row {row_display}: {err_text}")
                else:
                    lines.append(str(entry))

            remaining = len(res) - len(lines)
            msg = "Import failed:\n" + "\n".join(lines)
            if remaining > 0:
                msg += f"\n... and {remaining} more"
            return msg

        return f"Import failed:\n{res}"

    if csv_type == "users":
        result = load_users_csv(normalized_reader)
    elif csv_type == "users_and_teams":
        # load_users_and_teams_csv expects a file-like object (or DictReader).
        # Rewind to ensure it reads the header row.
        csvfile.seek(0)
        result = load_users_and_teams_csv(csvfile)
        warnings = (result or {}).get("warnings") if isinstance(result, dict) else None
        if warnings and not wants_json:
            max_lines = 50
            shown = warnings[:max_lines]
            remaining = len(warnings) - len(shown)
            message = "Imported with warnings:\n" + "\n".join(shown)
            if remaining > 0:
                message += f"\n... and {remaining} more"
            flash(message, category="warning")
    elif csv_type == "teams":
        result = load_teams_csv(normalized_reader)
    elif csv_type == "challenges":
        result = load_challenges_csv(normalized_reader)
    else:
        # Handle other CSV types

        result = False  # or load other types if implemented

    redirect_url = url_for("admin.config", backup_tab="import-csv", _anchor="backup")

    success = result is True or (isinstance(result, dict) and result.get("success") is True)

    # AJAX mode: respond with JSON (no redirects) so UI can show feedback without reload
    if wants_json:
        payload = {
            "success": bool(success),
            "csv_type": csv_type,
            "warnings": (result or {}).get("warnings") if isinstance(result, dict) else [],
            "message": "",
            "errors": [],
        }

        if success:
            if payload["warnings"]:
                payload["message"] = "Imported with warnings"
            else:
                payload["message"] = "Import completed successfully"
            return jsonify(payload), 200

        # Failure formatting
        if isinstance(result, list):
            has_zero_based = any(
                isinstance(e, tuple)
                and len(e) == 2
                and isinstance(e[0], int)
                and e[0] == 0
                for e in result
            )
            offset = 2 if has_zero_based else 0
            errors = []
            for entry in result:
                if isinstance(entry, tuple) and len(entry) == 2:
                    row_index, err = entry
                    row_display = row_index + offset if isinstance(row_index, int) else row_index
                    errors.append({"row": row_display, "error": err})
                else:
                    errors.append({"row": None, "error": entry})
            payload["errors"] = errors
            payload["message"] = format_import_errors(result)
        else:
            payload["message"] = format_import_errors(result)

        return jsonify(payload), 400

    if success is True:
        flash("Import completed successfully", category="success")
        # for user in g.created_users:
        #     user_created_notification(user['email'], user['name'], user['password'])
        return redirect(redirect_url)
    else:
        flash(format_import_errors(result), category="danger")
        return redirect(redirect_url)



@admin.route("/admin/export/csv")
@admins_only
def export_csv():
    table = request.args.get("table")

    output = dump_csv(name=table)

    return send_file(
        output,
        as_attachment=True,
        max_age=-1,
        download_name="{name}-{table}.csv".format(
            name=ctf_config.ctf_name(), table=table
        ),
    )

@admin.route("/admin/export/csv/user")
@admins_only
def export_csv_user():
    include_passwords = request.args.get("include_passwords") == "1"
    
    # Get filter parameters
    field = request.args.get("field")
    q = request.args.get("q")

    if include_passwords:
        output = dump_csv_with_passwords(field=field, q=q)
    else:
        output = dump_csv_without_passwords(field=field, q=q)

    # Add filter info to filename if present
    filename = f"{ctf_config.ctf_name()}-user"
    if q and field:
        filename += f"-{field}-{q}"
    filename += ".csv"

    return send_file(
        output,
        as_attachment=True,
        max_age=-1,
        download_name=filename,
    )

def dump_csv_with_passwords(field=None, q=None):
    """
    Xuất CSV cho user type='user' kèm password mới (plaintext + hash)
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "email", "team_id", "team_name", "password_plain"])

    charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    
    # Build query with filters
    query = (
        db.session.query(Users, Teams)
        .outerjoin(Teams, Users.team_id == Teams.id)
        .filter(Users.type == "user")
        .options(joinedload(Users.team))
    )
    
    # Apply filters if provided
    if q and field:
        if Users.__mapper__.has_property(field):
            query = query.filter(getattr(Users, field).like(f"%{q}%"))
    
    users = query.all()

    import concurrent.futures

    from passlib.hash import bcrypt_sha256
    def hash_and_prepare(user_team):
        user, team = user_team
        new_pass = "".join(secrets.choice(charset) for _ in range(12))
        hashed = bcrypt_sha256.using(rounds=4).hash(str(new_pass))
        if isinstance(hashed, bytes):
            hashed = hashed.decode("utf-8")
        return (user.id, hashed, user.name, user.email, user.team_id or "", team.name if team else "", new_pass)

    # Dùng ThreadPoolExecutor để hash song song
    results = []
    with concurrent.futures.ThreadPoolExecutor() as executor:
        for res in executor.map(hash_and_prepare, users):
            results.append(res)

    # Update DB và ghi file CSV
    for user_id, hashed, name, email, team_id, team_name, new_pass in results:
        db.session.execute(
            db.text("UPDATE users SET password = :password WHERE id = :user_id"),
            {"password": hashed, "user_id": user_id}
        )
        writer.writerow([
            name,
            email,
            team_id,
            team_name,
            new_pass
        ])

    db.session.commit()
    output.seek(0)

    log_audit(
        action="bulk_password_reset",
        data={"count": len(results)},
    )

    return io.BytesIO(output.getvalue().encode("utf-8"))

def dump_csv_without_passwords(field=None, q=None):
    """
    Xuất CSV cho user type='user' KHÔNG chứa mật khẩu
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "email", "team_id", "team_name"])

    # Build query with filters
    query = (
        db.session.query(Users, Teams)
        .outerjoin(Teams, Users.team_id == Teams.id)
        .filter(Users.type == "user")
    )
    
    # Apply filters if provided
    if q and field:
        if Users.__mapper__.has_property(field):
            query = query.filter(getattr(Users, field).like(f"%{q}%"))
    
    users = query.all()

    for user, team in users:
        writer.writerow([
            user.name,
            user.email,
            user.team_id or "",
            team.name if team else "",
        ])

    output.seek(0)
    return io.BytesIO(output.getvalue().encode("utf-8"))

@admin.route("/admin/config", methods=["GET", "POST"])
@admins_only
def config():
    if request.method == "POST":
        for key, values in request.form.lists():
            if key in (
                "nonce",
                "user_mode",
                "registration_code",
                "oauth_client_id",
                "oauth_client_secret",
            ):
                continue
            if not values:
                continue
            value = values[-1]
            if value in ("true", "false"):
                value = value == "true"
            set_config(key=key, value=value)

        clear_config()
        clear_standings()
        clear_challenges()
        return redirect(url_for("admin.config"))

    # Clear the config cache so that we don't get stale values
    clear_config()

    configs = Configs.query.all()
    configs = {c.key: get_config(c.key) for c in configs}

    force_html_sanitization = get_app_config("HTML_SANITIZATION")

    return render_template(
        "admin/config.html",
        **configs,
        force_html_sanitization=force_html_sanitization
    )


@admin.route("/admin/reset", methods=["GET", "POST"])
@admins_only
def reset():
    if request.method == "POST":
        require_setup = False
        logout = False
        next_url = url_for("admin.statistics")

        data = request.form

        if data.get("pages"):
            _pages = Pages.query.all()
            for p in _pages:
                for f in p.files:
                    delete_file(file_id=f.id)

            Pages.query.delete()

        if data.get("notifications"):
            Notifications.query.delete()

        if data.get("challenges"):
            _challenges = Challenges.query.all()
            for c in _challenges:
                for f in c.files:
                    delete_file(file_id=f.id)
            Challenges.query.delete()

        if data.get("accounts"):
            Users.query.delete()
            Teams.query.delete()
            require_setup = True
            logout = True

        if data.get("submissions"):
            Solves.query.delete()
            Submissions.query.delete()
            Awards.query.delete()
            Unlocks.query.delete()
            Tracking.query.delete()

        if require_setup:
            set_config("setup", False)
            cache.clear()
            logout_user()
            next_url = url_for("views.setup")

        db.session.commit()

        # Audit: record what was wiped
        reset_scope = [k for k in ["pages", "notifications", "challenges", "accounts", "submissions"] if data.get(k)]
        log_audit(
            action="ctf_reset",
            data={"wiped_sections": reset_scope},
        )

        clear_pages()
        clear_standings()
        clear_challenges()
        clear_config()

        if logout is True:
            cache.clear()
            logout_user()

        db.session.close()
        return redirect(next_url)

    return render_template("admin/reset.html")
