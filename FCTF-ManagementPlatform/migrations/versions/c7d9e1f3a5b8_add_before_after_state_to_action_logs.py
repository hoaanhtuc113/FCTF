"""add before_state / after_state to action_logs

Admin operations on a contest's challenges moved out of admin_audit_logs and
into action_logs, where they belong to the contest they happened in. That table
recorded events (a team started, submitted, stopped) and had nowhere to put the
one thing an edit is: the difference between two states. These two columns are
what carries that across.

Revision ID: c7d9e1f3a5b8
Revises: d4e6f8a0b2c4
Create Date: 2026-08-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'c7d9e1f3a5b8'
down_revision = 'd4e6f8a0b2c4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('action_logs', sa.Column('before_state', sa.JSON(), nullable=True))
    op.add_column('action_logs', sa.Column('after_state', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('action_logs', 'after_state')
    op.drop_column('action_logs', 'before_state')
