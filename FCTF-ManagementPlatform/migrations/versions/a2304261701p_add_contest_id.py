"""fix missing contest_id on challenge_start_tracking, teams, tickets and drop team_id from users

Revision ID: a2304261701p
Revises: a2211261115p
Create Date: 2026-04-23 17:01:00.000000

=== MỤC ĐÍCH ===

  Migration a2211261115p (add_multiple_contest_support) đã xử lý phần lớn schema
  nhưng một số bảng vẫn thiếu contest_id hoặc còn cột không còn phù hợp:

  Bảng SỬA — challenge_start_tracking:
    THÊM: contest_id FK → contests.id  (idempotent — bỏ qua nếu đã tồn tại)

  Bảng SỬA — teams:
    THÊM: contest_id FK → contests.id  (idempotent — bỏ qua nếu đã tồn tại)

  Bảng SỬA — tickets:
    THÊM: contest_id FK → contests.id  (idempotent — bỏ qua nếu đã tồn tại)

  Bảng SỬA — users:
    XÓA:  team_id  — 1 user có thể tham gia nhiều cuộc thi với nhiều team
                     membership được quản lý qua contest_participants.team_id
                     (idempotent — bỏ qua nếu đã không còn cột này)

"""

from alembic import op
import sqlalchemy as sa


# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "a2304261701p"
down_revision = "a2211261115p"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers  (bản sao nhất quán với các migration trong dự án)
# ---------------------------------------------------------------------------
def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _has_column(bind, table: str, column: str) -> bool:
    if not _has_table(bind, table):
        return False
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _has_index(bind, table: str, index_name: str) -> bool:
    return any(
        ix["name"] == index_name
        for ix in sa.inspect(bind).get_indexes(table)
    )


def _has_fk(bind, table: str, fk_name: str) -> bool:
    return any(
        fk.get("name") == fk_name
        for fk in sa.inspect(bind).get_foreign_keys(table)
    )


def _drop_col_with_fk(bind, table: str, col: str) -> None:
    """Drop FK constraints referencing `col` then drop the column itself.
    MariaDB/MySQL requires FK constraints to be dropped before columns."""
    for fk in sa.inspect(bind).get_foreign_keys(table):
        if col in fk.get("constrained_columns", []) and fk.get("name"):
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_constraint(fk["name"], type_="foreignkey")
    op.drop_column(table, col)


# ===========================================================================
# UPGRADE
# ===========================================================================
def upgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. challenge_start_tracking — thêm contest_id FK → contests.id
    #    Cột này đánh dấu mỗi lần bắt đầu challenge thuộc về contest nào,
    #    cần thiết để query tracking theo từng contest riêng biệt.
    # -----------------------------------------------------------------------
    if _has_table(bind, "challenge_start_tracking") and \
       not _has_column(bind, "challenge_start_tracking", "contest_id"):
        op.add_column(
            "challenge_start_tracking",
            sa.Column(
                "contest_id",
                sa.Integer(),
                sa.ForeignKey("contests.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        if not _has_index(bind, "challenge_start_tracking", "ix_cst_contest_id"):
            op.create_index(
                "ix_cst_contest_id",
                "challenge_start_tracking",
                ["contest_id"],
            )

    # -----------------------------------------------------------------------
    # 2. teams — thêm contest_id FK → contests.id
    #    Mỗi team thuộc về một contest cụ thể; cần FK để JOIN và cascade delete.
    # -----------------------------------------------------------------------
    if _has_table(bind, "teams") and \
       not _has_column(bind, "teams", "contest_id"):
        op.add_column(
            "teams",
            sa.Column(
                "contest_id",
                sa.Integer(),
                sa.ForeignKey("contests.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        if not _has_index(bind, "teams", "ix_teams_contest_id"):
            op.create_index("ix_teams_contest_id", "teams", ["contest_id"])

    # -----------------------------------------------------------------------
    # 3. tickets — thêm contest_id FK → contests.id
    #    Ticket hỗ trợ cần biết nó thuộc contest nào để route đến đúng admin.
    # -----------------------------------------------------------------------
    if _has_table(bind, "tickets") and \
       not _has_column(bind, "tickets", "contest_id"):
        op.add_column(
            "tickets",
            sa.Column(
                "contest_id",
                sa.Integer(),
                sa.ForeignKey("contests.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        if not _has_index(bind, "tickets", "ix_tickets_contest_id"):
            op.create_index("ix_tickets_contest_id", "tickets", ["contest_id"])

    # -----------------------------------------------------------------------
    # 4. users — xoá team_id
    #    Một user có thể tham gia nhiều contest với nhiều team khác nhau.
    #    Quan hệ user ↔ team được quản lý qua contest_participants.team_id,
    #    không còn cần lưu trực tiếp trên bảng users nữa.
    # -----------------------------------------------------------------------
    if _has_table(bind, "users") and _has_column(bind, "users", "team_id"):
        _drop_col_with_fk(bind, "users", "team_id")


# ===========================================================================
# DOWNGRADE — hoàn tác theo thứ tự ngược
# ===========================================================================
def downgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # 4. Khôi phục team_id vào users
    # -----------------------------------------------------------------------
    if _has_table(bind, "users") and not _has_column(bind, "users", "team_id"):
        op.add_column(
            "users",
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey(
                    "teams.id",
                    ondelete="SET NULL",
                    use_alter=True,
                    name="fk_users_team_id",
                ),
                nullable=True,
            ),
        )

    # -----------------------------------------------------------------------
    # 3. Xoá contest_id khỏi tickets
    # -----------------------------------------------------------------------
    if _has_table(bind, "tickets") and _has_column(bind, "tickets", "contest_id"):
        if _has_index(bind, "tickets", "ix_tickets_contest_id"):
            op.drop_index("ix_tickets_contest_id", table_name="tickets")
        _drop_col_with_fk(bind, "tickets", "contest_id")

    # -----------------------------------------------------------------------
    # 2. Xoá contest_id khỏi teams
    # -----------------------------------------------------------------------
    if _has_table(bind, "teams") and _has_column(bind, "teams", "contest_id"):
        if _has_index(bind, "teams", "ix_teams_contest_id"):
            op.drop_index("ix_teams_contest_id", table_name="teams")
        _drop_col_with_fk(bind, "teams", "contest_id")

    # -----------------------------------------------------------------------
    # 1. Xoá contest_id khỏi challenge_start_tracking
    # -----------------------------------------------------------------------
    if _has_table(bind, "challenge_start_tracking") and \
       _has_column(bind, "challenge_start_tracking", "contest_id"):
        if _has_index(bind, "challenge_start_tracking", "ix_cst_contest_id"):
            op.drop_index("ix_cst_contest_id", table_name="challenge_start_tracking")
        _drop_col_with_fk(bind, "challenge_start_tracking", "contest_id")