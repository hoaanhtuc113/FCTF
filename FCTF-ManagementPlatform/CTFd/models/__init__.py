import datetime
from collections import defaultdict

from flask_marshmallow import Marshmallow
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import column_property, validates

from CTFd.cache import cache

db = SQLAlchemy()
ma = Marshmallow()


def get_class_by_tablename(tablename):
    """Return class reference mapped to table.
    https://stackoverflow.com/a/66666783

    :param tablename: String with name of table.
    :return: Class reference or None.
    """
    classes = []
    for m in db.Model.registry.mappers:
        c = m.class_
        if hasattr(c, "__tablename__") and c.__tablename__ == tablename:
            classes.append(c)

    # We didn't find this class
    if len(classes) == 0:
        return None
    # This is a class where we have only one possible candidate.
    # It's either a top level class or a polymorphic class with a specific hardcoded table name
    elif len(classes) == 1:
        return classes[0]
    # In this case we are dealing with a polymorphic table where all of the tables have the same table name.
    # However for us to identify the parent class we can look for the class that defines the polymorphic_on arg
    else:
        for c in classes:
            mapper_args = dict(c.__mapper_args__)
            if mapper_args.get("polymorphic_on") is not None:
                return c


@compiles(db.DateTime, "mysql")
def compile_datetime_mysql(_type, _compiler, **kw):
    """
    This decorator makes the default db.DateTime class always enable fsp to enable millisecond precision
    https://dev.mysql.com/doc/refman/5.7/en/fractional-seconds.html
    https://docs.sqlalchemy.org/en/14/core/custom_types.html#overriding-type-compilation
    """
    return "DATETIME(6)"


class Notifications(db.Model):
    __tablename__ = "notifications"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id"))

    user = db.relationship("Users", foreign_keys="Notifications.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Notifications.team_id", lazy="select")

    @property
    def html(self):
        from CTFd.utils.config.pages import build_markdown
        from CTFd.utils.helpers import markup

        return markup(build_markdown(self.content))

    def __init__(self, *args, **kwargs):
        super(Notifications, self).__init__(**kwargs)


class Pages(db.Model):
    __tablename__ = "pages"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(80))
    route = db.Column(db.String(128), unique=True)
    content = db.Column(db.Text)
    draft = db.Column(db.Boolean)
    hidden = db.Column(db.Boolean)
    auth_required = db.Column(db.Boolean)
    format = db.Column(db.String(80), default="markdown")
    link_target = db.Column(db.String(80), nullable=True)

    files = db.relationship("PageFiles", backref="page")

    @property
    def html(self):
        from CTFd.utils.config.pages import build_html, build_markdown

        if self.format == "markdown":
            return build_markdown(self.content)
        elif self.format == "html":
            return build_html(self.content)
        else:
            return build_markdown(self.content)

    def __init__(self, *args, **kwargs):
        super(Pages, self).__init__(**kwargs)

    def __repr__(self):
        return "<Pages {0}>".format(self.route)


