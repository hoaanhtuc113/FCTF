"""Add kypo_team_accounts and kypo_challenge_configs tables

Revision ID: a1b2c3d4e5f7
Revises: fa7bd5a9f42f
Create Date: 2026-05-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f7'
down_revision = 'e9a1c2d3f4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'kypo_team_accounts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('kypo_user_id', sa.String(length=64), nullable=False),
        sa.Column('kypo_username', sa.String(length=128), nullable=False),
        sa.Column('kypo_password', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('team_id'),
    )

    op.create_table(
        'kypo_challenge_configs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('challenge_id', sa.Integer(), nullable=False),
        sa.Column('kypo_instance_id', sa.Integer(), nullable=False),
        sa.Column('kypo_access_token', sa.String(length=64), nullable=False),
        sa.Column('kypo_instance_type', sa.String(length=32), nullable=True),
        sa.Column('kypo_base_url', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['challenge_id'], ['challenges.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('challenge_id'),
    )


def downgrade():
    op.drop_table('kypo_challenge_configs')
    op.drop_table('kypo_team_accounts')
