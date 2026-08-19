"""Add timezone to contests table

Revision ID: 75d9e418c20e
Revises: fe2f937cf467
Create Date: 2026-08-20

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '75d9e418c20e'
down_revision = 'fe2f937cf467'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = [col['name'] for col in inspector.get_columns('contests')]
    if 'timezone' not in existing:
        op.add_column(
            'contests',
            sa.Column(
                'timezone',
                sa.String(length=64),
                nullable=False,
                server_default='Asia/Ho_Chi_Minh',
            ),
        )


def downgrade():
    op.drop_column('contests', 'timezone')
