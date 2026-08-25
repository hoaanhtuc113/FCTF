"""Add challenge_bank_versions and challenge_bank_deploy_histories tables

Revision ID: b4d8e0f2a3c5
Revises: a3f7c9d1e2b4
Create Date: 2026-08-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'b4d8e0f2a3c5'
down_revision = 'a3f7c9d1e2b4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "challenge_bank_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("image_link", sa.Text(), nullable=True),
        sa.Column("deploy_file", sa.Text(), nullable=True),
        sa.Column("cpu_limit", sa.String(length=50), nullable=True),
        sa.Column("cpu_request", sa.String(length=50), nullable=True),
        sa.Column("memory_limit", sa.String(length=50), nullable=True),
        sa.Column("memory_request", sa.String(length=50), nullable=True),
        sa.Column("use_gvisor", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("harden_container", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "challenge_bank_deploy_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_bank_id", sa.Integer(), nullable=True),
        sa.Column("log_content", sa.Text(), nullable=True),
        sa.Column("deploy_status", sa.String(length=50), nullable=False, server_default="null"),
        sa.Column("deploy_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["challenge_bank_id"], ["challenge_bank.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("challenge_bank_deploy_histories")
    op.drop_table("challenge_bank_versions")
