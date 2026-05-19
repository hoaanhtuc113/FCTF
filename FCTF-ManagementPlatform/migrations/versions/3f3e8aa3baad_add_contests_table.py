"""add contests table

Revision ID: 3f3e8aa3baad
Revises: e9a1c2d3f4b5
Create Date: 2026-05-19 13:56:52.132210

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3f3e8aa3baad'
down_revision = 'e9a1c2d3f4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'contests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('slug', sa.String(length=128), nullable=False),
        sa.Column('access_password', sa.String(length=128), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('user_mode', sa.String(length=32), nullable=False),
        sa.Column('state', sa.String(length=32), nullable=False),
        sa.Column('start_time', sa.DateTime(), nullable=True),
        sa.Column('end_time', sa.DateTime(), nullable=True),
        sa.Column('freeze_scoreboard_at', sa.DateTime(), nullable=True),
        sa.Column('view_after_ctf', sa.Boolean(), nullable=False),
        sa.Column('challenge_visibility', sa.String(length=32), nullable=False),
        sa.Column('score_visibility', sa.String(length=32), nullable=False),
        sa.Column('account_visibility', sa.String(length=32), nullable=False),
        sa.Column('registration_visibility', sa.String(length=32), nullable=False),
        sa.Column('team_size', sa.Integer(), nullable=True),
        sa.Column('captain_only_start_challenge', sa.Boolean(), nullable=False),
        sa.Column('captain_only_submit_challenge', sa.Boolean(), nullable=False),
        sa.Column('team_disbanding', sa.Boolean(), nullable=False),
        sa.Column('allow_name_change', sa.Boolean(), nullable=False),
        sa.Column('incorrect_submissions_per_min', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )


def downgrade():
    op.drop_table('contests')
