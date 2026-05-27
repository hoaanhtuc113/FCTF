"""Add server_default to registration_visibility on contests table

The column exists (from the initial migration) as NOT NULL with no
server_default, so any INSERT that omits the column is rejected by
MySQL with OperationalError 1364.  Setting server_default='public'
fixes inserts while keeping the column for per-contest registration
control.

Revision ID: f1a2b3c4d5e6
Revises: e4c52818cd2a
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'e4c52818cd2a'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'contests',
        'registration_visibility',
        existing_type=sa.String(length=32),
        nullable=False,
        server_default='public',
    )


def downgrade():
    op.alter_column(
        'contests',
        'registration_visibility',
        existing_type=sa.String(length=32),
        nullable=False,
        server_default=None,
    )