class Challenges(db.Model):
    __tablename__ = "challenges"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80))
    description = db.Column(db.Text)
    connection_info = db.Column(db.Text)
    next_id = db.Column(db.Integer, db.ForeignKey("challenges.id", ondelete="SET NULL"))
    max_attempts = db.Column(db.Integer, default=0)
    value = db.Column(db.Integer)
    category = db.Column(db.String(80))
    type = db.Column(db.String(80))
    state = db.Column(db.String(80), nullable=False, default="visible")
    requirements = db.Column(db.JSON)
    time_limit = db.Column(db.Integer, nullable=True)
    time_finished = db.Column(db.DateTime, nullable=True)
    start_time = db.Column(db.DateTime, nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    require_deploy = db.Column(db.Boolean, nullable=False, default=False)
    deploy_status = db.Column(db.Text, nullable=True, default="CREATED")
    last_update = db.Column(db.DateTime)
    image_link = db.Column(db.Text,nullable =True)

    files = db.relationship("ChallengeFiles", backref="challenge")
    tags = db.relationship("Tags", backref="challenge")
    hints = db.relationship("Hints", backref="challenge")
    flags = db.relationship("Flags", backref="challenge")
    comments = db.relationship("ChallengeComments", backref="challenge")
    topics = db.relationship("ChallengeTopics", backref="challenge")
    class alt_defaultdict(defaultdict):
        """
        This slightly modified defaultdict is intended to allow SQLAlchemy to
        not fail when querying Challenges that contain a missing challenge type.

        e.g. Challenges.query.all() should not fail if `type` is `a_missing_type`
        """

        def __missing__(self, key):
            return self["standard"]

    __mapper_args__ = {
        "polymorphic_identity": "standard",
        "polymorphic_on": type,
        "_polymorphic_map": alt_defaultdict(),
    }

    @property
    def html(self):
        from CTFd.utils.config.pages import build_markdown
        from CTFd.utils.helpers import markup

        return markup(build_markdown(self.description))

    @property
    def plugin_class(self):
        from CTFd.plugins.challenges import get_chal_class

        return get_chal_class(self.type)

    def __init__(self, *args, **kwargs):
        super(Challenges, self).__init__(**kwargs)

    def __repr__(self):
        return "<Challenge %r>" % self.name

class Tickets(db.Model):
    tablename = "tickets"
    id = db.Column(db.Integer, primary_key=True)
    author_id = db.Column(db.Integer, db.ForeignKey(
        "users.id", ondelete="CASCADE"))
    title = db.Column(db.String(255))
    type = db.Column(db.String(80))
    description = db.Column(db.Text)
    replier_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    replier_message = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(80), default="open")
    create_at= db.Column(db.DateTime, default= datetime.datetime.now())
class Hints(db.Model):
    __tablename__ = "hints"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(80), default="standard")
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    content = db.Column(db.Text)
    cost = db.Column(db.Integer, default=0)
    requirements = db.Column(db.JSON)

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    @property
    def name(self):
        return "Hint {id}".format(id=self.id)

    @property
    def category(self):
        return self.__tablename__

    @property
    def description(self):
        return "Hint for {name}".format(name=self.challenge.name)

    @property
    def html(self):
        from CTFd.utils.config.pages import build_markdown
        from CTFd.utils.helpers import markup

        return markup(build_markdown(self.content))

    @property
    def prerequisites(self):
        if self.requirements:
            return self.requirements.get("prerequisites", [])
        return []

    def __init__(self, *args, **kwargs):
        super(Hints, self).__init__(**kwargs)

    def __repr__(self):
        return "<Hint %r>" % self.content


class DeployedChallenge(db.Model):
    __tablename__ = "deploy_histories"
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    challenge_id = db.Column(db.Integer, db.ForeignKey("challenges.id"), nullable=False)
    log_content = db.Column(db.Text, nullable=True)
    deploy_status = db.Column(db.String(50), nullable=False, default="null")
    deploy_at = db.Column(db.DateTime, nullable=True)
    # Relationship with the User model
    challenge = db.relationship(
        "Challenges", backref=db.backref("deploy_histories", lazy=True)
    )


class Awards(db.Model):
    __tablename__ = "awards"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    type = db.Column(db.String(80), default="standard")
    name = db.Column(db.String(80))
    description = db.Column(db.Text)
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    value = db.Column(db.Integer)
    category = db.Column(db.String(80))
    icon = db.Column(db.Text)
    requirements = db.Column(db.JSON)

    user = db.relationship("Users", foreign_keys="Awards.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Awards.team_id", lazy="select")

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        elif user_mode == "users":
            return self.user_id

    def __init__(self, *args, **kwargs):
        super(Awards, self).__init__(**kwargs)

    def __repr__(self):
        return "<Award %r>" % self.name


class Tags(db.Model):
    __tablename__ = "tags"
    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    value = db.Column(db.String(80))

    def __init__(self, *args, **kwargs):
        super(Tags, self).__init__(**kwargs)


