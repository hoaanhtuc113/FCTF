"""rename challenge_versions to challenge_template_versions

Revision ID: 62b5e90cf53c
Revises: f97923c646b0
Create Date: 2026-05-19 14:10:35.328463

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = '62b5e90cf53c'
down_revision = 'f97923c646b0'
branch_labels = None
depends_on = None

_COLS_TO_DROP = [
    'deploy_file', 'cpu_limit', 'cpu_request', 'memory_limit',
    'memory_request', 'use_gvisor', 'harden_container', 'max_deploy_count',
]


def _drop_fks_on_columns(bind, table, columns):
    inspector = sa_inspect(bind)
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()

    # 1. Drop FKs that reference columns being renamed/removed
    _drop_fks_on_columns(bind, 'challenge_versions', ['challenge_id', 'created_by'])

    # 2. Drop deployment columns not in new spec
    for col in _COLS_TO_DROP:
        op.drop_column('challenge_versions', col)

    # 3. Rename challenge_id → challenge_template_id
    op.alter_column(
        'challenge_versions', 'challenge_id',
        new_column_name='challenge_template_id',
        existing_type=sa.Integer(),
        existing_nullable=False,
        nullable=False,
    )

    # 4. Rename notes → note
    op.alter_column(
        'challenge_versions', 'notes',
        new_column_name='note',
        existing_type=sa.Text(),
        existing_nullable=True,
        nullable=True,
    )

    # 5. Re-add FKs with new column names
    op.create_foreign_key(
        'fk_challenge_template_versions_template_id',
        'challenge_versions', 'challenge_templates',
        ['challenge_template_id'], ['id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_challenge_template_versions_created_by',
        'challenge_versions', 'users',
        ['created_by'], ['id'], ondelete='SET NULL',
    )

    # 6. Rename table — no child tables reference this so straightforward
    op.rename_table('challenge_versions', 'challenge_template_versions')


def downgrade():
    bind = op.get_bind()

    op.rename_table('challenge_template_versions', 'challenge_versions')

    _drop_fks_on_columns(bind, 'challenge_versions', ['challenge_template_id', 'created_by'])

    op.alter_column(
        'challenge_versions', 'note',
        new_column_name='notes',
        existing_type=sa.Text(),
        existing_nullable=True,
        nullable=True,
    )
    op.alter_column(
        'challenge_versions', 'challenge_template_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(),
        existing_nullable=False,
        nullable=False,
    )

    op.add_column('challenge_versions', sa.Column('deploy_file', sa.String(256), nullable=True))
    op.add_column('challenge_versions', sa.Column('cpu_limit', sa.Integer(), nullable=True))
    op.add_column('challenge_versions', sa.Column('cpu_request', sa.Integer(), nullable=True))
    op.add_column('challenge_versions', sa.Column('memory_limit', sa.Integer(), nullable=True))
    op.add_column('challenge_versions', sa.Column('memory_request', sa.Integer(), nullable=True))
    op.add_column('challenge_versions', sa.Column('use_gvisor', sa.Boolean(), nullable=True))
    op.add_column('challenge_versions', sa.Column('harden_container', sa.Boolean(), nullable=True, server_default='1'))
    op.add_column('challenge_versions', sa.Column('max_deploy_count', sa.Integer(), nullable=True, server_default='0'))

    op.create_foreign_key(
        'fk_challenge_versions_challenge_id',
        'challenge_versions', 'challenge_templates',
        ['challenge_id'], ['id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_challenge_versions_created_by',
        'challenge_versions', 'users',
        ['created_by'], ['id'], ondelete='SET NULL',
    )
