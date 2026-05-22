import os  # noqa: I001

from flask import Blueprint, abort
from flask import current_app as app
from flask import (
    make_response,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import safe_join

from CTFd.cache import cache
from CTFd.constants.config import ConfigTypes
from CTFd.constants.themes import DEFAULT_THEME
from CTFd.models import (
    Admins,
    Contests,
    Files,
    Teams,
    Users,
    UserTokens,
    db,
)
from CTFd.utils import config, get_config, set_config
from CTFd.utils import user as current_user
from CTFd.utils.config import is_setup, is_teams_mode
from CTFd.utils.config.visibility import challenges_visible
from CTFd.utils.dates import ctf_ended, ctftime, view_after_ctf
from CTFd.utils.decorators import authed_only
from CTFd.utils.email import (
    DEFAULT_PASSWORD_RESET_BODY,
    DEFAULT_PASSWORD_RESET_SUBJECT,
    DEFAULT_SUCCESSFUL_REGISTRATION_EMAIL_BODY,
    DEFAULT_SUCCESSFUL_REGISTRATION_EMAIL_SUBJECT,
    DEFAULT_USER_CREATION_EMAIL_BODY,
    DEFAULT_USER_CREATION_EMAIL_SUBJECT,
    DEFAULT_VERIFICATION_EMAIL_BODY,
    DEFAULT_VERIFICATION_EMAIL_SUBJECT,
)
from CTFd.utils.health import check_config, check_database
from CTFd.utils.helpers import get_errors, get_infos, markup
from CTFd.utils.modes import TEAMS_MODE
from CTFd.utils.security.signing import (
    BadSignature,
    BadTimeSignature,
    SignatureExpired,
    unserialize,
)
from CTFd.utils.uploads import get_uploader
from CTFd.utils.user import authed, get_current_team, get_current_user, get_ip

views = Blueprint("views", __name__)


@views.route("/teams/invite", methods=["GET", "POST"])
def team_invite():
    """
    Public endpoint for contestants to join a team via invite link.
    Contestants must provide their own username and password to verify identity before joining.
    """
    from CTFd.exceptions import TeamTokenExpiredException, TeamTokenInvalidException
    from CTFd.utils.crypto import verify_password

    code = request.args.get("code", "").strip()

    errors = []
    team = None

    # Validate the invite code first
    if not code:
        errors.append("Invalid or missing invite code.")
    else:
        try:
            team = Teams.load_invite_code(code)
        except TeamTokenExpiredException:
            errors.append("This invite link has expired. Please ask the admin for a new one.")
        except TeamTokenInvalidException:
            errors.append("This invite link is invalid.")

    if request.method == "GET":
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    # POST - process credentials
    if errors or team is None:
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    if not username or not password:
        errors.append("Username and password are required.")
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    user = Users.query.filter_by(name=username).first()
    
    # Custom verification logic for Contestant Portal's $bcrypt-sha256$v=2 format
    # Using bcrypt library directly to avoid passlib 1.7.4 + bcrypt 4.x initialization bugs
    def verify_contestant_password(plaintext, hash_str):
        import hmac
        import hashlib
        import base64
        import re
        import bcrypt

        if not hash_str:
            return False
            
        if hash_str.startswith("$bcrypt-sha256$v=2"):
            try:
                # Format: $bcrypt-sha256$v=2,t=2b,r=10$<salt22>$<digest31> (C# format)
                # OR $bcrypt-sha256$v=2,t=2b,r=10$<salt22><digest31> (standard passlib format)
                # The '$' between salt and digest is optional to support both formats
                pattern = r"\$bcrypt-sha256\$v=2,t=(?P<type>2[ab]),r=(?P<rounds>\d{1,2})\$(?P<salt>[./A-Za-z0-9]{22})\$?(?P<digest>[./A-Za-z0-9]{31})$"
                match = re.match(pattern, hash_str)
                if not match:
                    return False
                    
                groups = match.groupdict()
                t = groups["type"]
                r = int(groups["rounds"])
                salt22 = groups["salt"]
                digest31 = groups["digest"]
                
                # Reconstruct standard bcrypt hash for bcrypt.checkpw: $2b$10$SALT22DIGEST31
                inner_bcrypt_hash = f"${t}${r:02d}${salt22}{digest31}".encode("ascii")
                
                # v2 pre-hash uses HMAC-SHA256 (key=salt22, msg=plaintext)
                h = hmac.new(salt22.encode("ascii"), plaintext.encode("utf-8"), hashlib.sha256)
                prehashed_base64 = base64.b64encode(h.digest())
                
                return bcrypt.checkpw(prehashed_base64, inner_bcrypt_hash)
            except Exception:
                return False
        else:
            # Fallback for other formats
            try:
                return verify_password(plaintext, hash_str)
            except Exception:
                return False

    valid_password = verify_contestant_password(password, user.password if user else None)

    if user is None or valid_password is False:
        errors.append("Invalid username or password.")
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    if user.verified is False:
        errors.append("Your account must be verified before joining a team.")
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    if user.team_id is not None:
        if user.team_id == team.id:
            errors.append("You are already a member of this team.")
        else:
            errors.append("You are already in another team. Please contact an admin.")
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    if team.banned:
        errors.append("This team has been banned.")
        return render_template(
            "teams/invite.html",
            team=team,
            code=code,
            errors=errors,
        )

    team_name = team.name
    team.members.append(user)
    db.session.commit()

    return render_template(
        "teams/invite_success.html",
        team_name=team_name,
    )


def auto_initialize():
    """Auto-initialize the platform on first deploy without a setup wizard.

    Creates the default admin account and sets platform-level config.
    Contest-specific settings (start/end time, team limits, etc.) are
    configured per-contest and are NOT set here.
    """
    set_config("ctf_name", "F-CTF")
    set_config("ctf_description", "Welcome to F-CTF — the multi-contest hacking platform.")
    set_config("ctf_theme", DEFAULT_THEME)
    set_config("user_mode", TEAMS_MODE)

    set_config("mail_server", None)
    set_config("mail_port", None)
    set_config("mail_tls", None)
    set_config("mail_ssl", None)
    set_config("mail_username", None)
    set_config("mail_password", None)
    set_config("mail_useauth", None)

    set_config("verification_email_subject", DEFAULT_VERIFICATION_EMAIL_SUBJECT)
    set_config("verification_email_body", DEFAULT_VERIFICATION_EMAIL_BODY)
    set_config("successful_registration_email_subject", DEFAULT_SUCCESSFUL_REGISTRATION_EMAIL_SUBJECT)
    set_config("successful_registration_email_body", DEFAULT_SUCCESSFUL_REGISTRATION_EMAIL_BODY)
    set_config("user_creation_email_subject", DEFAULT_USER_CREATION_EMAIL_SUBJECT)
    set_config("user_creation_email_body", DEFAULT_USER_CREATION_EMAIL_BODY)
    set_config("password_reset_subject", DEFAULT_PASSWORD_RESET_SUBJECT)
    set_config("password_reset_body", DEFAULT_PASSWORD_RESET_BODY)
    set_config("password_change_alert_subject", "Password Change Confirmation for {ctf_name}")
    set_config(
        "password_change_alert_body",
        (
            "Your password for {ctf_name} has been changed.\n\n"
            "If you didn't request a password change you can reset your password here: {url}"
        ),
    )

    set_config("captain_only_start_challenge", 1)
    set_config("captain_only_submit_challenge", 0)
    set_config("limit_challenges", 3)

    existing = Users.query.filter_by(name="adminmultiple").first()
    if not existing:
        admin = Admins(
            name="adminmultiple",
            email="admin@fctf.local",
            password="1",
            type="admin",
            hidden=True,
            verified=True,
        )
        try:
            db.session.add(admin)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()

    set_config("setup", True)
    cache.clear()


@views.route("/settings", methods=["GET"])
@authed_only
def settings():
    infos = get_infos()
    errors = get_errors()

    user = get_current_user()

    if is_teams_mode() and get_current_team() is None:
        infos.append(
            markup(
                'In order to participate you must either join or create a team.'
            )
        )

    tokens = UserTokens.query.filter_by(user_id=user.id).all()

    prevent_name_change = get_config("prevent_name_change")

    if get_config("verify_emails") and not user.verified:
        confirm_url = markup(url_for("auth.confirm"))
        infos.append(
            markup(
                "Your email address isn't confirmed!<br>"
                "Please check your email to confirm your email address.<br><br>"
                f'To have the confirmation email resent please <a href="{confirm_url}">click here</a>.'
            )
        )

    return render_template(
        "settings.html",
        name=user.name,
        email=user.email,
        language=user.language,
        website=user.website,
        affiliation=user.affiliation,
        country=user.country,
        tokens=tokens,
        prevent_name_change=prevent_name_change,
        infos=infos,
        errors=errors,
    )


@views.route("/contests", methods=["GET"])
@authed_only
def contests_list():
    import datetime as dt
    now = dt.datetime.utcnow()
    contests = Contests.query.filter(
        Contests.state.in_(["active", "paused", "ended"])
    ).order_by(Contests.start_time.asc()).all()

    # Build a list with extra computed props per contest
    contest_data = []
    for c in contests:
        status = "upcoming"
        if c.start_time and c.end_time:
            if now < c.start_time:
                status = "upcoming"
            elif now > c.end_time:
                status = "ended"
            else:
                status = "running"
        elif c.state == "ended":
            status = "ended"
        elif c.state == "active":
            status = "running"

        contest_data.append({
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "slug": c.slug,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "state": c.state,
            "status": status,
            "user_mode": c.user_mode,
            "team_size": c.team_size,
        })

    return render_template("contests.html", contests=contest_data, now=now)


@views.route("/")
def static_html():
    """Root route: auto-initialize on first deploy, then redirect to login."""
    if is_setup() is False:
        auto_initialize()
    return redirect(url_for("auth.login"))


@views.route("/files", defaults={"path": ""})
@views.route("/files/<path:path>")
def files(path):
    """
    Route in charge of dealing with making sure that CTF challenges are only accessible during the competition.
    :param path:
    :return:
    """
    f = Files.query.filter_by(location=path).first_or_404()
    if f.type == "challenge":
        if challenges_visible():
            if current_user.is_admin() is False:
                if not ctftime():
                    if ctf_ended() and view_after_ctf():
                        pass
                    else:
                        abort(403)
        else:
            # User cannot view challenges based on challenge visibility
            # e.g. ctf requires registration but user isn't authed or
            # ctf requires admin account but user isn't admin
            if not ctftime():
                # It's not CTF time. The only edge case is if the CTF is ended
                # but we have view_after_ctf enabled
                if ctf_ended() and view_after_ctf():
                    pass
                else:
                    # In all other situations we should block challenge files
                    abort(403)

            # Allow downloads if a valid token is provided
            token = request.args.get("token", "")
            try:
                data = unserialize(token, max_age=3600)
                user_id = data.get("user_id")
                team_id = data.get("team_id")
                file_id = data.get("file_id")
                user = Users.query.filter_by(id=user_id).first()
                team = Teams.query.filter_by(id=team_id).first()

                # Check user is admin if challenge_visibility is admins only
                if (
                    get_config(ConfigTypes.CHALLENGE_VISIBILITY) == "admins"
                    and user.type != "admin"
                ):
                    abort(403)

                # Check that the user exists and isn't banned
                if user:
                    if user.banned:
                        abort(403)
                else:
                    abort(403)

                # Check that the team isn't banned
                if team:
                    if team.banned:
                        abort(403)
                else:
                    pass

                # Check that the token properly refers to the file
                if file_id != f.id:
                    abort(403)

            # The token isn't expired or broken
            except (BadTimeSignature, SignatureExpired, BadSignature):
                abort(403)

    uploader = get_uploader()
    try:
        return uploader.download(f.location)
    except IOError:
        abort(404)


@views.route("/themes/<theme>/static/<path:path>")
def themes(theme, path):
    """
    General static file handler
    :param theme:
    :param path:
    :return:
    """
    for cand_path in (
        safe_join(app.root_path, "themes", cand_theme, "static", path)
        # The `theme` value passed in may not be the configured one, e.g. for
        # admin pages, so we check that first
        for cand_theme in (theme, *config.ctf_theme_candidates())
    ):
        # Handle werkzeug behavior of returning None on malicious paths
        if cand_path is None:
            abort(404)
        if os.path.isfile(cand_path):
            return send_file(cand_path, max_age=3600)
    abort(404)


@views.route("/themes/<theme>/static/<path:path>")
def themes_beta(theme, path):
    """
    This is a copy of the above themes route used to avoid
    the current appending of .dev and .min for theme assets.

    In CTFd 4.0 this url_for behavior and this themes_beta
    route will be removed.
    """
    for cand_path in (
        safe_join(app.root_path, "themes", cand_theme, "static", path)
        # The `theme` value passed in may not be the configured one, e.g. for
        # admin pages, so we check that first
        for cand_theme in (theme, *config.ctf_theme_candidates())
    ):
        # Handle werkzeug behavior of returning None on malicious paths
        if cand_path is None:
            abort(404)
        if os.path.isfile(cand_path):
            return send_file(cand_path, max_age=3600)
    abort(404)


@views.route("/healthcheck")
def healthcheck():
    if check_database() is False:
        return "ERR", 500
    if check_config() is False:
        return "ERR", 500
    return "OK", 200


@views.route("/debug")
def debug():
    if app.config.get("SAFE_MODE") is True:
        ip = get_ip()
        headers = dict(request.headers)
        # Remove Cookie item
        headers.pop("Cookie", None)
        resp = ""
        resp += f"IP: {ip}\n"
        for k, v in headers.items():
            resp += f"{k}: {v}\n"
        r = make_response(resp)
        r.mimetype = "text/plain"
        return r
    abort(404)


