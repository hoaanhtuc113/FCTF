"""Add value/max_attempts/cooldown/time_limit defaults to challenge_bank

Revision ID: c5e9f1a3b6d7
Revises: b4d8e0f2a3c5
Create Date: 2026-08-25

"""
from alembic import op
import sqlalchemy as sa

revision = 'c5e9f1a3b6d7'
down_revision = 'b4d8e0f2a3c5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("challenge_bank", sa.Column("value", sa.Integer(), nullable=True))
    op.add_column("challenge_bank", sa.Column("max_attempts", sa.Integer(), nullable=True))
    op.add_column("challenge_bank", sa.Column("cooldown", sa.Integer(), nullable=True))
    op.add_column("challenge_bank", sa.Column("time_limit", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("challenge_bank", "time_limit")
    op.drop_column("challenge_bank", "cooldown")
    op.drop_column("challenge_bank", "max_attempts")
    op.drop_column("challenge_bank", "value")