class Topics(db.Model):
    __tablename__ = "topics"
    id = db.Column(db.Integer, primary_key=True)
    value = db.Column(db.String(255), unique=True)

    def __init__(self, *args, **kwargs):
        super(Topics, self).__init__(**kwargs)


class ChallengeTopics(db.Model):
    __tablename__ = "challenge_topics"
    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    topic_id = db.Column(db.Integer, db.ForeignKey("topics.id", ondelete="CASCADE"))

    topic = db.relationship(
        "Topics", foreign_keys="ChallengeTopics.topic_id", lazy="select"
    )

    def __init__(self, *args, **kwargs):
        super(ChallengeTopics, self).__init__(**kwargs)


class Files(db.Model):
    __tablename__ = "files"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(80), default="standard")
    location = db.Column(db.Text)
    sha1sum = db.Column(db.String(40))

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Files, self).__init__(**kwargs)

    def __repr__(self):
        return "<File type={type} location={location}>".format(
            type=self.type, location=self.location
        )


class ChallengeFiles(Files):
    __mapper_args__ = {"polymorphic_identity": "challenge"}
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )

    def __init__(self, *args, **kwargs):
        super(ChallengeFiles, self).__init__(**kwargs)


class PageFiles(Files):
    __mapper_args__ = {"polymorphic_identity": "page"}
    page_id = db.Column(db.Integer, db.ForeignKey("pages.id"))

    def __init__(self, *args, **kwargs):
        super(PageFiles, self).__init__(**kwargs)


class Flags(db.Model):
    __tablename__ = "flags"
    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    type = db.Column(db.String(80))
    content = db.Column(db.Text)
    data = db.Column(db.Text)

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Flags, self).__init__(**kwargs)

    def __repr__(self):
        return "<Flag {0} for challenge {1}>".format(self.content, self.challenge_id)
class StaticFlag(Flags):
    __mapper_args__ = {
        "polymorphic_identity": "static"  # Identifies the 'static' type flag
    }

    def __init__(self, *args, **kwargs):
        super(StaticFlag, self).__init__(*args, **kwargs)

    def __repr__(self):
        return f"<StaticFlag {self.content} for challenge {self.challenge_id}>"

# Subclass for RegexFlag
class RegexFlag(Flags):
    __mapper_args__ = {
        "polymorphic_identity": "regex"  # Identifies the 'regex' type flag
    }

    def __init__(self, *args, **kwargs):
        super(RegexFlag, self).__init__(*args, **kwargs)

    def __repr__(self):
        return f"<RegexFlag {self.content} for challenge {self.challenge_id}>"

# Example of adding more flag types
class DynamicFlag(Flags):
    __mapper_args__ = {
        "polymorphic_identity": "dynamic"  # Identifies the 'dynamic' type flag
    }

    def __init__(self, *args, **kwargs):
        super(DynamicFlag, self).__init__(*args, **kwargs)

    def __repr__(self):
        return f"<DynamicFlag {self.content} for challenge {self.challenge_id}>"
    
class ActionLogs(db.Model):
    __tablename__ = "action_logs"

    actionId = db.Column(db.Integer, primary_key=True)
    userId = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT", onupdate="RESTRICT"))
    actionDate = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    actionType = db.Column(db.Integer, nullable=False)
    actionDetail = db.Column(db.String(255), nullable=False)
    topicName = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "actionId": self.actionId,
            "userId": self.userId,
            "actionDate": self.actionDate.isoformat(),
            "actionType": self.actionType,
            "actionDetail": self.actionDetail,
            "topicName": self.topicName
        }
    # Relationship with Users
    user = db.relationship(
        "Users",
        foreign_keys=[userId],
        lazy="joined",
        backref=db.backref("action_logs", lazy="dynamic")
    )

    def __init__(self, userId, actionType, actionDetail, actionDate=None, topicName = ""):
        self.userId = userId
        self.actionType = actionType
        self.actionDetail = actionDetail
        self.actionDate = actionDate or datetime.datetime.utcnow()
        self.topicName = topicName

    def __repr__(self):
        return f"<ActionLogs(actionId={self.actionId}, userId={self.userId}, actionType={self.actionType})>"

