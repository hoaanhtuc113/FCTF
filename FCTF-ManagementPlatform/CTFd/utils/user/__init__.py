import datetime  # noqa: I001
import re

from flask import abort
from flask import current_app as app
from flask import redirect, request, session, url_for

from CTFd.cache import cache, clear_user_session
from CTFd.constants.languages import Languages
from CTFd.constants.teams import TeamAttrs
from CTFd.constants.users import UserAttrs
from CTFd.models import Challenges, Fails, Teams, Tokens, Tracking, Users, db
from CTFd.utils import get_config
from CTFd.utils.security.auth import logout_user
from CTFd.utils.security.signing import hmac


def get_current_user():
    if authed():
        user = Users.query.filter_by(id=session["id"]).first()
        # Check if the session is still valid
        session_hash = session.get("hash")
        if session_hash:
            if session_hash != hmac(user.password):
                logout_user()
                if request.content_type == "application/json":
                    error = 401
                else:
                    error = redirect(url_for("auth.login", next=request.full_path))
                abort(error)

        return user
    else:
        return None


def get_current_user_attrs():
    if authed():
        try:
            return get_user_attrs(user_id=session["id"])
        except TypeError:
            clear_user_session(user_id=session["id"])
            return get_user_attrs(user_id=session["id"])
    else:
        return None


@cache.memoize(timeout=300)
def get_user_attrs(user_id):
    user = Users.query.filter_by(id=user_id).first()
    if user:
        d = {}
        for field in UserAttrs._fields:
            d[field] = getattr(user, field)
        return UserAttrs(**d)
    return None


@cache.memoize(timeout=300)
def get_user_place(user_id):
    user = Users.query.filter_by(id=user_id).first()
    if user:
        return user.account.place
    return None


@cache.memoize(timeout=300)
def get_user_score(user_id):
    user = Users.query.filter_by(id=user_id).first()
    if user:
        return user.account.score
    return None


@cache.memoize(timeout=300)
def get_team_place(team_id):
    team = Teams.query.filter_by(id=team_id).first()
    if team:
        return team.place
    return None


@cache.memoize(timeout=300)
def get_team_score(team_id):
    team = Teams.query.filter_by(id=team_id).first()
    if team:
        return team.score
    return None


def get_team_id_for_contest(user, contest_id):
    """Return the team_id for a user in a specific contest."""
    from CTFd.models import UserTeamMember, Teams
    if not user or not contest_id:
        return None
    utm = (
        UserTeamMember.query
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(UserTeamMember.user_id == user.id, Teams.contest_id == contest_id)
        .first()
    )
    return utm.team_id if utm else None


def get_team_for_contest(user, contest_id):
    """Return the Teams object for a user in a specific contest."""
    from CTFd.models import UserTeamMember, Teams
    if not user or not contest_id:
        return None
    utm = (
        UserTeamMember.query
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(UserTeamMember.user_id == user.id, Teams.contest_id == contest_id)
        .first()
    )
    return utm.team if utm else None


def get_current_team():
    return None


def get_current_team_attrs():
    # In multi-contest mode, team membership is per-contest via UserTeamMember.
    # Global team_id no longer exists on the user object.
    return None


@cache.memoize(timeout=300)
def get_team_attrs(team_id):
    team = Teams.query.filter_by(id=team_id).first()
    if team:
        d = {}
        for field in TeamAttrs._fields:
            d[field] = getattr(team, field)
        return TeamAttrs(**d)
    return None


def get_current_user_type(fallback=None):
    if authed():
        user = get_current_user_attrs()
        if user and user.type:
            return user.type
    else:
        return fallback


def authed():
    return bool(session.get("id", False))


def is_admin():
    if authed():
        user = get_current_user_attrs()
        if user and user.type:
            return user.type == "admin"
    else:
        return False


def is_challenge_writer():
    """True if the user is a challenge_writer — either platform-level (legacy
    user.type) or has at least one challenge_writer role in ContestParticipant."""
    if not authed():
        return False
    user = get_current_user_attrs()
    if not user:
        return False
    if user.type == "challenge_writer":
        return True
    from CTFd.models import ContestParticipant
    return db.session.query(ContestParticipant).filter_by(
        user_id=user.id, role="challenge_writer"
    ).first() is not None


