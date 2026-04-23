"""add users_teams table for many-to-many user-team membership

Revision ID: c2304262100p
Revises: a2304261701p
Create Date: 2026-04-23 21:00:00.000000

=== MỤC ĐÍCH ===

  Hệ thống multi-contest: mỗi contest có nhiều team, mỗi team có nhiều thành viên,
  một user có thể thuộc nhiều team khác nhau ở các contest khác nhau.

  Trước đây quan hệ user ↔ team được lưu qua users.team_id (1-1, đã bị xóa ở
  migration a2304261701p). Nay cần bảng junction nhiều-nhiều để thể hiện đúng:
    1 user  → nhiều team  (qua users_teams)
    1 team  → nhiều user  (qua users_teams)

  Bảng MỚI — users_teams:
    user_id    INT NOT NULL  FK → users.id   ON DELETE CASCADE
    team_id    INT NOT NULL  FK → teams.id   ON DELETE CASCADE
    joined_at  DATETIME(6)   NOT NULL  DEFAULT NOW()
    PRIMARY KEY (user_id, team_id)

"""

from alembic import op
import sqlalchemy as sa


# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "c2304262100p"
down_revision = "a2304261701p"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers  (nhất quán với các migration khác trong dự án)
# ---------------------------------------------------------------------------
def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _has_index(bind, table: str, index_name: str) -> bool:
    return any(
        ix["name"] == index_name
        for ix in sa.inspect(bind).get_indexes(table)
    )


# ===========================================================================
# UPGRADE
# ===========================================================================
def upgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # users_teams — junction table nhiều-nhiều User ↔ Team
    #
    # Lý do tách thành bảng riêng thay vì dùng contest_participants.team_id:
    #   • contest_participants lưu metadata tham gia contest (role, score, …)
    #   • users_teams lưu membership thuần tuý: user X là thành viên team Y
    #   • Truy vấn "team này có những ai?" và "user này ở team nào?" rõ ràng hơn
    # -----------------------------------------------------------------------
    if not _has_table(bind, "users_teams"):
        op.create_table(
            "users_teams",
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                primary_key=True,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=False,
                primary_key=True,
            ),
            sa.Column(
                "joined_at",
                sa.DateTime(timezone=False),
                nullable=False,
                server_default=sa.text("NOW(6)"),
            ),
        )
        # Index trên team_id để tra cứu nhanh "team này có những ai?"
        if not _has_index(bind, "users_teams", "ix_users_teams_team_id"):
            op.create_index(
                "ix_users_teams_team_id",
                "users_teams",
                ["team_id"],
            )


# ===========================================================================
# DOWNGRADE — hoàn tác
# ===========================================================================
def downgrade():
    bind = op.get_bind()

    if _has_table(bind, "users_teams"):
        if _has_index(bind, "users_teams", "ix_users_teams_team_id"):
            op.drop_index("ix_users_teams_team_id", table_name="users_teams")
        op.drop_table("users_teams")
