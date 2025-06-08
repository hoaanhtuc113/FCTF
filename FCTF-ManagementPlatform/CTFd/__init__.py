import asyncio
import datetime
import os
import sys, inspect
import threading
import time
import weakref
from distutils.version import StrictVersion
from flask_socketio import SocketIO, emit
from flask_caching import Cache
import jinja2
from flask import Flask, Request, request
from flask_babel import Babel
from flask_migrate import upgrade
from jinja2 import FileSystemLoader
from jinja2.sandbox import SandboxedEnvironment
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import safe_join
from flask_cors import CORS
import CTFd.utils.config
from CTFd import utils
from CTFd.constants.themes import ADMIN_THEME, DEFAULT_THEME
from CTFd.plugins import init_plugins
from CTFd.utils.crypto import sha256
from CTFd.utils.initialization import (
    init_cli,
    init_events,
    init_logs,
    init_request_processors,
    init_template_filters,
    init_template_globals,
)
from CTFd.utils.migrations import create_database, migrations, stamp_latest_revision
from CTFd.utils.sessions import CachingSessionInterface
from CTFd.utils.updates import update_check
from CTFd.utils.user import get_locale

__version__ = "3.7.3"
__channel__ = "oss"
socketio = SocketIO(cors_allowed_origins="*")
user_sessions = {}


class CTFdRequest(Request):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        """
        Hijack the original Flask request path because it does not account for subdirectory deployments in an intuitive
        manner. We append script_root so that the path always points to the full path as seen in the browser.
        e.g. /subdirectory/path/route vs /path/route
        """
        self.path = self.script_root + self.path


class CTFdFlask(Flask):
    def __init__(self, *args, **kwargs):
        """Overriden Jinja constructor setting a custom jinja_environment"""
        self.jinja_environment = SandboxedBaseEnvironment
        self.session_interface = CachingSessionInterface(key_prefix="session")
        self.request_class = CTFdRequest

        # Store server start time
        self.start_time = datetime.datetime.utcnow()

        # Create generally unique run identifier
        self.run_id = sha256(str(self.start_time))[0:8]
        Flask.__init__(self, *args, **kwargs)

    def create_jinja_environment(self):
        """Overridden jinja environment constructor"""
        return super(CTFdFlask, self).create_jinja_environment()


class SandboxedBaseEnvironment(SandboxedEnvironment):
    """SandboxEnvironment that mimics the Flask BaseEnvironment"""

    def __init__(self, app, **options):
        if "loader" not in options:
            options["loader"] = app.create_global_jinja_loader()
        SandboxedEnvironment.__init__(self, **options)
        self.app = app

    def _load_template(self, name, globals):
        if self.loader is None:
            raise TypeError("no loader for this environment specified")

        # Add theme to the LRUCache cache key
        cache_name = name
        if name.startswith("admin/") is False:
            theme = str(utils.get_config("ctf_theme"))
            cache_name = theme + "/" + name

        # Rest of this code roughly copied from Jinja
        # https://github.com/pallets/jinja/blob/b08cd4bc64bb980df86ed2876978ae5735572280/src/jinja2/environment.py#L956-L973
        cache_key = (weakref.ref(self.loader), cache_name)
        if self.cache is not None:
            template = self.cache.get(cache_key)
            if template is not None and (
                not self.auto_reload or template.is_up_to_date
            ):
                # template.globals is a ChainMap, modifying it will only
                # affect the template, not the environment globals.
                if globals:
                    template.globals.update(globals)

                return template

        template = self.loader.load(self, name, self.make_globals(globals))

        if self.cache is not None:
            self.cache[cache_key] = template
        return template


class ThemeLoader(FileSystemLoader):
    """Custom FileSystemLoader that is aware of theme structure and config."""

    DEFAULT_THEMES_PATH = os.path.join(os.path.dirname(__file__), "themes")
    _ADMIN_THEME_PREFIX = ADMIN_THEME + "/"

    def __init__(
        self,
        searchpath=DEFAULT_THEMES_PATH,
        theme_name=None,
        encoding="utf-8",
        followlinks=False,
    ):
        super(ThemeLoader, self).__init__(searchpath, encoding, followlinks)
        self.theme_name = theme_name

    def get_source(self, environment, template):
        # Refuse to load `admin/*` from a loader not for the admin theme
        # Because there is a single template loader, themes can essentially
        # provide files for other themes. This could end up causing issues if
        # an admin theme references a file that doesn't exist that a malicious
        # theme provides.
        if template.startswith(self._ADMIN_THEME_PREFIX):
            if self.theme_name != ADMIN_THEME:
                raise jinja2.TemplateNotFound(template)
            template = template[len(self._ADMIN_THEME_PREFIX) :]
        theme_name = self.theme_name or str(utils.get_config("ctf_theme"))
        template = safe_join(theme_name, "templates", template)
        return super(ThemeLoader, self).get_source(environment, template)


