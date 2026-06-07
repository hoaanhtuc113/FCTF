"""add challenge_difficulty_visibility and limit_challenges to contests

Revision ID: e4c52818cd2a
Revises: e94e23e540c0
Create Date: 2026-05-26 18:49:28.572779

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e4c52818cd2a'
down_revision = 'e94e23e540c0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contests', sa.Column('challenge_difficulty_visibility', sa.String(length=32), nullable=False, server_default='disabled'))
    op.add_column('contests', sa.Column('limit_challenges', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('contests', 'limit_challenges')
    op.drop_column('contests', 'challenge_difficulty_visibility')
