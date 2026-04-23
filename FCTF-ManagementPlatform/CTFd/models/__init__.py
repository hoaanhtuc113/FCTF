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
    """
    classes = []
    for m in db.Model.registry.mappers:
        c = m.class_
        if hasattr(c, "__tablename__") and c.__tablename__ == tablename:
            classes.append(c)

    if len(classes) == 0:
        return None
    elif len(classes) == 1:
        return classes[0]
    else:
        for c in classes:
            mapper_args = dict(c.__mapper_args__)
            if mapper_args.get("polymorphic_on") is not None:
                return c


@compiles(db.DateTime, "mysql")
def compile_datetime_mysql(_type, _compiler, **kw):
    """Enable millisecond precision on MySQL DATETIME columns."""
    return "DATETIME(6)"


# =============================================================================
# SEMESTER
# =============================================================================

class Semester(db.Model):
    """Kỳ học. Mỗi Contest thuộc về một Semester."""
    __tablename__ = "semester"

    id            = db.Column(db.Integer, primary_key=True)
    semester_name = db.Column(db.String(128), nullable=False, unique=True)
    start_time    = db.Column(db.DateTime, nullable=True)
    end_time      = db.Column(db.DateTime, nullable=True)

    contests = db.relationship("Contests", backref="semester", lazy="dynamic")

    def __repr__(self):
        return f"<Semester {self.semester_name!r}>"


# =============================================================================
# CONTESTS
# =============================================================================

class Contests(db.Model):
    """
    Một cuộc thi. Đây là đơn vị trung tâm của kiến trúc multiple-contest.

    Mỗi contest:
      - Thuộc về một Semester (qua semester_name FK)
      - Có danh sách challenge riêng trong ContestsChallenges
      - Có participants riêng trong ContestParticipants
      - Mọi submissions / solves / unlocks / awards đều scope theo contest_id
    """
    __tablename__ = "contests"

    id                   = db.Column(db.Integer, primary_key=True)
    name                 = db.Column(db.String(255), nullable=False)
    description          = db.Column(db.Text, nullable=True)
    slug                 = db.Column(db.String(100), nullable=False, unique=True)

    # FK → users (admin/giáo viên tạo contest)
    owner_id             = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # FK → semester (contest thuộc kỳ học nào)
    semester_name        = db.Column(
        db.String(128),
        db.ForeignKey("semester.semester_name", ondelete="SET NULL"),
        nullable=True,
    )

    # state: draft | visible | paused | ended
    state                = db.Column(db.String(20), nullable=False, default="draft")
    # user_mode: users | teams
    user_mode            = db.Column(db.String(20), nullable=False, default="users")

    start_time           = db.Column(db.DateTime, nullable=True)
    end_time             = db.Column(db.DateTime, nullable=True)
    freeze_scoreboard_at = db.Column(db.DateTime, nullable=True)
    created_at           = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    updated_at           = db.Column(db.DateTime, nullable=True)

    # Relationships
    owner        = db.relationship("Users", foreign_keys=[owner_id], lazy="select")
    participants = db.relationship("ContestParticipants", backref="contest", lazy="dynamic",
                                   cascade="all, delete-orphan")
    challenges   = db.relationship("ContestsChallenges", backref="contest", lazy="dynamic",
                                   cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Contests id={self.id} slug={self.slug!r} state={self.state}>"


class ContestParticipants(db.Model):
    """
    Ai tham gia contest nào, với role gì và score bao nhiêu.
    role: contestant | jury | challenge_writer
    """
    __tablename__ = "contest_participants"
    __table_args__ = (
        db.UniqueConstraint("contest_id", "user_id",
                            name="uq_contest_participants_contest_user"),
        {},
    )

    id            = db.Column(db.Integer, primary_key=True)
    contest_id    = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    user_id       = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    team_id       = db.Column(
        db.Integer, db.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )
    role          = db.Column(db.String(20), nullable=False, default="contestant")
    score         = db.Column(db.Integer, nullable=False, default=0)
    joined_at     = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    last_solve_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("Users", foreign_keys=[user_id], lazy="select")
    team = db.relationship("Teams", foreign_keys=[team_id], lazy="select")

    def __repr__(self):
        return f"<ContestParticipants contest={self.contest_id} user={self.user_id} role={self.role}>"


# =============================================================================
# CHALLENGES  (Challenge Bank / Template)
# =============================================================================

class Challenges(db.Model):
    """
    Challenge Bank — template dùng chung.

    Giáo viên tạo challenge ở đây. Challenge này KHÔNG gắn trực tiếp với
    bất kỳ contest nào. Khi đưa vào contest, một bản ContestsChallenges
    sẽ được tạo ra tham chiếu về bank_id = challenges.id.

    Các bảng con của bank (flags, hints, files, topics, tags) đều FK về đây.
    Khi challenge được đưa vào contest, ContestsChallenges kế thừa những
    thông tin này hoặc có thể override.
    """
    __tablename__ = "challenges"

    id                  = db.Column(db.Integer, primary_key=True)
    name                = db.Column(db.String(80))
    description         = db.Column(db.Text)
    category            = db.Column(db.String(80))
    type                = db.Column(db.String(80))
    difficulty          = db.Column(db.Integer, nullable=True, default=None)

    # Người tạo challenge (teacher/challenge_writer)
    author_id           = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Deploy config
    image_link          = db.Column(db.Text, nullable=True)
    deploy_file         = db.Column(db.String(256), nullable=True)
    cpu_limit           = db.Column(db.Integer, nullable=True)
    cpu_request         = db.Column(db.Integer, nullable=True)
    memory_limit        = db.Column(db.Integer, nullable=True)
    memory_request      = db.Column(db.Integer, nullable=True)
    use_gvisor          = db.Column(db.Boolean, nullable=True)
    harden_container    = db.Column(db.Boolean, nullable=True, default=True)
    max_deploy_count    = db.Column(db.Integer, default=0, nullable=True)
    connection_protocol = db.Column(db.String(10), nullable=False, default="http")
    shared_instant      = db.Column(db.Boolean, nullable=False, default=False)

    # Bank metadata
    is_public           = db.Column(db.Boolean, nullable=False, default=False)
    # is_public=True: challenge_writer khác có thể import vào contest của họ
    import_count        = db.Column(db.Integer, nullable=False, default=0)
    requirements        = db.Column(db.JSON, nullable=True)
    created_at          = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    updated_at          = db.Column(db.DateTime, nullable=True)

    # --- Relationships với các bảng bank ---
    author       = db.relationship("Users", foreign_keys=[author_id], lazy="select")

    # Flags, Hints, Files gắn với bank challenge
    flags        = db.relationship("Flags",          backref="bank_challenge",
                                   lazy="select", cascade="all, delete-orphan")
    hints        = db.relationship("Hints",          backref="bank_challenge",
                                   lazy="select", cascade="all, delete-orphan")
    files        = db.relationship("ChallengeFiles", backref="bank_challenge",
                                   lazy="select", cascade="all, delete-orphan")

    # Versions (Docker image versions)
    versions     = db.relationship("ChallengeVersion", backref="bank_challenge",
                                   lazy="dynamic",
                                   order_by="ChallengeVersion.version_number.desc()")

    # Tất cả contest instances được tạo từ bank challenge này
    contest_instances = db.relationship("ContestsChallenges", backref="bank_challenge",
                                        lazy="dynamic")

    class alt_defaultdict(defaultdict):
        """Prevent query failure when challenge type plugin is missing."""
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
        return f"<Challenges id={self.id} name={self.name!r}>"


# =============================================================================
# CONTESTS_CHALLENGES  (Challenge Instance trong một Contest)
# =============================================================================

class ContestsChallenges(db.Model):
    """
    Instance của một challenge trong một contest cụ thể.

    Mối quan hệ:
        ContestsChallenges.bank_id  → Challenges.id  (template gốc)
        ContestsChallenges.contest_id → Contests.id

    Tất cả dữ liệu runtime (submissions, solves, hints unlock, deploy histories,
    start tracking) đều FK vào contest_challenge_id (tức id của bảng này),
    KHÔNG còn FK trực tiếp vào challenges.id nữa.

    Cho phép cùng một challenge template xuất hiện ở nhiều contest
    với cấu hình riêng (max_deploy_count, connection_protocol...).
    """
    __tablename__ = "contests_challenges"

    id                  = db.Column(db.Integer, primary_key=True)
    contest_id          = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    bank_id             = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="SET NULL"), nullable=True
    )

    # Override fields — nếu None thì kế thừa từ bank challenge
    name                = db.Column(db.String(80), nullable=True)
    connection_info     = db.Column(db.Text, nullable=True)
    next_id             = db.Column(
        db.Integer,
        db.ForeignKey("contests_challenges.id", ondelete="SET NULL"),
        nullable=True,
    )
    max_attempts        = db.Column(db.Integer, nullable=True, default=0)
    value               = db.Column(db.Integer, nullable=True)
    state               = db.Column(db.String(80), nullable=False, default="visible")
    time_limit          = db.Column(db.Integer, nullable=True)
    start_time          = db.Column(db.DateTime, nullable=True)
    time_finished       = db.Column(db.DateTime, nullable=True)
    cooldown            = db.Column(db.Integer, nullable=True, default=0)
    require_deploy      = db.Column(db.Boolean, nullable=False, default=False)
    deploy_status       = db.Column(db.Text, nullable=True, default="CREATED")
    last_update         = db.Column(db.DateTime, nullable=True)
    max_deploy_count    = db.Column(db.Integer, nullable=True, default=0)
    connection_protocol = db.Column(db.String(10), nullable=True)
    user_id             = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    creator         = db.relationship("Users", foreign_keys=[user_id], lazy="select")

    # Runtime data gắn với contest instance này
    submissions     = db.relationship("Submissions",           backref="contest_challenge",
                                      lazy="dynamic", cascade="all, delete-orphan",
                                      foreign_keys="Submissions.contest_challenge_id")
    deploy_histories = db.relationship("DeployedChallenge",   backref="contest_challenge",
                                       lazy="dynamic", cascade="all, delete-orphan")
    start_trackings = db.relationship("ChallengeStartTracking", backref="contest_challenge",
                                      lazy="dynamic", cascade="all, delete-orphan")
    comments        = db.relationship("ChallengeComments",    backref="contest_challenge",
                                      lazy="select",
                                      foreign_keys="ChallengeComments.contest_challenge_id")

    # Tags và Topics gắn với contest instance
    tags            = db.relationship("Tags",           backref="contest_challenge",
                                      lazy="select", cascade="all, delete-orphan")
    topics          = db.relationship("ChallengeTopics", backref="contest_challenge",
                                      lazy="select", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ContestsChallenges id={self.id} contest={self.contest_id} bank={self.bank_id}>"


# =============================================================================
# CHALLENGE BANK — Flags, Hints, Files  (gắn với bank template)
# =============================================================================

class Flags(db.Model):
    """Flag gắn với bank challenge (template). Dùng khi challenge được đưa vào contest."""
    __tablename__ = "flags"
    id           = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    type    = db.Column(db.String(80))
    content = db.Column(db.Text)
    data    = db.Column(db.Text)

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Flags, self).__init__(**kwargs)

    def __repr__(self):
        return f"<Flag {self.content} for bank_challenge {self.challenge_id}>"


class StaticFlag(Flags):
    __mapper_args__ = {"polymorphic_identity": "static"}


class RegexFlag(Flags):
    __mapper_args__ = {"polymorphic_identity": "regex"}


class DynamicFlag(Flags):
    __mapper_args__ = {"polymorphic_identity": "dynamic"}


class Hints(db.Model):
    """Hint gắn với bank challenge (template)."""
    __tablename__ = "hints"
    id           = db.Column(db.Integer, primary_key=True)
    type         = db.Column(db.String(80), default="standard")
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    content      = db.Column(db.Text)
    cost         = db.Column(db.Integer, default=0)
    requirements = db.Column(db.JSON)

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    @property
    def name(self):
        return f"Hint {self.id}"

    @property
    def category(self):
        return self.__tablename__

    @property
    def description(self):
        return f"Hint for {self.bank_challenge.name}"

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
        return f"<Hint {self.content!r}>"


class Files(db.Model):
    """Base file model (polymorphic)."""
    __tablename__ = "files"
    id       = db.Column(db.Integer, primary_key=True)
    type     = db.Column(db.String(80), default="standard")
    location = db.Column(db.Text)
    sha1sum  = db.Column(db.String(40))

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Files, self).__init__(**kwargs)

    def __repr__(self):
        return f"<File type={self.type} location={self.location}>"


class ChallengeFiles(Files):
    """File đính kèm gắn với bank challenge."""
    __mapper_args__ = {"polymorphic_identity": "challenge"}
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )

    def __init__(self, *args, **kwargs):
        super(ChallengeFiles, self).__init__(**kwargs)


# =============================================================================
# CHALLENGE BANK — Tags, Topics
# =============================================================================

class Tags(db.Model):
    __tablename__ = "tags"
    id           = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE")
    )
    value = db.Column(db.String(80))

    def __init__(self, *args, **kwargs):
        super(Tags, self).__init__(**kwargs)


class Topics(db.Model):
    __tablename__ = "topics"
    id    = db.Column(db.Integer, primary_key=True)
    value = db.Column(db.String(255), unique=True)

    def __init__(self, *args, **kwargs):
        super(Topics, self).__init__(**kwargs)


class ChallengeTopics(db.Model):
    __tablename__ = "challenge_topics"
    id           = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE")
    )
    topic_id = db.Column(db.Integer, db.ForeignKey("topics.id", ondelete="CASCADE"))
    topic    = db.relationship("Topics", foreign_keys=[topic_id], lazy="select")

    def __init__(self, *args, **kwargs):
        super(ChallengeTopics, self).__init__(**kwargs)


# =============================================================================
# CHALLENGE VERSION  (Docker image versions của bank challenge)
# =============================================================================

class ChallengeVersion(db.Model):
    __tablename__ = "challenge_versions"

    id             = db.Column(db.Integer, primary_key=True, autoincrement=True)
    challenge_id   = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=False
    )
    version_number = db.Column(db.Integer, nullable=False, default=1)
    image_link     = db.Column(db.Text, nullable=True)
    deploy_file    = db.Column(db.String(256), nullable=True)
    cpu_limit      = db.Column(db.Integer, nullable=True)
    cpu_request    = db.Column(db.Integer, nullable=True)
    memory_limit   = db.Column(db.Integer, nullable=True)
    memory_request = db.Column(db.Integer, nullable=True)
    use_gvisor     = db.Column(db.Boolean, nullable=True)
    harden_container = db.Column(db.Boolean, nullable=True, default=True)
    max_deploy_count = db.Column(db.Integer, nullable=True, default=0)
    is_active      = db.Column(db.Boolean, nullable=False, default=False)
    created_by     = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at     = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    notes          = db.Column(db.Text, nullable=True)

    creator = db.relationship("Users", foreign_keys=[created_by], lazy="select")

    @property
    def image_tag(self):
        import json
        if self.image_link:
            try:
                obj = json.loads(self.image_link)
                link = obj.get("imageLink", "")
                return link.split(":")[-1] if link else ""
            except (json.JSONDecodeError, AttributeError):
                return ""
        return ""

    @property
    def expose_port(self):
        import json
        if self.image_link:
            try:
                obj = json.loads(self.image_link)
                return obj.get("exposedPort", "")
            except (json.JSONDecodeError, AttributeError):
                return ""
        return ""

    def __repr__(self):
        return f"<ChallengeVersion challenge_id={self.challenge_id} version={self.version_number}>"


# =============================================================================
# DEPLOY HISTORIES  (gắn với ContestsChallenges — runtime)
# =============================================================================

class DeployedChallenge(db.Model):
    """Lịch sử deploy của một contest challenge instance."""
    __tablename__ = "deploy_histories"

    id                   = db.Column(db.Integer, primary_key=True, autoincrement=True)
    # FK → ContestsChallenges (instance trong contest, không phải bank)
    contest_challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
        nullable=False
    )
    log_content   = db.Column(db.Text, nullable=True)
    deploy_status = db.Column(db.String(50), nullable=False, default="CREATED")
    deploy_at     = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f"<DeployedChallenge cc_id={self.contest_challenge_id} status={self.deploy_status}>"


# =============================================================================
# CHALLENGE START TRACKING  (gắn với ContestsChallenges — runtime)
# =============================================================================

class ChallengeStartTracking(db.Model):
    __tablename__ = "challenge_start_tracking"

    id                   = db.Column(db.Integer, primary_key=True, autoincrement=True)
    contest_id           = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=True
    )
    user_id              = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    team_id              = db.Column(
        db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True
    )
    # FK → ContestsChallenges (instance)
    contest_challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
        nullable=False
    )
    started_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    stopped_at = db.Column(db.DateTime, nullable=True)
    label      = db.Column(db.String(255), nullable=True)

    user    = db.relationship("Users",  foreign_keys=[user_id],  lazy="select")
    team    = db.relationship("Teams",  foreign_keys=[team_id],  lazy="select")
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")

    def __repr__(self):
        return (f"<ChallengeStartTracking "
                f"user={self.user_id} team={self.team_id} "
                f"cc={self.contest_challenge_id}>")


# =============================================================================
# SUBMISSIONS / SOLVES / FAILS  (scoped theo contest + contest_challenge)
# =============================================================================

class Submissions(db.Model):
    """
    Mỗi lần submit flag. Scoped theo:
      - contest_id              → contest nào
      - contest_challenge_id    → challenge instance nào trong contest đó
    """
    __tablename__ = "submissions"

    id                   = db.Column(db.Integer, primary_key=True)
    contest_id           = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    # FK → ContestsChallenges (instance), không phải bank challenges
    contest_challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
        nullable=False
    )
    user_id  = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"))
    team_id  = db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE"))
    ip       = db.Column(db.String(46))
    provided = db.Column(db.Text)
    type     = db.Column(db.String(32))
    date     = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    user    = db.relationship("Users",  foreign_keys=[user_id],  lazy="select")
    team    = db.relationship("Teams",  foreign_keys=[team_id],  lazy="select")
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")

    __mapper_args__ = {"polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config
        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        return self.user_id

    @hybrid_property
    def account(self):
        from CTFd.utils import get_config
        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team
        return self.user

    @staticmethod
    def get_child(type):
        child_classes = {
            x.polymorphic_identity: x.class_
            for x in Submissions.__mapper__.self_and_descendants
        }
        return child_classes[type]

    def __repr__(self):
        return (f"<Submission id={self.id} "
                f"cc={self.contest_challenge_id} "
                f"provided={self.provided!r}>")


class Solves(Submissions):
    __tablename__ = "solves"
    __table_args__ = (
        # Mỗi user/team chỉ solve 1 lần / 1 challenge instance / 1 contest
        db.UniqueConstraint("contest_challenge_id", "user_id"),
        db.UniqueConstraint("contest_challenge_id", "team_id"),
        {},
    )

    id = db.Column(
        None, db.ForeignKey("submissions.id", ondelete="CASCADE"), primary_key=True
    )
    contest_id = column_property(
        db.Column(db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE")),
        Submissions.contest_id,
    )
    contest_challenge_id = column_property(
        db.Column(db.Integer,
                  db.ForeignKey("contests_challenges.id", ondelete="CASCADE")),
        Submissions.contest_challenge_id,
    )
    user_id = column_property(
        db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE")),
        Submissions.user_id,
    )
    team_id = column_property(
        db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE")),
        Submissions.team_id,
    )

    user = db.relationship("Users", foreign_keys="Solves.user_id", lazy="select")
    team = db.relationship("Teams", foreign_keys="Solves.team_id", lazy="select")

    __mapper_args__ = {"polymorphic_identity": "correct"}


class Fails(Submissions):
    __mapper_args__ = {"polymorphic_identity": "incorrect"}


class Discards(Submissions):
    __mapper_args__ = {"polymorphic_identity": "discard"}


# =============================================================================
# UNLOCKS  (mở hint — scoped theo contest)
# =============================================================================

class Unlocks(db.Model):
    __tablename__ = "unlocks"

    id         = db.Column(db.Integer, primary_key=True)
    contest_id = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    user_id  = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"))
    team_id  = db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE"))
    target   = db.Column(db.Integer)   # hint.id
    date     = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    type     = db.Column(db.String(32))

    __mapper_args__ = {"polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config
        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        return self.user_id

    def __repr__(self):
        return f"<Unlock id={self.id} contest={self.contest_id}>"


class HintUnlocks(Unlocks):
    __mapper_args__ = {"polymorphic_identity": "hints"}


# =============================================================================
# AWARDS  (scoped theo contest)
# =============================================================================

class Awards(db.Model):
    __tablename__ = "awards"

    id          = db.Column(db.Integer, primary_key=True)
    contest_id  = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"))
    team_id     = db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE"))
    type        = db.Column(db.String(80), default="standard")
    name        = db.Column(db.String(80))
    description = db.Column(db.Text)
    date        = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    value       = db.Column(db.Integer)
    category    = db.Column(db.String(80))
    icon        = db.Column(db.Text)
    requirements = db.Column(db.JSON)

    user    = db.relationship("Users",    foreign_keys=[user_id],   lazy="select")
    team    = db.relationship("Teams",    foreign_keys=[team_id],   lazy="select")
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}

    @hybrid_property
    def account_id(self):
        from CTFd.utils import get_config
        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team_id
        return self.user_id

    def __init__(self, *args, **kwargs):
        super(Awards, self).__init__(**kwargs)

    def __repr__(self):
        return f"<Award {self.name!r}>"


# =============================================================================
# ACHIEVEMENTS & AWARD BADGES  (scoped theo contest)
# =============================================================================

class AwardBadges(db.Model):
    __tablename__ = "award_badges"

    id         = db.Column(db.Integer, primary_key=True)
    contest_id = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="SET NULL"), nullable=True
    )
    user_id      = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"), nullable=True)
    team_id      = db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE"), nullable=True)
    challenge_id = db.Column(db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE"))
    name         = db.Column(db.String(80))

    user    = db.relationship("Users",  foreign_keys=[user_id],  lazy="select")
    team    = db.relationship("Teams",  foreign_keys=[team_id],  lazy="select")
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")
    contest_challenge = db.relationship("ContestsChallenges", foreign_keys=[challenge_id], lazy="select")

    def __repr__(self):
        return f"<AwardBadge {self.name!r}>"


class Achievements(db.Model):
    __tablename__ = "achievements"

    id             = db.Column(db.Integer, primary_key=True)
    contest_id     = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="SET NULL"), nullable=True
    )
    user_id        = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"), nullable=True)
    team_id        = db.Column(db.Integer, db.ForeignKey("teams.id",  ondelete="CASCADE"), nullable=True)
    challenge_id   = db.Column(db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE"))
    name           = db.Column(db.String(80))
    achievement_id = db.Column(db.Integer, db.ForeignKey("award_badges.id", ondelete="CASCADE"))

    award_badge       = db.relationship("AwardBadges",          foreign_keys=[achievement_id], lazy="select")
    user              = db.relationship("Users",                 foreign_keys=[user_id],        lazy="select")
    team              = db.relationship("Teams",                 foreign_keys=[team_id],        lazy="select")
    contest           = db.relationship("Contests",              foreign_keys=[contest_id],     lazy="select")
    contest_challenge = db.relationship("ContestsChallenges",    foreign_keys=[challenge_id],   lazy="select")

    def __repr__(self):
        return f"<Achievement {self.name!r}>"


# =============================================================================
# ACTION LOGS  (scoped theo contest)
# =============================================================================

class ActionLogs(db.Model):
    __tablename__ = "action_logs"

    actionId     = db.Column(db.Integer, primary_key=True)
    contest_id   = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="SET NULL"), nullable=True
    )
    userId       = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT", onupdate="RESTRICT")
    )
    actionDate   = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    actionType   = db.Column(db.Integer, nullable=False)
    actionDetail = db.Column(db.String(255), nullable=False)
    topicName    = db.Column(db.String(255), nullable=True)

    user    = db.relationship("Users",    foreign_keys=[userId],     lazy="joined",
                              backref=db.backref("action_logs", lazy="dynamic"))
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")

    def to_dict(self):
        return {
            "actionId":    self.actionId,
            "userId":      self.userId,
            "contestId":   self.contest_id,
            "actionDate":  self.actionDate.isoformat(),
            "actionType":  self.actionType,
            "actionDetail": self.actionDetail,
            "topicName":   self.topicName,
        }

    def __init__(self, userId, actionType, actionDetail,
                 actionDate=None, topicName="", contest_id=None):
        self.userId      = userId
        self.actionType  = actionType
        self.actionDetail = actionDetail
        self.actionDate  = actionDate or datetime.datetime.utcnow()
        self.topicName   = topicName
        self.contest_id  = contest_id

    def __repr__(self):
        return (f"<ActionLogs actionId={self.actionId} "
                f"userId={self.userId} actionType={self.actionType}>")


# =============================================================================
# COMMENTS  (polymorphic — scoped theo contest nếu là challenge comment)
# =============================================================================

class Comments(db.Model):
    __tablename__ = "comments"

    id         = db.Column(db.Integer, primary_key=True)
    contest_id = db.Column(
        db.Integer, db.ForeignKey("contests.id", ondelete="SET NULL"), nullable=True
    )
    type       = db.Column(db.String(80), default="standard")
    content    = db.Column(db.Text)
    date       = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    author_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))

    author  = db.relationship("Users",    foreign_keys=[author_id], lazy="select")
    contest = db.relationship("Contests", foreign_keys=[contest_id], lazy="select")

    @property
    def html(self):
        from CTFd.utils.config.pages import build_markdown
        from CTFd.utils.helpers import markup
        return markup(build_markdown(self.content, sanitize=True))

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}


class ChallengeComments(Comments):
    """Comment gắn với một challenge instance (ContestsChallenges)."""
    __mapper_args__ = {"polymorphic_identity": "challenge"}
    contest_challenge_id = db.Column(
        db.Integer, db.ForeignKey("contests_challenges.id", ondelete="CASCADE")
    )


class UserComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "user"}
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))


class TeamComments(Comments):
    __mapper_args__ = {"polymorphic_identity": "team"}
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))


# =============================================================================
# USERS & TEAMS
# =============================================================================

class Users(db.Model):
    __tablename__ = "users"
    __table_args__ = (db.UniqueConstraint("id", "oauth_id"), {})

    id       = db.Column(db.Integer, primary_key=True)
    oauth_id = db.Column(db.Integer, unique=True)
    name     = db.Column(db.String(128))
    password = db.Column(db.String(128))
    email    = db.Column(db.String(128), unique=True)
    type     = db.Column(db.String(80))
    secret   = db.Column(db.String(128))

    website     = db.Column(db.String(128))
    affiliation = db.Column(db.String(128))
    country     = db.Column(db.String(32))
    bracket_id  = db.Column(
        db.Integer, db.ForeignKey("brackets.id", ondelete="SET NULL")
    )
    hidden   = db.Column(db.Boolean, default=False)
    banned   = db.Column(db.Boolean, default=False)
    verified = db.Column(db.Boolean, default=False)
    language = db.Column(db.String(32), nullable=True, default=None)

    team_id = db.Column(
        db.Integer,
        db.ForeignKey("teams.id", ondelete="SET NULL",
                      use_alter=True, name="fk_users_team_id"),
        nullable=True,
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
        return self.id

    @hybrid_property
    def account(self):
        from CTFd.utils import get_config
        user_mode = get_config("user_mode")
        if user_mode == "teams":
            return self.team
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
        return None

    @property
    def place(self):
        from CTFd.utils.config.visibility import scores_visible
        if scores_visible():
            return self.get_place(admin=False)
        return None

    @property
    def is_challenge_writer(self):
        return self.type == "challenge_writer"

    @property
    def is_jury(self):
        return self.type == "jury"

    @property
    def filled_all_required_fields(self):
        required_user_fields = {
            u.id
            for u in UserFields.query.with_entities(UserFields.id)
            .filter_by(required=True).all()
        }
        submitted_user_fields = {
            u.field_id
            for u in UserFieldEntries.query.with_entities(UserFieldEntries.field_id)
            .filter_by(user_id=self.id).all()
        }
        missing_bracket = (
            Brackets.query.filter_by(type="users").count()
            and self.bracket_id is not None
        )
        return required_user_fields.issubset(submitted_user_fields) and missing_bracket

    def get_fields(self, admin=False):
        if admin:
            return self.field_entries
        return [e for e in self.field_entries if e.field.public and e.value]

    def get_solves(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        q = Solves.query.filter_by(user_id=self.id)
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Solves.date < dt)
        return q.order_by(Solves.date.desc()).all()

    def get_fails(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        q = Fails.query.filter_by(user_id=self.id)
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Fails.date < dt)
        return q.order_by(Fails.date.desc()).all()

    def get_awards(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        q = Awards.query.filter_by(user_id=self.id)
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Awards.date < dt)
        return q.order_by(Awards.date.desc()).all()

    @cache.memoize()
    def get_score(self, admin=False, contest_id=None):
        from CTFd.utils.scores import get_user_standings
        # Score được tính trong ContestParticipants.score
        # (cập nhật mỗi lần solve) — trả về trực tiếp nếu có contest_id
        if contest_id:
            participant = ContestParticipants.query.filter_by(
                contest_id=contest_id, user_id=self.id
            ).first()
            return participant.score if participant else 0

        # Tổng tất cả contest (legacy fallback)
        total = db.session.query(
            db.func.sum(ContestParticipants.score)
        ).filter_by(user_id=self.id).scalar()
        return int(total or 0)

    @cache.memoize()
    def get_place(self, admin=False, numeric=False, contest_id=None):
        from CTFd.utils.humanize.numbers import ordinalize
        from CTFd.utils.scores import get_user_standings
        standings = get_user_standings(admin=admin, contest_id=contest_id)
        for i, user in enumerate(standings):
            if user.user_id == self.id:
                n = i + 1
                return n if numeric else ordinalize(n)
        return None


class Admins(Users):
    __tablename__ = "admins"
    __mapper_args__ = {"polymorphic_identity": "admin"}


class ChallengeWriter(Users):
    __tablename__ = "challenge_writers"
    __mapper_args__ = {"polymorphic_identity": "challenge_writer"}


class Jury(Users):
    __tablename__ = "jurys"
    __mapper_args__ = {"polymorphic_identity": "jury"}


class Teams(db.Model):
    __tablename__ = "teams"
    __table_args__ = (db.UniqueConstraint("id", "oauth_id"), {})

    id       = db.Column(db.Integer, primary_key=True)
    oauth_id = db.Column(db.Integer, unique=True)
    name     = db.Column(db.String(128))
    email    = db.Column(db.String(128), unique=True)
    password = db.Column(db.String(128))
    secret   = db.Column(db.String(128))

    members = db.relationship(
        "Users", backref="team", foreign_keys="Users.team_id", lazy="joined"
    )

    website     = db.Column(db.String(128))
    affiliation = db.Column(db.String(128))
    country     = db.Column(db.String(32))
    bracket_id  = db.Column(
        db.Integer, db.ForeignKey("brackets.id", ondelete="SET NULL")
    )
    hidden  = db.Column(db.Boolean, default=False)
    banned  = db.Column(db.Boolean, default=False)
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    captain_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="SET NULL",
                      use_alter=True, name="fk_teams_captain_id"),
        nullable=True,
    )
    captain = db.relationship("Users", foreign_keys=[captain_id])

    field_entries = db.relationship(
        "TeamFieldEntries",
        foreign_keys="TeamFieldEntries.team_id",
        lazy="joined",
        back_populates="team",
    )

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
        return None

    @property
    def place(self):
        from CTFd.utils.config.visibility import scores_visible
        if scores_visible():
            return self.get_place(admin=False)
        return None

    @property
    def filled_all_required_fields(self):
        required = {u.id for u in TeamFields.query.with_entities(TeamFields.id)
                    .filter_by(required=True).all()}
        submitted = {u.field_id for u in TeamFieldEntries.query
                     .with_entities(TeamFieldEntries.field_id)
                     .filter_by(team_id=self.id).all()}
        missing_bracket = (
            Brackets.query.filter_by(type="teams").count()
            and self.bracket_id is not None
        )
        return required.issubset(submitted) and missing_bracket

    def get_fields(self, admin=False):
        if admin:
            return self.field_entries
        return [e for e in self.field_entries if e.field.public and e.value]

    def get_invite_code(self):
        from flask import current_app
        from CTFd.utils.security.signing import hmac, serialize
        secret_key = current_app.config["SECRET_KEY"]
        if isinstance(secret_key, str):
            secret_key = secret_key.encode("utf-8")
        verification_secret = secret_key
        if self.password:
            verification_secret += self.password.encode("utf-8")
        invite_object = {"id": self.id, "v": hmac(str(self.id), secret=verification_secret)}
        return serialize(data=invite_object, secret=secret_key)

    @classmethod
    def load_invite_code(cls, code):
        from flask import current_app
        from CTFd.exceptions import TeamTokenExpiredException, TeamTokenInvalidException
        from CTFd.utils.security.signing import (
            BadSignature, BadTimeSignature, hmac, unserialize,
        )
        secret_key = current_app.config["SECRET_KEY"]
        if isinstance(secret_key, str):
            secret_key = secret_key.encode("utf-8")
        try:
            invite_object = unserialize(code, max_age=86400)
        except BadTimeSignature:
            raise TeamTokenExpiredException
        except BadSignature:
            raise TeamTokenInvalidException
        team = cls.query.filter_by(id=invite_object["id"]).first_or_404()
        verification_secret = secret_key
        if team.password:
            verification_secret += team.password.encode("utf-8")
        if hmac(str(team.id), secret=verification_secret) != invite_object["v"]:
            raise TeamTokenInvalidException
        return team

    def get_solves(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        member_ids = [m.id for m in self.members]
        q = Solves.query.filter(Solves.user_id.in_(member_ids))
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Solves.date < dt)
        return q.order_by(Solves.date.desc()).all()

    def get_fails(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        member_ids = [m.id for m in self.members]
        q = Fails.query.filter(Fails.user_id.in_(member_ids))
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Fails.date < dt)
        return q.order_by(Fails.date.desc()).all()

    def get_awards(self, admin=False, contest_id=None):
        from CTFd.utils import get_config
        member_ids = [m.id for m in self.members]
        q = Awards.query.filter(Awards.user_id.in_(member_ids))
        if contest_id:
            q = q.filter_by(contest_id=contest_id)
        freeze = get_config("freeze")
        if freeze and not admin:
            dt = datetime.datetime.utcfromtimestamp(freeze)
            q = q.filter(Awards.date < dt)
        return q.order_by(Awards.date.desc()).all()

    @cache.memoize()
    def get_score(self, admin=False, contest_id=None):
        score = 0
        for member in self.members:
            score += member.get_score(admin=admin, contest_id=contest_id)
        return score

    @cache.memoize()
    def get_place(self, admin=False, numeric=False, contest_id=None):
        from CTFd.utils.humanize.numbers import ordinalize
        from CTFd.utils.scores import get_team_standings
        standings = get_team_standings(admin=admin, contest_id=contest_id)
        for i, team in enumerate(standings):
            if team.team_id == self.id:
                n = i + 1
                return n if numeric else ordinalize(n)
        return None


# =============================================================================
# TICKETS
# =============================================================================

class Tickets(db.Model):
    __tablename__ = "tickets"

    id              = db.Column(db.Integer, primary_key=True)
    author_id       = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    title           = db.Column(db.String(255))
    type            = db.Column(db.String(80))
    description     = db.Column(db.Text)
    replier_id      = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    replier_message = db.Column(db.Text, nullable=True)
    status          = db.Column(db.String(80), default="open")
    create_at       = db.Column(db.DateTime, default=datetime.datetime.utcnow)


# =============================================================================
# TRACKING
# =============================================================================

class Tracking(db.Model):
    __tablename__ = "tracking"

    id      = db.Column(db.Integer, primary_key=True)
    type    = db.Column(db.String(32))
    ip      = db.Column(db.String(46))
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    date    = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    user = db.relationship("Users", foreign_keys=[user_id], lazy="select")

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Tracking, self).__init__(**kwargs)

    def __repr__(self):
        return f"<Tracking {self.ip!r}>"


# =============================================================================
# CONFIG / TOKENS / BRACKETS / FIELDS / COMMENTS / ADMIN AUDIT LOG
# =============================================================================

class Configs(db.Model):
    __tablename__ = "config"
    id    = db.Column(db.Integer, primary_key=True)
    key   = db.Column(db.Text)
    value = db.Column(db.Text)

    def __init__(self, *args, **kwargs):
        super(Configs, self).__init__(**kwargs)


class Tokens(db.Model):
    __tablename__ = "tokens"
    id          = db.Column(db.Integer, primary_key=True)
    type        = db.Column(db.String(32))
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    created     = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    expiration  = db.Column(
        db.DateTime,
        default=lambda: datetime.datetime.utcnow() + datetime.timedelta(days=30),
    )
    description = db.Column(db.Text)
    value       = db.Column(db.Text, unique=True)

    user = db.relationship("Users", foreign_keys=[user_id], lazy="select")

    __mapper_args__ = {"polymorphic_on": type}

    def __init__(self, *args, **kwargs):
        super(Tokens, self).__init__(**kwargs)

    def __repr__(self):
        return f"<Token {self.id}>"


class UserTokens(Tokens):
    __mapper_args__ = {"polymorphic_identity": "user"}


class Brackets(db.Model):
    __tablename__ = "brackets"
    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(255))
    description = db.Column(db.Text)
    type        = db.Column(db.String(80))


class Fields(db.Model):
    __tablename__ = "fields"
    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.Text)
    type        = db.Column(db.String(80), default="standard")
    field_type  = db.Column(db.String(80))
    description = db.Column(db.Text)
    required    = db.Column(db.Boolean, default=False)
    public      = db.Column(db.Boolean, default=False)
    editable    = db.Column(db.Boolean, default=False)

    __mapper_args__ = {"polymorphic_identity": "standard", "polymorphic_on": type}


class UserFields(Fields):
    __mapper_args__ = {"polymorphic_identity": "user"}


class TeamFields(Fields):
    __mapper_args__ = {"polymorphic_identity": "team"}


class FieldEntries(db.Model):
    __tablename__ = "field_entries"
    id       = db.Column(db.Integer, primary_key=True)
    type     = db.Column(db.String(80), default="standard")
    value    = db.Column(db.JSON)
    field_id = db.Column(db.Integer, db.ForeignKey("fields.id", ondelete="CASCADE"))

    field = db.relationship("Fields", foreign_keys=[field_id], lazy="joined")

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
    user    = db.relationship(
        "Users", foreign_keys=[user_id], back_populates="field_entries"
    )


class TeamFieldEntries(FieldEntries):
    __mapper_args__ = {"polymorphic_identity": "team"}
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    team    = db.relationship(
        "Teams", foreign_keys=[team_id], back_populates="field_entries"
    )


class AdminAuditLog(db.Model):
    __tablename__ = "admin_audit_logs"

    id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    actor_id     = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_name   = db.Column(db.String(128), nullable=True)
    actor_type   = db.Column(db.String(80),  nullable=True)
    action       = db.Column(db.String(128), nullable=False)
    target_type  = db.Column(db.String(80),  nullable=True)
    target_id    = db.Column(db.Integer,     nullable=True)
    before_state = db.Column(db.JSON,        nullable=True)
    after_state  = db.Column(db.JSON,        nullable=True)
    extra_data   = db.Column(db.JSON,        nullable=True)
    ip_address   = db.Column(db.String(46),  nullable=True)
    timestamp    = db.Column(
        db.DateTime, default=datetime.datetime.utcnow, nullable=False, index=True
    )

    actor = db.relationship("Users", foreign_keys=[actor_id], lazy="select")

    def to_dict(self):
        return {
            "id":           self.id,
            "actor_id":     self.actor_id,
            "actor_name":   self.actor_name,
            "actor_type":   self.actor_type,
            "action":       self.action,
            "target_type":  self.target_type,
            "target_id":    self.target_id,
            "before_state": self.before_state,
            "after_state":  self.after_state,
            "extra_data":   self.extra_data,
            "ip_address":   self.ip_address,
            "timestamp":    self.timestamp.isoformat() if self.timestamp else None,
        }

    def __repr__(self):
        return f"<AdminAuditLog id={self.id} action={self.action!r} actor={self.actor_id}>"