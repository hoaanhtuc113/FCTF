"""drop kypo_full_name from kypo_team_accounts

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() > 0:
        op.drop_column('kypo_team_accounts', 'kypo_full_name')


def downgrade():
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() == 0:
        op.add_column('kypo_team_accounts', sa.Column('kypo_full_name', sa.String(255), nullable=True))
