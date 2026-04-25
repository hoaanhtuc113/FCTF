"""sync challenge fields between challenges (bank) and contests_challenges (instance)

Revision ID: e2604240001p
Revises: d2304262200p
Create Date: 2026-04-24 00:01:00.000000

=== MỤC ĐÍCH ===

  Đồng bộ thuộc tính giữa bảng challenges (bank) và contests_challenges (instance)
  để cả hai bảng có cùng tập trường:

  - Khi admin/teacher upload challenge → lưu vào challenges (bank)
  - Khi kéo challenge về contest → copy toàn bộ sang contests_challenges
  - Khi muốn sửa cấu hình cho contest → cập nhật trường đó trong contests_challenges,
    các trường không thay đổi kế thừa giá trị từ challenges

=== THAY ĐỔI challenges (bank) ===

  THÊM (runtime defaults — sẽ được copy sang contests_challenges khi import):
    max_attempt     INT NULL DEFAULT 0
    value           INT NULL
    state           VARCHAR(80) NOT NULL DEFAULT 'visible'
    time_limit      INT NULL
    start_time      DATETIME(6) NULL
    time_finished   DATETIME(6) NULL
    cooldown        INT NULL DEFAULT 0
    require_deploy  TINYINT(1) NOT NULL DEFAULT 0
    deploy_status   TEXT NULL
    connection_info TEXT NULL   ← đã bị drop ở a2211261115p, nay thêm lại

=== THAY ĐỔI contests_challenges (instance) ===

  ĐỔI TÊN:
    last_update   → updated_at   (nhất quán với challenges.updated_at)
    max_attempts  → max_attempt  (bỏ 's', nhất quán với challenges.max_attempt)

  THÊM:
    created_at      DATETIME(6) NULL
    description     TEXT NULL
    category        VARCHAR(80) NULL
    type            VARCHAR(80) NULL
    difficulty      INT NULL
    requirements    JSON NULL
    image_link      TEXT NULL
    deploy_file     VARCHAR(256) NULL
    cpu_limit       INT NULL
    cpu_request     INT NULL
    memory_limit    INT NULL
    memory_request  INT NULL
    use_gvisor      TINYINT(1) NULL
    harden_container TINYINT(1) NULL DEFAULT 1
    shared_instant  TINYINT(1) NOT NULL DEFAULT 0
    is_public       TINYINT(1) NOT NULL DEFAULT 0
    import_count    INT NOT NULL DEFAULT 0
"""

from alembic import op
import sqlalchemy as sa


# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "e2604240001p"
down_revision = "d2304262200p"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _has_column(bind, table: str, column: str) -> bool:
    if not sa.inspect(bind).has_table(table):
        return False
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _has_index(bind, table: str, index_name: str) -> bool:
    if not sa.inspect(bind).has_table(table):
        return False
    return any(ix["name"] == index_name for ix in sa.inspect(bind).get_indexes(table))


