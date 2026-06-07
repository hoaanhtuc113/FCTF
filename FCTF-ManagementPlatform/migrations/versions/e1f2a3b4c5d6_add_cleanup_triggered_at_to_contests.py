"""Add cleanup_triggered_at to contests table

Revision ID: e1f2a3b4c5d6
Revises: d5e6f7a8b9c0
Create Date: 2026-06-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = 'e1f2a3b4c5d6'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = [col['name'] for col in inspector.get_columns('contests')]
    if 'cleanup_triggered_at' not in existing:
        op.add_column(
            'contests',
            sa.Column('cleanup_triggered_at', sa.DateTime(), nullable=True),
        )


def downgrade():
    op.drop_column('contests', 'cleanup_triggered_at')
