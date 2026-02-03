"""make challenge resource fields nullable

Revision ID: c9c3f0a2b1de
Revises: c7d3b2a1e9f0
Create Date: 2026-02-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c9c3f0a2b1de"
down_revision = "c7d3b2a1e9f0"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("challenges", "cpu_limit", existing_type=sa.Integer(), nullable=True)
    op.alter_column("challenges", "cpu_request", existing_type=sa.Integer(), nullable=True)
    op.alter_column("challenges", "memory_limit", existing_type=sa.Integer(), nullable=True)
    op.alter_column("challenges", "memory_request", existing_type=sa.Integer(), nullable=True)
    op.alter_column("challenges", "use_gvisor", existing_type=sa.Boolean(), nullable=True)


def downgrade():
    op.alter_column("challenges", "use_gvisor", existing_type=sa.Boolean(), nullable=False)
    op.alter_column("challenges", "memory_request", existing_type=sa.Integer(), nullable=False)
    op.alter_column("challenges", "memory_limit", existing_type=sa.Integer(), nullable=False)
    op.alter_column("challenges", "cpu_request", existing_type=sa.Integer(), nullable=False)
    op.alter_column("challenges", "cpu_limit", existing_type=sa.Integer(), nullable=False)