def is_jury():
    """True if the user is jury — either platform-level (legacy user.type) or
    has at least one jury role in ContestParticipant."""
    if not authed():
        return False
    user = get_current_user_attrs()
    if not user:
        return False
    if user.type == "jury":
        return True
    from CTFd.models import ContestParticipant
    return db.session.query(ContestParticipant).filter_by(
        user_id=user.id, role="jury"
    ).first() is not None

def is_banned():
    auth_header = request.headers.get('Authorization', None)
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        token_auth = Tokens.query.filter_by(value=token).first()
        user= Users.query.filter_by(id=token_auth.user_id).first() if token_auth else None
        return user.banned 
    return False

def is_admin_or_challenge_writer_or_jury():
    return is_admin() or is_challenge_writer() or is_jury()


def get_user_role_in_contest(contest_id):
    """Return the current user's role in a specific contest.
    Returns 'admin', 'jury', 'challenge_writer', 'contestant', or None.
    Admin users always get 'admin' regardless of ContestParticipant rows."""
    if not authed():
        return None
    user = get_current_user_attrs()
    if not user:
        return None
    if user.type == "admin":
        return "admin"
    from CTFd.models import ContestParticipant
    p = db.session.query(ContestParticipant).filter_by(
        user_id=user.id, contest_id=contest_id
    ).first()
    return p.role if p else None


def is_verified():
    if get_config("verify_emails"):
        user = get_current_user_attrs()
        if user:
            return user.verified
        else:
            return False
    # If config doesn't specify to verify emails, then everyone is 'verified'
    else:
        return True


def get_ip(req=None):
    """Returns the IP address of the currently in scope request. The approach is to define a list of trusted proxies
    (in this case the local network), and only trust the most recently defined untrusted IP address.
    Taken from http://stackoverflow.com/a/22936947/4285524 but the generator there makes no sense.
    The trusted_proxies regexes is taken from Ruby on Rails.

    This has issues if the clients are also on the local network so you can remove proxies from config.py.

    CTFd does not use IP address for anything besides cursory tracking of teams and it is ill-advised to do much
    more than that if you do not know what you're doing.
    """
    if req is None:
        req = request
    trusted_proxies = app.config["TRUSTED_PROXIES"]
    combined = "(" + ")|(".join(trusted_proxies) + ")"
    route = req.access_route + [req.remote_addr]
    for addr in reversed(route):
        if not re.match(combined, addr):  # IP is not trusted but we trust the proxies
            remote_addr = addr
            break
    else:
        remote_addr = req.remote_addr
    return remote_addr


def get_locale():
    # Use the admin's default language (user-level language pref removed in multi-contest)
    default_locale = get_config("default_locale")
    if default_locale:
        return default_locale
    # Detect the user's browser specified language
    languages = Languages.values()
    return request.accept_languages.best_match(languages)


def get_current_user_recent_ips():
    if authed():
        return get_user_recent_ips(user_id=session["id"])
    else:
        return None


@cache.memoize(timeout=300)
def get_user_recent_ips(user_id):
    hour_ago = datetime.datetime.now() - datetime.timedelta(hours=1)
    addrs = (
        Tracking.query.with_entities(Tracking.ip.distinct())
        .filter(Tracking.user_id == user_id, Tracking.date >= hour_ago)
        .all()
    )
    return {ip for (ip,) in addrs}


def get_wrong_submissions_per_minute(account_id, contest_id=None):
    """
    Get incorrect submissions per minute, optionally scoped to a specific contest.

    :param account_id: The account (user or team) ID to check.
    :param contest_id: When provided, only count fails for challenges in this contest.
    :return: Number of failed submissions in the last 60 seconds.
    """
    one_min_ago = datetime.datetime.utcnow() + datetime.timedelta(minutes=-1)
    query = db.session.query(Fails).filter(
        Fails.account_id == account_id,
        Fails.date >= one_min_ago,
    )
    if contest_id is not None:
        query = query.join(
            Challenges, Challenges.id == Fails.challenge_id
        ).filter(Challenges.contest_id == contest_id)
    return query.count()
