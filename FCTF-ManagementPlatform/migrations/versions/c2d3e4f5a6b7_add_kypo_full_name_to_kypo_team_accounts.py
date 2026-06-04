"""add kypo_full_name to kypo_team_accounts

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-06-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Thêm column kypo_full_name nếu chưa có
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() == 0:
        op.add_column('kypo_team_accounts', sa.Column('kypo_full_name', sa.String(255), nullable=True))

    # Tự động điền kypo_full_name = "{team.name} FCTF Team" cho các record hiện có
    conn.execute(sa.text("""
        UPDATE kypo_team_accounts kta
        JOIN teams t ON t.id = kta.team_id
        SET kta.kypo_full_name = CONCAT(t.name, ' FCTF Team')
        WHERE kta.kypo_full_name IS NULL
    """))


def downgrade():
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = 'kypo_team_accounts' AND COLUMN_NAME = 'kypo_full_name'"
    ))
    if result.scalar() > 0:
        op.drop_column('kypo_team_accounts', 'kypo_full_name')
