"""rename challenges to challenge_templates drop contest-scoped columns

Revision ID: f97923c646b0
Revises: 3f3e8aa3baad
Create Date: 2026-05-19 14:05:22.815024

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'f97923c646b0'
down_revision = '3f3e8aa3baad'
branch_labels = None
depends_on = None

# Columns that moved to contests_challenges
_CONTEST_SCOPED_COLS = [
    'next_id', 'max_attempts', 'value', 'state', 'requirements',
    'time_limit', 'time_finished', 'start_time', 'cooldown',
    'deploy_file', 'max_deploy_count',
]


def _drop_fks_on_columns(bind, table, columns):
    inspector = sa_inspect(bind)
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()

    # 1. Drop self-referential FK (next_id → challenges.id)
    _drop_fks_on_columns(bind, 'challenges', ['next_id'])

    # 2. Drop FK user_id → users.id
    _drop_fks_on_columns(bind, 'challenges', ['user_id'])

    # 3. Drop contest-scoped columns (data moves to contests_challenges later)
    for col in _CONTEST_SCOPED_COLS:
        op.drop_column('challenges', col)

    # 4. Rename user_id → created_by, relax nullability
    op.alter_column(
        'challenges', 'user_id',
        new_column_name='created_by',
        existing_type=sa.Integer(),
        existing_nullable=False,
        nullable=True,
    )

    # 5. Re-add FK for created_by → users.id with SET NULL
    op.create_foreign_key(
        'fk_challenge_templates_created_by', 'challenges', 'users',
        ['created_by'], ['id'], ondelete='SET NULL',
    )

    # 6. Rename table — MySQL automatically updates all child-table FK references
    op.rename_table('challenges', 'challenge_templates')


def downgrade():
    bind = op.get_bind()

    op.rename_table('challenge_templates', 'challenges')

    _drop_fks_on_columns(bind, 'challenges', ['created_by'])

    op.alter_column(
        'challenges', 'created_by',
        new_column_name='user_id',
        existing_type=sa.Integer(),
        existing_nullable=True,
        nullable=False,
    )

    op.add_column('challenges', sa.Column('next_id', sa.Integer(), nullable=True))
    op.add_column('challenges', sa.Column('max_attempts', sa.Integer(), nullable=True))
    op.add_column('challenges', sa.Column('value', sa.Integer(), nullable=True))
    op.add_column('challenges', sa.Column('state', sa.String(80), nullable=False, server_default='visible'))
    op.add_column('challenges', sa.Column('requirements', sa.JSON(), nullable=True))
    op.add_column('challenges', sa.Column('time_limit', sa.Integer(), nullable=True))
    op.add_column('challenges', sa.Column('time_finished', sa.DateTime(), nullable=True))
    op.add_column('challenges', sa.Column('start_time', sa.DateTime(), nullable=True))
    op.add_column('challenges', sa.Column('cooldown', sa.Integer(), nullable=True))
    op.add_column('challenges', sa.Column('deploy_file', sa.String(256), nullable=True))
    op.add_column('challenges', sa.Column('max_deploy_count', sa.Integer(), nullable=True, server_default='0'))

    op.create_foreign_key(None, 'challenges', 'users', ['user_id'], ['id'])
    op.create_foreign_key(None, 'challenges', 'challenges', ['next_id'], ['id'], ondelete='SET NULL')