class Users(db.Model):
    __tablename__ = "users"
    __table_args__ = (db.UniqueConstraint("id", "oauth_id"), {})
    # Core attributes
    id = db.Column(db.Integer, primary_key=True)
    oauth_id = db.Column(db.Integer, unique=True)
    # User names are not constrained to be unique to allow for official/unofficial teams.
    name = db.Column(db.String(128))
    password = db.Column(db.String(128))
    email = db.Column(db.String(128), unique=True)
    type = db.Column(db.String(80))
    secret = db.Column(db.String(128))

    # Supplementary attributes
    website = db.Column(db.String(128))
    affiliation = db.Column(db.String(128))
    country = db.Column(db.String(32))
    bracket_id = db.Column(
        db.Integer, db.ForeignKey("brackets.id", ondelete="SET NULL")
    )
    hidden = db.Column(db.Boolean, default=False)
    banned = db.Column(db.Boolean, default=False)
    verified = db.Column(db.Boolean, default=False)
    language = db.Column(db.String(32), nullable=True, default=None)

    # Relationship for Teams
    team_id = db.Column(
    db.Integer,
    db.ForeignKey("teams.id", ondelete="SET NULL", use_alter=True, name="fk_users_team_id"),
    nullable=True
)

    field_entries = db.relationship(
        "UserFieldEntries",
        foreign_keys="UserFieldEntries.user_id",
        lazy="joined",
        back_populates="user",
    )

    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    __mapper_args__ = {"polymorphic_identity": "user", "polymorphic_on": type}

    def __init__(self, **kwargs):
        super(Users, self).__init__(**kwargs)

    @validates("password")
    def validate_password(self, key, plaintext):
        from CTFd.utils.crypto import hash_password

        return hash_password(str(plaintext))

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        elif user_mode == "users":
            return self.id

    @hybrid_property
    def account(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team
        elif user_mode == "users":
            return self

    @property
    def fields(self):
        return self.get_fields(admin=False)

    @property
    def solves(self):
        return self.get_solves(admin=False)

    @property
    def fails(self):
        return self.get_fails(admin=False)

    @property
    def awards(self):
        return self.get_awards(admin=False)

    @property
    def score(self):
        from CTFd.utils.config.visibility import scores_visible

        if scores_visible():
            return self.get_score(admin=False)
        else:
            return None

    @property
    def place(self):
        from CTFd.utils.config.visibility import scores_visible

        if scores_visible():
            return self.get_place(admin=False)
        else:
            return None
    @property
    def is_challenge_writer(self):
        return self.type == 'challenge_writer'
    @property
    def is_jury(self):
        return self.type == 'jury'
    @property
    def filled_all_required_fields(self):
        required_user_fields = {
            u.id
            for u in UserFields.query.with_entities(UserFields.id)
            .filter_by(required=True)
            .all()
        }
        submitted_user_fields = {
            u.field_id
            for u in UserFieldEntries.query.with_entities(UserFieldEntries.field_id)
            .filter_by(user_id=self.id)
            .all()
        }
        # Require that users select a bracket
        missing_bracket = (
            Brackets.query.filter_by(type="users").count()
            and self.bracket_id is not None
        )
        return required_user_fields.issubset(submitted_user_fields) and missing_bracket

    def get_fields(self, admin=False):
        if admin:
            return self.field_entries

        return [
            entry for entry in self.field_entries if entry.field.public and entry.value
        ]

    def get_solves(self, admin=False):
        from CTFd.utils import get_config

        solves = Solves.query.filter_by(user_id=self.id).order_by(Solves.date.desc())
        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            solves = solves.filter(Solves.date < dt)
        return solves.all()

    def get_fails(self, admin=False):
        from CTFd.utils import get_config

        fails = Fails.query.filter_by(user_id=self.id).order_by(Fails.date.desc())
        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            fails = fails.filter(Fails.date < dt)
        return fails.all()

    def get_awards(self, admin=False):
        from CTFd.utils import get_config

        awards = Awards.query.filter_by(user_id=self.id).order_by(Awards.date.desc())
        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            awards = awards.filter(Awards.date < dt)
        return awards.all()

    @cache.memoize()
    def get_score(self, admin=False):
        score = db.func.sum(Challenges.value).label("score")
        user = (
            db.session.query(Solves.user_id, score)
            .join(Users, Solves.user_id == Users.id)
            .join(Challenges, Solves.challenge_id == Challenges.id)
            .filter(Users.id == self.id)
        )

        award_score = db.func.sum(Awards.value).label("award_score")
        award = db.session.query(award_score).filter_by(user_id=self.id)

        if not admin:
            freeze = Configs.query.filter_by(key="freeze").first()
            if freeze and freeze.value:
                freeze = int(freeze.value)
                freeze = datetime.datetime.utcfromtimestamp(freeze)
                user = user.filter(Solves.date < freeze)
                award = award.filter(Awards.date < freeze)

        user = user.group_by(Solves.user_id).first()
        award = award.first()

        if user and award:
            return int(user.score or 0) + int(award.award_score or 0)
        elif user:
            return int(user.score or 0)
        elif award:
            return int(award.award_score or 0)
        else:
            return 0

    @cache.memoize()
    def get_place(self, admin=False, numeric=False):
        """
        This method is generally a clone of CTFd.scoreboard.get_standings.
        The point being that models.py must be self-reliant and have little
        to no imports within the CTFd application as importing from the
        application itself will result in a circular import.
        """
        from CTFd.utils.humanize.numbers import ordinalize
        from CTFd.utils.scores import get_user_standings

        standings = get_user_standings(admin=admin)

        for i, user in enumerate(standings):
            if user.user_id == self.id:
                n = i + 1
                if numeric:
                    return n
                return ordinalize(n)
        else:
            return None


class Admins(Users):
    __tablename__ = "admins"
    __mapper_args__ = {"polymorphic_identity": "admin"}

class ChallengeWriter(Users):
    __tablename__ = 'challenge_writers'
    __mapper_args__ = {
        'polymorphic_identity': 'challenge_writer',
    }
class Jury(Users):
    __tablename__ = 'jurys'
    __mapper_args__ = {
        'polymorphic_identity': 'jury',
    }
class Teams(db.Model):
    __tablename__ = "teams"
    __table_args__ = (db.UniqueConstraint("id", "oauth_id"), {})
    # Core attributes
    id = db.Column(db.Integer, primary_key=True)
    oauth_id = db.Column(db.Integer, unique=True)
    # Team names are not constrained to be unique to allow for official/unofficial teams.
    name = db.Column(db.String(128))
    email = db.Column(db.String(128), unique=True)
    password = db.Column(db.String(128))
    secret = db.Column(db.String(128))

    members = db.relationship(
        "Users", backref="team", foreign_keys="Users.team_id", lazy="joined"
    )

    # Supplementary attributes
    website = db.Column(db.String(128))
    affiliation = db.Column(db.String(128))
    country = db.Column(db.String(32))
    bracket_id = db.Column(
        db.Integer, db.ForeignKey("brackets.id", ondelete="SET NULL")
    )
    hidden = db.Column(db.Boolean, default=False)
    banned = db.Column(db.Boolean, default=False)

    # Relationship for Users
    captain_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="SET NULL", use_alter=True, name="fk_teams_captain_id"),
        nullable=True
    )
    captain = db.relationship("Users", foreign_keys=[captain_id])

    field_entries = db.relationship(
        "TeamFieldEntries",
        foreign_keys="TeamFieldEntries.team_id",
        lazy="joined",
        back_populates="team",
    )

    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    def __init__(self, **kwargs):
        super(Teams, self).__init__(**kwargs)

    @validates("password")
    def validate_password(self, key, plaintext):
        from CTFd.utils.crypto import hash_password

        return hash_password(str(plaintext))

    @property
    def fields(self):
        return self.get_fields(admin=False)
   
    @property
    def solves(self):
        return self.get_solves(admin=False)

    @property
    def fails(self):
        return self.get_fails(admin=False)

    @property
    def awards(self):
        return self.get_awards(admin=False)

    @property
    def score(self):
        from CTFd.utils.config.visibility import scores_visible

        if scores_visible():
            return self.get_score(admin=False)
        else:
            return None

    @property
    def place(self):
        from CTFd.utils.config.visibility import scores_visible

        if scores_visible():
            return self.get_place(admin=False)
        else:
            return None

    @property
    def filled_all_required_fields(self):
        required_team_fields = {
            u.id
            for u in TeamFields.query.with_entities(TeamFields.id)
            .filter_by(required=True)
            .all()
        }
        submitted_team_fields = {
            u.field_id
            for u in TeamFieldEntries.query.with_entities(TeamFieldEntries.field_id)
            .filter_by(team_id=self.id)
            .all()
        }
        missing_bracket = (
            Brackets.query.filter_by(type="teams").count()
            and self.bracket_id is not None
        )
        return required_team_fields.issubset(submitted_team_fields) and missing_bracket

    def get_fields(self, admin=False):
        if admin:
            return self.field_entries

        return [
            entry for entry in self.field_entries if entry.field.public and entry.value
        ]

    def get_invite_code(self):
        from flask import current_app  # noqa: I001

        from CTFd.utils.security.signing import hmac, serialize

        secret_key = current_app.config["SECRET_KEY"]
        if isinstance(secret_key, str):
            secret_key = secret_key.encode("utf-8")

        verification_secret = secret_key
        if self.password:
            team_password_key = self.password.encode("utf-8")
            verification_secret += team_password_key

        invite_object = {
            "id": self.id,
            "v": hmac(str(self.id), secret=verification_secret),
        }
        code = serialize(data=invite_object, secret=secret_key)
        return code

    @classmethod
    def load_invite_code(cls, code):
        from flask import current_app  # noqa: I001

        from CTFd.exceptions import TeamTokenExpiredException, TeamTokenInvalidException
        from CTFd.utils.security.signing import (
            BadSignature,
            BadTimeSignature,
            hmac,
            unserialize,
        )

        secret_key = current_app.config["SECRET_KEY"]
        if isinstance(secret_key, str):
            secret_key = secret_key.encode("utf-8")

        # Unserialize the invite code
        try:
            # Links expire after 1 day
            invite_object = unserialize(code, max_age=86400)
        except BadTimeSignature:
            raise TeamTokenExpiredException
        except BadSignature:
            raise TeamTokenInvalidException

        # Load the team by the ID in the invite
        team_id = invite_object["id"]
        team = cls.query.filter_by(id=team_id).first_or_404()

        # Create the team specific secret
        verification_secret = secret_key
        if team.password:
            team_password_key = team.password.encode("utf-8")
            verification_secret += team_password_key

        # Verify the team verficiation code
        verified = hmac(str(team.id), secret=verification_secret) == invite_object["v"]
        if verified is False:
            raise TeamTokenInvalidException
        return team

    def get_solves(self, admin=False):
        from CTFd.utils import get_config

        member_ids = [member.id for member in self.members]

        solves = Solves.query.filter(Solves.user_id.in_(member_ids)).order_by(
            Solves.date.desc()
        )

        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            solves = solves.filter(Solves.date < dt)

        return solves.all()

    def get_fails(self, admin=False):
        from CTFd.utils import get_config

        member_ids = [member.id for member in self.members]

        fails = Fails.query.filter(Fails.user_id.in_(member_ids)).order_by(
            Fails.date.desc()
        )

        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            fails = fails.filter(Fails.date < dt)

        return fails.all()

    def get_awards(self, admin=False):
        from CTFd.utils import get_config

        member_ids = [member.id for member in self.members]

        awards = Awards.query.filter(Awards.user_id.in_(member_ids)).order_by(
            Awards.date.desc()
        )

        freeze = get_config("freeze")
        if freeze and admin is False:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            awards = awards.filter(Awards.date < dt)

        return awards.all()

    @cache.memoize()
    def get_score(self, admin=False):
        score = 0
        for member in self.members:
            score += member.get_score(admin=admin)
        return score

    @cache.memoize()
    def get_place(self, admin=False, numeric=False):
        """
        This method is generally a clone of CTFd.scoreboard.get_standings.
        The point being that models.py must be self-reliant and have little
        to no imports within the CTFd application as importing from the
        application itself will result in a circular import.
        """
        from CTFd.utils.humanize.numbers import ordinalize
        from CTFd.utils.scores import get_team_standings  # noqa: I001

        standings = get_team_standings(admin=admin)

        for i, team in enumerate(standings):
            if team.team_id == self.id:
                n = i + 1
                if numeric:
                    return n
                return ordinalize(n)
        else:
            return None
