"""Add semester/contest multi-contest support

Revision ID: a1b2c3d4e5f6
Revises: fa7bd5a9f42f
Create Date: 2026-04-22 00:00:00.000000

Changes:
  - Create table: semesters
  - Create table: contests
  - Create table: contests_challenges
  - Create table: contest_participants
  - Add contest_id to: submissions, solves, unlocks
  - Fix solves unique constraints to include contest_id
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f3c4d5e6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. semesters ────────────────────────────────────────────────────────
    op.create_table(
        "semesters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("code", sa.String(32), nullable=True),
        sa.Column("academic_year", sa.String(32), nullable=True),
        sa.Column("start_date", sa.String(20), nullable=True),
        sa.Column("end_date", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="upcoming"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── 2. contests ──────────────────────────────────────────────────────────
    op.create_table(
        "contests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("semester_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(20), nullable=False, server_default="hidden"),
        sa.Column("user_mode", sa.String(20), nullable=False, server_default="users"),
        sa.Column("start_time", sa.DateTime(), nullable=True),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("freeze_scoreboard_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["semester_id"], ["semesters.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_contests_slug"),
    )
    op.create_index("idx_contests_semester", "contests", ["semester_id"])
    op.create_index("idx_contests_state", "contests", ["state"])

    # ── 3. contests_challenges ───────────────────────────────────────────────
    op.create_table(
        "contests_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contest_id", sa.Integer(), nullable=False),
        sa.Column("bank_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(80), nullable=True),
        sa.Column("connection_info", sa.Text(), nullable=True),
        sa.Column("next_id", sa.Integer(), nullable=True),
        sa.Column("last_update", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("max_deploy_count", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("connection_protocol", sa.String(10), nullable=True, server_default="http"),
        sa.ForeignKeyConstraint(["contest_id"], ["contests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bank_id"], ["challenge_bank.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_cc_contest", "contests_challenges", ["contest_id"])
    op.create_index("idx_cc_bank", "contests_challenges", ["bank_id"])

    # ── 4. contest_participants ──────────────────────────────────────────────
    op.create_table(
        "contest_participants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contest_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="contestant"),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
        sa.Column("last_solve_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["contest_id"], ["contests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("contest_id", "user_id", name="uq_cp_contest_user"),
    )
    op.create_index("idx_cp_contest", "contest_participants", ["contest_id"])
    op.create_index("idx_cp_user", "contest_participants", ["user_id"])

    # ── 5. submissions: add contest_id ───────────────────────────────────────
    op.add_column(
        "submissions",
        sa.Column("contest_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_submissions_contest", "submissions", "contests",
        ["contest_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("idx_submissions_contest", "submissions", ["contest_id"])

    # ── 6. solves: add contest_id, fix unique constraints ────────────────────
    # Drop cũ (nếu tồn tại — bỏ qua lỗi nếu không có)
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "mysql":
        try:
            op.drop_constraint("challenge_id", "solves", type_="unique")
        except Exception:
            pass
        try:
            op.drop_constraint("challenge_id_2", "solves", type_="unique")
        except Exception:
            pass
    else:
        # SQLite / others - tên constraint có thể khác, bỏ qua
        pass

    op.add_column(
        "solves",
        sa.Column("contest_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_solves_contest", "solves", "contests",
        ["contest_id"], ["id"], ondelete="CASCADE"
    )
    try:
        op.create_unique_constraint(
            "uq_solve_contest_user", "solves", ["contest_id", "challenge_id", "user_id"]
        )
        op.create_unique_constraint(
            "uq_solve_contest_team", "solves", ["contest_id", "challenge_id", "team_id"]
        )
    except Exception:
        pass  # Đã tồn tại trong DB thật

    # ── 7. unlocks: add contest_id ───────────────────────────────────────────
    op.add_column(
        "unlocks",
        sa.Column("contest_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_unlocks_contest", "unlocks", "contests",
        ["contest_id"], ["id"], ondelete="CASCADE"
    )


def downgrade():
    op.drop_constraint("fk_unlocks_contest", "unlocks", type_="foreignkey")
    op.drop_column("unlocks", "contest_id")

    op.drop_constraint("fk_solves_contest", "solves", type_="foreignkey")
    op.drop_column("solves", "contest_id")

    op.drop_constraint("fk_submissions_contest", "submissions", type_="foreignkey")
    op.drop_index("idx_submissions_contest", "submissions")
    op.drop_column("submissions", "contest_id")

    op.drop_table("contest_participants")
    op.drop_table("contests_challenges")
    op.drop_table("contests")
    op.drop_table("semesters")
