"""repair challenges contest_id for multi contest deployments

Revision ID: a1b2c3d4e5f7
Revises: f4a6b8c9d0e1
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = 'a1b2c3d4e5f7'
down_revision = 'f4a6b8c9d0e1'
branch_labels = None
depends_on = None


def _has_fk(inspector, table_name, constrained_columns, referred_table):
    for fk in inspector.get_foreign_keys(table_name):
        if fk.get('referred_table') != referred_table:
            continue
        if fk.get('constrained_columns') == constrained_columns:
            return True
    return False


def _has_index(inspector, table_name, column_name):
    for index in inspector.get_indexes(table_name):
        if index.get('column_names') == [column_name]:
            return True
    return False


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table('challenges') or not inspector.has_table('contests'):
        return

    columns = {column['name'] for column in inspector.get_columns('challenges')}
    if 'contest_id' not in columns:
        op.add_column('challenges', sa.Column('contest_id', sa.Integer(), nullable=True))

    default_contest_id = bind.execute(text("SELECT id FROM contests ORDER BY id LIMIT 1")).scalar()
    if default_contest_id is None:
        return

    bind.execute(
        text("UPDATE challenges SET contest_id = :contest_id WHERE contest_id IS NULL"),
        {"contest_id": default_contest_id},
    )
    op.execute("ALTER TABLE challenges MODIFY COLUMN contest_id INT(11) NOT NULL")

    inspector = inspect(bind)
    if not _has_index(inspector, 'challenges', 'contest_id'):
        op.create_index('contest_id', 'challenges', ['contest_id'])

    inspector = inspect(bind)
    if not _has_fk(inspector, 'challenges', ['contest_id'], 'contests'):
        op.create_foreign_key(
            'challenges_ibfk_contest',
            'challenges',
            'contests',
            ['contest_id'],
            ['id'],
            ondelete='CASCADE',
        )


def downgrade():
    pass
