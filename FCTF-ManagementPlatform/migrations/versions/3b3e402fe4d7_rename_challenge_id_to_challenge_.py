"""rename challenge_id to challenge_template_id in hints flags files tags challenge_topics

Revision ID: 3b3e402fe4d7
Revises: 908a67735b79
Create Date: 2026-05-19 14:27:54.527593

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '3b3e402fe4d7'
down_revision = '908a67735b79'
branch_labels = None
depends_on = None

_TABLES = ['hints', 'flags', 'files', 'tags', 'challenge_topics']


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    for table in _TABLES:
        _drop_fks_on_columns(inspector, table, ['challenge_id'])
        op.alter_column(
            table, 'challenge_id',
            new_column_name='challenge_template_id',
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=True,
        )
        op.create_foreign_key(
            f'fk_{table}_challenge_template_id',
            table, 'challenge_templates',
            ['challenge_template_id'], ['id'], ondelete='CASCADE',
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    for table in reversed(_TABLES):
        op.drop_constraint(f'fk_{table}_challenge_template_id', table, type_='foreignkey')
        op.alter_column(
            table, 'challenge_template_id',
            new_column_name='challenge_id',
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=True,
        )
        op.create_foreign_key(
            None, table, 'challenge_templates',
            ['challenge_id'], ['id'], ondelete='CASCADE',
        )
