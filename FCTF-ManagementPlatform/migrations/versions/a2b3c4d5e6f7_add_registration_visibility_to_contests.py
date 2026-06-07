"""Add registration_visibility column to contests table

Previous migration f1a2b3c4d5e6 was applied as a DROP (older version
of the file). The column no longer exists in the DB but is required by
the Contests model. This migration adds it back with a server_default.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = 'a2b3c4d5e6f7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_columns = [col['name'] for col in inspector.get_columns('contests')]
    if 'registration_visibility' not in existing_columns:
        op.add_column(
            'contests',
            sa.Column(
                'registration_visibility',
                sa.String(length=32),
                nullable=False,
                server_default='public',
            )
        )


def downgrade():
    op.drop_column('contests', 'registration_visibility')
