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

    # Xóa cột kypo_full_name
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() > 0:
        op.drop_column('kypo_team_accounts', 'kypo_full_name')

    # Thêm index cho kypo_username để tăng tốc polling lookup
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND INDEX_NAME = 'idx_kypo_username'"
    ))
    if result.scalar() == 0:
        op.create_index('idx_kypo_username', 'kypo_team_accounts', ['kypo_username'])


def downgrade():
    conn = op.get_bind()

    # Xóa index
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND INDEX_NAME = 'idx_kypo_username'"
    ))
    if result.scalar() > 0:
        op.drop_index('idx_kypo_username', 'kypo_team_accounts')

    # Khôi phục cột kypo_full_name
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() == 0:
        op.add_column('kypo_team_accounts', sa.Column('kypo_full_name', sa.String(255), nullable=True))