def confirm_upgrade():
    if sys.stdin.isatty():
        print("/*\\ CTFd has updated and must update the database! /*\\")
        print("/*\\ Please backup your database before proceeding! /*\\")
        print("/*\\ CTFd maintainers are not responsible for any data loss! /*\\")
        if input("Run database migrations (Y/N)").lower().strip() == "y":  # nosec B322
            return True
        else:
            print("/*\\ Ignored database migrations... /*\\")
            return False
    else:
        return True


def run_upgrade():

    upgrade()
    utils.set_config("ctf_version", __version__)


def create_app(config="CTFd.config.Config"):
    app = CTFdFlask(__name__)
    # Lấy thông tin dòng và file hiện tại
    current_frame = inspect.currentframe()
    current_line = current_frame.f_lineno
    current_file = inspect.getfile(current_frame)

    print(f"File: {current_file}, current_line: {current_line}")
    with app.app_context():

        app.config.from_object(config)
        app.config["CACHE_TYPE"] = "redis"
        app.config["CACHE_REDIS_URL"] = os.getenv("REDIS_URL", "redis://localhost:6379")
        cache = Cache(app)

        from CTFd.cache import cache
        from CTFd.utils import import_in_progress
        from CTFd.utils.maps import (
            add_character_to_map,
            characters_on_map,
            remove_character_from_map,
            handle_request_all_characters,
        )
        from datetime import datetime

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        socketio.init_app(app)
        cache.init_app(app)
        app.cache = cache

        # If we are importing we should pause startup until the import is finished
        while import_in_progress():
            print("Import currently in progress, CTFd startup paused for 5 seconds")
            time.sleep(5)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        socketio.init_app(app)
        loaders = []
        # We provide a `DictLoader` which may be used to override templates
        app.overridden_templates = {}
        loaders.append(jinja2.DictLoader(app.overridden_templates))
        # A `ThemeLoader` with no `theme_name` will load from the current theme

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        socketio.init_app(app)

        loaders.append(ThemeLoader())
        # If `THEME_FALLBACK` is set and true, we add another loader which will
        # load from the `DEFAULT_THEME` - this mirrors the order implemented by
        # `config.ctf_theme_candidates()`
        if bool(app.config.get("THEME_FALLBACK")):
            loaders.append(ThemeLoader(theme_name=DEFAULT_THEME))
        # All themes including admin can be accessed by prefixing their name
        prefix_loader_dict = {ADMIN_THEME: ThemeLoader(theme_name=ADMIN_THEME)}
        for theme_name in CTFd.utils.config.get_themes():
            prefix_loader_dict[theme_name] = ThemeLoader(theme_name=theme_name)
        loaders.append(jinja2.PrefixLoader(prefix_loader_dict))
        # Plugin templates are also accessed via prefix but we just point a
        # normal `FileSystemLoader` at the plugin tree rather than validating
        # each plugin here (that happens later in `init_plugins()`). We
        # deliberately don't add this to `prefix_loader_dict` defined above
        # because to do so would break template loading from a theme called
        # `prefix` (even though that'd be weird).
        plugin_loader = jinja2.FileSystemLoader(
            searchpath=os.path.join(app.root_path, "plugins"), followlinks=True
        )
        loaders.append(jinja2.PrefixLoader({"plugins": plugin_loader}))
        # Use a choice loader to find the first match from our list of loaders
        app.jinja_loader = jinja2.ChoiceLoader(loaders)

        from CTFd.models import (  # noqa: F401
            Challenges,
            Fails,
            Files,
            Flags,
            Solves,
            Tags,
            Teams,
            Tracking,
            db,
        )

        url = create_database()

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        # This allows any changes to the SQLALCHEMY_DATABASE_URI to get pushed back in
        # This is mostly so we can force MySQL's charset
        app.config["SQLALCHEMY_DATABASE_URI"] = str(url)

        # Register database
        db.init_app(app)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        # Register Flask-Migrate
        migrations.init_app(app, db)

        babel = Babel()
        babel.locale_selector_func = get_locale
        babel.init_app(app)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        # Alembic sqlite support is lacking so we should just create_all anyway
        if url.drivername.startswith("sqlite"):
            # Enable foreign keys for SQLite. This must be before the
            # db.create_all call because tests use the in-memory SQLite
            # database (each connection, including db creation, is a new db).
            # https://docs.sqlalchemy.org/en/13/dialects/sqlite.html#foreign-key-support
            from sqlalchemy import event
            from sqlalchemy.engine import Engine

            @event.listens_for(Engine, "connect")
            def set_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

            db.create_all()
            stamp_latest_revision()
        else:
            # This creates tables instead of db.create_all()
            # Allows migrations to happen properly
            upgrade()

        from CTFd.models import ma

        ma.init_app(app)

        app.db = db
        app.VERSION = __version__
        app.CHANNEL = __channel__

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        reverse_proxy = app.config.get("REVERSE_PROXY")
        if reverse_proxy:
            if type(reverse_proxy) is str and "," in reverse_proxy:
                proxyfix_args = [int(i) for i in reverse_proxy.split(",")]
                app.wsgi_app = ProxyFix(app.wsgi_app, *proxyfix_args)
            else:
                app.wsgi_app = ProxyFix(
                    app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1
                )

        version = utils.get_config("ctf_version")

        # Upgrading from an older version of CTFd
        if version and (StrictVersion(version) < StrictVersion(__version__)):
            if confirm_upgrade():
                run_upgrade()
            else:
                exit()

        if not version:
            utils.set_config("ctf_version", __version__)

        if not utils.get_config("ctf_theme"):
            utils.set_config("ctf_theme", "core-beta")

        update_check(force=True)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")

        init_request_processors(app)
        init_template_filters(app)
        init_template_globals(app)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        # Importing here allows tests to use sensible names (e.g. api instead of api_bp)
        from CTFd.admin import admin
        from CTFd.api import api
        from CTFd.auth import auth
        from CTFd.challenges import challenges
        from CTFd.errors import render_error
        from CTFd.events import events
        from CTFd.scoreboard import scoreboard
        from CTFd.share import social
        from CTFd.teams import teams
        from CTFd.users import users
        from CTFd.views import views
        from CTFd.StartChallenge import challenge
        from CTFd.SendTicket import sendticket
        from CTFd.DeployHistory import challengeHistory
        from CTFd.loginApi import LoginUser
        from CTFd.ManageInstances import ManageInstance
        from CTFd.getTimeFromConfig import get_date_config
        from CTFd.registrationConfig import get_registration_config

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        app.register_blueprint(views)
        app.register_blueprint(teams)
        app.register_blueprint(users)
        app.register_blueprint(challenges)
        app.register_blueprint(scoreboard)
        app.register_blueprint(auth)
        app.register_blueprint(api)
        app.register_blueprint(events)
        app.register_blueprint(social)
        app.register_blueprint(challenge)
        app.register_blueprint(sendticket)
        app.register_blueprint(challengeHistory)
        app.register_blueprint(LoginUser)
        app.register_blueprint(admin)
        app.register_blueprint(ManageInstance)
        app.register_blueprint(get_date_config)
        app.register_blueprint(get_registration_config)

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")

        # Lấy thông tin dòng và file hiện tại
        current_frame = inspect.currentframe()
        current_line = current_frame.f_lineno
        current_file = inspect.getfile(current_frame)

        print(f"File: {current_file}, current_line: {current_line}")
        for code in {403, 404, 500, 502}:
            app.register_error_handler(code, render_error)

        init_logs(app)
        init_events(app)
        init_plugins(app)
        init_cli(app)

        @socketio.on("connect")
        def handle_connect():
            print(f"Client connected - SID: {request.sid}")
            print(f"Auth token: {request.headers.get('Authorization')}")
            print(f"Query params: {request.args}")
            emit("connection-response", {"status": "connected"})
            handle_request_all_characters()

        @socketio.on("disconnect")
        def handle_disconnect():
            for user_id, sid in list(user_sessions.items()):
                if sid == request.sid:
                    del user_sessions[user_id]
                    print(f"User {user_id} disconnected")
                    break

        @socketio.on("login")
        def handle_login(data):
            try:
                user_id = data.get("id")
                if not user_id:
                    emit("login-error", {"error": "Missing user ID"}, room=request.sid)
                    return

                if user_id in user_sessions:
                    old_sid = user_sessions[user_id]
                    emit(
                        "force-logout",
                        {"message": "Bạn đã đăng nhập trên thiết bị khác."},
                        room=old_sid,
                    )
                    print(f"Force logout user {user_id} from session {old_sid}")

                user_sessions[user_id] = request.sid
                print(f"User {user_id} logged in on {request.sid}")

                character_data = {
                    "id": user_id,
                    "name": data.get("name"),
                    "team": data.get("team", "No team"),
                    "position": data.get("position", {}),
                }
                add_result = add_character_to_map(character_data)

                if add_result["status"] != "success":
                    emit("login-error", {"error": add_result["message"]})
                    return

                emit(
                    "login-success",
                    {
                        "status": "success",
                        "message": "Đăng nhập thành công",
                        "user_id": user_id,
                        "character": add_result["data"],
                    },
                )

                emit(
                    "user-login-notification",
                    {
                        "id": user_id,
                        "name": data.get("name"),
                        "team": data.get("team", "No team"),
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "date": datetime.now().strftime("%Y-%m-%d"),
                    },
                    broadcast=True,
                    namespace="/",
                )

            except Exception as e:
                print(f"Login error: {str(e)}")
                emit("login-error", {"error": str(e)})

        @socketio.on("logout")
        def handle_logout(data):
            try:
                user_id = data.get("userId")
                if not user_id:
                    return {"status": "error", "message": "Missing user ID"}

                if user_id in user_sessions:
                    del user_sessions.pop[user_id]

                remove_result = remove_character_from_map(user_id)

                if remove_result["status"] != "success":
                    print(
                        f"Failed to remove character for user {user_id}: {remove_result.get('message')}"
                    )

            except Exception as e:
                print(f"Logout error: {str(e)}")
                return {"status": "error", "message": str(e)}

        return app


if __name__ == "__main__":
    app = create_app()
    CORS(app)
