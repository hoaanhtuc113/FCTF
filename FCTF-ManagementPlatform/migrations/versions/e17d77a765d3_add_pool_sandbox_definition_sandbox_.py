"""Add pool, sandbox_definition, sandbox_challenge, sandbox_run_tracking tables

Revision ID: e17d77a765d3
Revises: e6326bc7fe5c
Create Date: 2026-05-22 16:42:25.613698

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = 'e17d77a765d3'
down_revision = 'e6326bc7fe5c'
branch_labels = None
depends_on = None


def _existing_tables():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return set(inspector.get_table_names())


def upgrade():
    tables = _existing_tables()

    if 'pool' not in tables:
        op.create_table('pool',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pool_id', sa.Integer(), nullable=False),
        sa.Column('contest_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )

    if 'sandbox_definition' not in tables:
        op.create_table('sandbox_definition',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('sandbox_definition_id', sa.Integer(), nullable=False),
        sa.Column('contest_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )

    if 'sandbox_challenge' not in tables:
        op.create_table('sandbox_challenge',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pool_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['id'], ['challenges.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )

    if 'sandbox_run_tracking' not in tables:
        op.create_table('sandbox_run_tracking',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sandbox_instance_id', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(['id'], ['challenge_start_tracking.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )


def downgrade():
    op.drop_table('sandbox_run_tracking')
    op.drop_table('sandbox_challenge')
    op.drop_table('sandbox_definition')
    op.drop_table('pool')
