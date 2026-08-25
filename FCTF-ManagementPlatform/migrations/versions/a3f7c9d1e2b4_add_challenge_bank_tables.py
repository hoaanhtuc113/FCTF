"""Add challenge_bank tables (Management Hub challenge library)

Revision ID: a3f7c9d1e2b4
Revises: 75d9e418c20e
Create Date: 2026-08-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'a3f7c9d1e2b4'
down_revision = '75d9e418c20e'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "challenge_bank",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=True),
        sa.Column("type", sa.String(length=80), nullable=True),
        sa.Column("difficulty", sa.Integer(), nullable=True),
        sa.Column("require_deploy", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deploy_status", sa.Text(), nullable=True),
        sa.Column("deploy_file", sa.Text(), nullable=True),
        sa.Column("image_link", sa.Text(), nullable=True),
        sa.Column("connection_info", sa.Text(), nullable=True),
        sa.Column("connection_protocol", sa.String(length=10), nullable=False, server_default="http"),
        sa.Column("cpu_limit", sa.Integer(), nullable=True),
        sa.Column("cpu_request", sa.Integer(), nullable=True),
        sa.Column("memory_limit", sa.Integer(), nullable=True),
        sa.Column("memory_request", sa.Integer(), nullable=True),
        sa.Column("use_gvisor", sa.Boolean(), nullable=True),
        sa.Column("harden_container", sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column("shared_instant", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_deploy_count", sa.Integer(), nullable=True),
        sa.Column("last_update", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "challenge_bank_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
        sa.Column("value", sa.String(length=80), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "challenge_bank_hints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=80), nullable=True),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("cost", sa.Integer(), nullable=True),
        sa.Column("requirements", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "challenge_bank_flags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=80), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("data", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "challenge_bank_topics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ChallengeBankFiles is a polymorphic subtype of the existing `files`
    # table (same pattern as ChallengeFiles) — no new base table needed, just
    # the FK column onto challenge_bank.
    op.add_column(
        "files",
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_files_challenge_bank_id",
        "files",
        "challenge_bank",
        ["challenge_bank_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Traceability only: which bank template a contest's challenge was cloned
    # from, if any. Nullable, never read by scoring/deploy code.
    op.add_column(
        "challenges",
        sa.Column("source_bank_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_challenges_source_bank_id",
        "challenges",
        "challenge_bank",
        ["source_bank_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_challenges_source_bank_id", "challenges", type_="foreignkey")
    op.drop_column("challenges", "source_bank_id")

    op.drop_constraint("fk_files_challenge_bank_id", "files", type_="foreignkey")
    op.drop_column("files", "challenge_bank_id")

    op.drop_table("challenge_bank_topics")
    op.drop_table("challenge_bank_flags")
    op.drop_table("challenge_bank_hints")
    op.drop_table("challenge_bank_tags")
    op.drop_table("challenge_bank")