# ===========================================================================
# UPGRADE
# ===========================================================================
def upgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. Bảng `challenges` — thêm các trường runtime default
    # -----------------------------------------------------------------------
    if not _has_column(bind, "challenges", "max_attempt"):
        op.add_column("challenges", sa.Column("max_attempt", sa.Integer(), nullable=True, server_default="0"))

    if not _has_column(bind, "challenges", "value"):
        op.add_column("challenges", sa.Column("value", sa.Integer(), nullable=True))

    if not _has_column(bind, "challenges", "state"):
        op.add_column("challenges", sa.Column(
            "state", sa.String(80), nullable=False, server_default="visible"
        ))

    if not _has_column(bind, "challenges", "time_limit"):
        op.add_column("challenges", sa.Column("time_limit", sa.Integer(), nullable=True))

    if not _has_column(bind, "challenges", "start_time"):
        op.add_column("challenges", sa.Column("start_time", sa.DateTime(timezone=False), nullable=True))

    if not _has_column(bind, "challenges", "time_finished"):
        op.add_column("challenges", sa.Column("time_finished", sa.DateTime(timezone=False), nullable=True))

    if not _has_column(bind, "challenges", "cooldown"):
        op.add_column("challenges", sa.Column("cooldown", sa.Integer(), nullable=True, server_default="0"))

    if not _has_column(bind, "challenges", "require_deploy"):
        op.add_column("challenges", sa.Column(
            "require_deploy", sa.Boolean(), nullable=False, server_default=sa.false()
        ))

    if not _has_column(bind, "challenges", "deploy_status"):
        op.add_column("challenges", sa.Column("deploy_status", sa.Text(), nullable=True))

    # connection_info đã bị drop ở migration a2211261115p — thêm lại
    if not _has_column(bind, "challenges", "connection_info"):
        op.add_column("challenges", sa.Column("connection_info", sa.Text(), nullable=True))

    # -----------------------------------------------------------------------
    # 2. Bảng `contests_challenges` — đổi tên cột
    # -----------------------------------------------------------------------

    # last_update → updated_at
    if _has_column(bind, "contests_challenges", "last_update") and \
       not _has_column(bind, "contests_challenges", "updated_at"):
        op.execute(sa.text(
            "ALTER TABLE `contests_challenges` "
            "CHANGE COLUMN `last_update` `updated_at` DATETIME(6) NULL"
        ))

    # max_attempts → max_attempt  (bỏ 's')
    if _has_column(bind, "contests_challenges", "max_attempts") and \
       not _has_column(bind, "contests_challenges", "max_attempt"):
        op.execute(sa.text(
            "ALTER TABLE `contests_challenges` "
            "CHANGE COLUMN `max_attempts` `max_attempt` INT(11) NULL DEFAULT 0"
        ))

    # -----------------------------------------------------------------------
    # 3. Bảng `contests_challenges` — thêm metadata challenge
    # -----------------------------------------------------------------------
    if not _has_column(bind, "contests_challenges", "created_at"):
        op.add_column("contests_challenges", sa.Column("created_at", sa.DateTime(timezone=False), nullable=True))

    if not _has_column(bind, "contests_challenges", "description"):
        op.add_column("contests_challenges", sa.Column("description", sa.Text(), nullable=True))

    if not _has_column(bind, "contests_challenges", "category"):
        op.add_column("contests_challenges", sa.Column("category", sa.String(80), nullable=True))

    if not _has_column(bind, "contests_challenges", "type"):
        op.add_column("contests_challenges", sa.Column("type", sa.String(80), nullable=True))

    if not _has_column(bind, "contests_challenges", "difficulty"):
        op.add_column("contests_challenges", sa.Column("difficulty", sa.Integer(), nullable=True))

    if not _has_column(bind, "contests_challenges", "requirements"):
        op.add_column("contests_challenges", sa.Column("requirements", sa.JSON(), nullable=True))

    # -----------------------------------------------------------------------
    # 4. Bảng `contests_challenges` — thêm deploy config
    # -----------------------------------------------------------------------
    if not _has_column(bind, "contests_challenges", "image_link"):
        op.add_column("contests_challenges", sa.Column("image_link", sa.Text(), nullable=True))

    if not _has_column(bind, "contests_challenges", "deploy_file"):
        op.add_column("contests_challenges", sa.Column("deploy_file", sa.String(256), nullable=True))

    if not _has_column(bind, "contests_challenges", "cpu_limit"):
        op.add_column("contests_challenges", sa.Column("cpu_limit", sa.Integer(), nullable=True))

    if not _has_column(bind, "contests_challenges", "cpu_request"):
        op.add_column("contests_challenges", sa.Column("cpu_request", sa.Integer(), nullable=True))

    if not _has_column(bind, "contests_challenges", "memory_limit"):
        op.add_column("contests_challenges", sa.Column("memory_limit", sa.Integer(), nullable=True))

    if not _has_column(bind, "contests_challenges", "memory_request"):
        op.add_column("contests_challenges", sa.Column("memory_request", sa.Integer(), nullable=True))

    if not _has_column(bind, "contests_challenges", "use_gvisor"):
        op.add_column("contests_challenges", sa.Column("use_gvisor", sa.Boolean(), nullable=True))

    if not _has_column(bind, "contests_challenges", "harden_container"):
        op.add_column("contests_challenges", sa.Column(
            "harden_container", sa.Boolean(), nullable=True, server_default=sa.true()
        ))

    if not _has_column(bind, "contests_challenges", "shared_instant"):
        op.add_column("contests_challenges", sa.Column(
            "shared_instant", sa.Boolean(), nullable=False, server_default=sa.false()
        ))

    # -----------------------------------------------------------------------
    # 5. Bảng `contests_challenges` — thêm bank metadata
    # -----------------------------------------------------------------------
    if not _has_column(bind, "contests_challenges", "is_public"):
        op.add_column("contests_challenges", sa.Column(
            "is_public", sa.Boolean(), nullable=False, server_default=sa.false()
        ))

    if not _has_column(bind, "contests_challenges", "import_count"):
        op.add_column("contests_challenges", sa.Column(
            "import_count", sa.Integer(), nullable=False, server_default="0"
        ))


# ===========================================================================
# DOWNGRADE
# ===========================================================================
def downgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. Hoàn tác contests_challenges — xóa các cột mới thêm
    # -----------------------------------------------------------------------
    for col in (
        "import_count", "is_public",
        "shared_instant", "harden_container", "use_gvisor",
        "memory_request", "memory_limit", "cpu_request", "cpu_limit",
        "deploy_file", "image_link",
        "requirements", "difficulty", "type", "category", "description",
        "created_at",
    ):
        if _has_column(bind, "contests_challenges", col):
            op.drop_column("contests_challenges", col)

    # Đổi tên lại max_attempt → max_attempts
    if _has_column(bind, "contests_challenges", "max_attempt") and \
       not _has_column(bind, "contests_challenges", "max_attempts"):
        op.execute(sa.text(
            "ALTER TABLE `contests_challenges` "
            "CHANGE COLUMN `max_attempt` `max_attempts` INT(11) NULL DEFAULT 0"
        ))

    # Đổi tên lại updated_at → last_update
    if _has_column(bind, "contests_challenges", "updated_at") and \
       not _has_column(bind, "contests_challenges", "last_update"):
        op.execute(sa.text(
            "ALTER TABLE `contests_challenges` "
            "CHANGE COLUMN `updated_at` `last_update` DATETIME(6) NULL"
        ))

    # -----------------------------------------------------------------------
    # 2. Hoàn tác challenges — xóa các cột runtime default mới thêm
    # -----------------------------------------------------------------------
    for col in (
        "connection_info", "deploy_status", "require_deploy",
        "cooldown", "time_finished", "start_time", "time_limit",
        "state", "value", "max_attempt",
    ):
        if _has_column(bind, "challenges", col):
            op.drop_column("challenges", col)
