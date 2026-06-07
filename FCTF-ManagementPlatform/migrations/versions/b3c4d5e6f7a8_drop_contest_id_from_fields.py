"""Drop contest_id from fields and field_entries (custom fields are now global)

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'b3c4d5e6f7a8'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def _drop_fk_if_exists(inspector, table, columns):
    """Drop any FK constraint whose constrained columns match `columns`."""
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    tables = [t for t in inspector.get_table_names()]

    if 'fields' in tables:
        cols = [c['name'] for c in inspector.get_columns('fields')]
        if 'contest_id' in cols:
            _drop_fk_if_exists(inspector, 'fields', ['contest_id'])
            op.drop_column('fields', 'contest_id')

    if 'field_entries' in tables:
        cols = [c['name'] for c in inspector.get_columns('field_entries')]
        if 'contest_id' in cols:
            _drop_fk_if_exists(inspector, 'field_entries', ['contest_id'])
            op.drop_column('field_entries', 'contest_id')


def downgrade():
    op.add_column('field_entries', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_field_entries_contest_id', 'field_entries', 'contests',
        ['contest_id'], ['id'], ondelete='SET NULL'
    )
    op.add_column('fields', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_fields_contest_id', 'fields', 'contests',
        ['contest_id'], ['id'], ondelete='SET NULL'
    )
