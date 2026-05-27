"""Drop registration_visibility column from contests table

registration_visibility is a platform-level setting stored in the
configs table (get_config / set_config).  It was never meaningful as a
per-contest column; removing it to avoid confusion.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('contests')]
    if 'registration_visibility' in cols:
        op.drop_column('contests', 'registration_visibility')


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('contests')]
    if 'registration_visibility' not in cols:
        op.add_column(
            'contests',
            sa.Column(
                'registration_visibility',
                sa.String(length=32),
                nullable=False,
                server_default='public',
            )
        )