class Achievements(db.Model):
    __tablename__ = "achievements"
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True)
    challenge_id = db.Column(db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"))
    name = db.Column(db.String(80))  # Tên thành tích
    achievement_id = db.Column(db.Integer, db.ForeignKey("award_badges.id", ondelete="CASCADE"))
    
    # Liên kết với bảng AwardBadges
    award_badge = db.relationship("AwardBadges", foreign_keys="Achievements.achievement_id", lazy="select")
    
    user = db.relationship("Users", foreign_keys="Achievements.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Achievements.team_id", lazy="select")
    challenge = db.relationship("Challenges", foreign_keys="Achievements.challenge_id", lazy="select")

    def __repr__(self):
        return f"<Achievement {self.name} for {self.team.name if self.team else self.user.username}>"
class AwardBadges(db.Model):
    __tablename__ = "award_badges"
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True)
    challenge_id = db.Column(db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"))
    name = db.Column(db.String(80))  # Tên giải thưởng
    
    user = db.relationship("Users", foreign_keys="AwardBadges.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="AwardBadges.team_id", lazy="select")
    challenge = db.relationship("Challenges", foreign_keys="AwardBadges.challenge_id", lazy="select")

    def __repr__(self):
        return f"<AwardBadge {self.name} for {self.team.name if self.team else self.user.username}>"


class Submissions(db.Model):
    __tablename__ = "submissions"
    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    ip = db.Column(db.String(46))
    provided = db.Column(db.Text)
    type = db.Column(db.String(32))
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = db.relationship("Users", foreign_keys="Submissions.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Submissions.team_id", lazy="select")
    challenge = db.relationship(
        "Challenges", foreign_keys="Submissions.challenge_id", lazy="select"
    )

    __mapper_args__ = {"polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        elif user_mode == "users":
            return self.user_id

    @hybrid_property
    def account(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team
        elif user_mode == "users":
            return self.user

    @staticmethod
    def get_child(type):
        child_classes = {
            x.polymorphic_identity: x.class_
            for x in Submissions.__mapper__.self_and_descendants
        }
        return child_classes[type]

    def __repr__(self):
        return f"<Submission id={self.id}, challenge_id={self.challenge_id}, ip={self.ip}, provided={self.provided}>"


class Solves(Submissions):
    __tablename__ = "solves"
    __table_args__ = (
        db.UniqueConstraint("challenge_id", "user_id"),
        db.UniqueConstraint("challenge_id", "team_id"),
        {},
    )
    id = db.Column(
        None, db.ForeignKey("submissions.id", ondelete="CASCADE"), primary_key=True
    )
    challenge_id = column_property(
        db.Column(db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")),
        Submissions.challenge_id,
    )
    user_id = column_property(
        db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE")),
        Submissions.user_id,
    )
    team_id = column_property(
        db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE")),
        Submissions.team_id,
    )

    user = db.relationship("Users", foreign_keys="Solves.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Solves.team_id", lazy="select")
    challenge = db.relationship(
        "Challenges", foreign_keys="Solves.challenge_id", lazy="select"
    )

    __mapper_args__ = {"polymorphic_identity": "correct"}


class Fails(Submissions):
    __mapper_args__ = {"polymorphic_identity": "incorrect"}


class Discards(Submissions):
    __mapper_args__ = {"polymorphic_identity": "discard"}


class Unlocks(db.Model):
    __tablename__ = "unlocks"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    target = db.Column(db.Integer)
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    type = db.Column(db.String(32))

    __mapper_args__ = {"polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        elif user_mode == "users":
            return self.user_id

    def __repr__(self):
        return "<Unlock %r>" % self.id


class HintUnlocks(Unlocks):
    __mapper_args__ = {"polymorphic_identity": "hints"}


class Tracking(db.Model):
    __tablename__ = "tracking"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(32))
    ip = db.Column(db.String(46))
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    user = db.relationship("Users", foreign_keys="Tracking.user_id", lazy="select")

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Tracking, self).__init__(**kwargs)

    def __repr__(self):
        return "<Tracking %r>" % self.ip


class Configs(db.Model):
    __tablename__ = "config"
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.Text)
    value = db.Column(db.Text)

    def __init__(self, *args, **kwargs):
        super(Configs, self).__init__(**kwargs)


class Tokens(db.Model):
    __tablename__ = "tokens"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(32))
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    expiration = db.Column(
        db.DateTime,
        default=lambda: datetime.datetime.utcnow() + datetime.timedelta(days=30),
    )
    description = db.Column(db.Text)
    value = db.Column(db.String(128), unique=True)

    user = db.relationship("Users", foreign_keys="Tokens.user_id", lazy="select")

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Tokens, self).__init__(**kwargs)

    def __repr__(self):
        return "<Token %r>" % self.id


class UserTokens(Tokens):
    __mapper_args__ = {"polymorphic_identity": "user"}


class Comments(db.Model):
    __tablename__ = "comments"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(80), default="standard")
    content = db.Column(db.Text)
    date = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    author = db.relationship("Users", foreign_keys="Comments.author_id", lazy="select")

    @property
    def html(self):
        from CTFd.utils.config.pages import build_markdown
        from CTFd.utils.helpers import markup

        return markup(build_markdown(self.content, sanitize=True))

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}


class ChallengeComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "challenge"}
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )


class UserComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "user"}
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))


class TeamComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "team"}
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))


class PageComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "page"}
    page_id = db.Column(db.Integer, db.ForeignKey("pages.id", ondelete="CASCADE"))


class Fields(db.Model):
    __tablename__ = "fields"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text)
    type = db.Column(db.String(80), default="standard")
    field_type = db.Column(db.String(80))
    description = db.Column(db.Text)
    required = db.Column(db.Boolean, default=False)
    public = db.Column(db.Boolean, default=False)
    editable = db.Column(db.Boolean, default=False)

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}


class UserFields(Fields):
    __mapper_args__ = {"polymorphic_identity": "user"}


class TeamFields(Fields):
    __mapper_args__ = {"polymorphic_identity": "team"}


class FieldEntries(db.Model):
    __tablename__ = "field_entries"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(80), default="standard")
    value = db.Column(db.JSON)
    field_id = db.Column(db.Integer, db.ForeignKey("fields.id", ondelete="CASCADE"))

    field = db.relationship(
        "Fields", foreign_keys="FieldEntries.field_id", lazy="joined"
    )

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    @hybrid_property
    def name(self):
        return self.field.name

    @hybrid_property
    def description(self):
        return self.field.description


class UserFieldEntries(FieldEntries):
    __mapper_args__ = {"polymorphic_identity": "user"}
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    user = db.relationship(
        "Users", foreign_keys="UserFieldEntries.user_id", back_populates="field_entries"
    )


class TeamFieldEntries(FieldEntries):
    __mapper_args__ = {"polymorphic_identity": "team"}
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    team = db.relationship(
        "Teams", foreign_keys="TeamFieldEntries.team_id", back_populates="field_entries"
    )


class Brackets(db.Model):
    __tablename__ = "brackets"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255))
    description = db.Column(db.Text)
    type = db.Column(db.String(80))
