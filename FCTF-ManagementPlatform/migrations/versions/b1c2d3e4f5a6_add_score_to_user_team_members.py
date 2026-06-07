"""add score to user_team_members

Revision ID: b1c2d3e4f5a6
Revises: a8b9c0d1e2f3
Create Date: 2026-06-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'b1c2d3e4f5a6'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'user_team_members',
        sa.Column('score', sa.Integer(), nullable=False, server_default='0')
    )


def downgrade():
    op.drop_column('user_team_members', 'score')
