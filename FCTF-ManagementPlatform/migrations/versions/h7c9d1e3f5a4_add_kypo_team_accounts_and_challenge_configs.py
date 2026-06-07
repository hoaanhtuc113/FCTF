"""Add kypo_team_accounts and kypo_challenge_configs tables

Revision ID: h7c9d1e3f5a4
Revises: g6b8c0d2e4f3
Create Date: 2026-06-07 00:02:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = 'h7c9d1e3f5a4'
down_revision = 'g6b8c0d2e4f3'
branch_labels = None
depends_on = None


def _existing_tables():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return set(inspector.get_table_names())


def upgrade():
    tables = _existing_tables()

    if 'kypo_team_accounts' not in tables:
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

    if 'kypo_challenge_configs' not in tables:
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
