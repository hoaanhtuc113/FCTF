"""drop value column from solves table

Điểm KYPO challenge lấy từ challenges.value (FCTF), không lưu riêng trong solves.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-06-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e4f5a6b7c8d9'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'solves' AND COLUMN_NAME = 'value'"
    ))
    if result.scalar() > 0:
        op.drop_column('solves', 'value')


def downgrade():
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'solves' AND COLUMN_NAME = 'value'"
    ))
    if result.scalar() == 0:
        op.add_column('solves', sa.Column('value', sa.Integer(), nullable=True))
