"""Add dynamic_flag_instances table

Revision ID: a8b9c0d1e2f3
Revises: 9a2500d5d2fd, a1b2c3d4e5f6, bb0bab94a39a, c3d4e5f6a7b8, e1f2a3b4c5d6, f2b3c4d5e6a7
Create Date: 2026-06-01

Stores per-team flag values for challenges with type='dynamic'.
A record is created when a team starts a deployed challenge;
the pod receives the value as the CHALLENGE_FLAG env var.
"""

from alembic import op
import sqlalchemy as sa

revision = 'a8b9c0d1e2f3'
down_revision = (
    '9a2500d5d2fd',
    'a1b2c3d4e5f6',
    'bb0bab94a39a',
    'c3d4e5f6a7b8',
    'e1f2a3b4c5d6',
    'f2b3c4d5e6a7',
)
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'dynamic_flag_instances',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('flag_id', sa.Integer(), nullable=False),
        sa.Column('challenge_id', sa.Integer(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=False), server_default=sa.text('current_timestamp(6)'), nullable=True),
        sa.ForeignKeyConstraint(['flag_id'], ['flags.id'], name='fk_dfi_flag', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['challenge_id'], ['challenges.id'], name='fk_dfi_challenge', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name='fk_dfi_team', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_dfi_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='PRIMARY'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )
    op.create_index('uq_dfi_team', 'dynamic_flag_instances', ['flag_id', 'team_id'], unique=True)
    op.create_index('uq_dfi_user', 'dynamic_flag_instances', ['flag_id', 'user_id'], unique=True)
    op.create_index('idx_dfi_challenge_team', 'dynamic_flag_instances', ['challenge_id', 'team_id'], unique=False)


def downgrade():
    op.drop_index('idx_dfi_challenge_team', table_name='dynamic_flag_instances')
    op.drop_index('uq_dfi_user', table_name='dynamic_flag_instances')
    op.drop_index('uq_dfi_team', table_name='dynamic_flag_instances')
    op.drop_table('dynamic_flag_instances')
