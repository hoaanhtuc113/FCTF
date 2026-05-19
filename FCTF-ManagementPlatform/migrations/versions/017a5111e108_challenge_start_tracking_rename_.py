"""challenge_start_tracking rename challenge_id to contest_challenge_id

Revision ID: 017a5111e108
Revises: c10af5a5adb6
Create Date: 2026-05-19 15:57:01.731447

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = '017a5111e108'
down_revision = 'c10af5a5adb6'
branch_labels = None
depends_on = None


def _col_exists(inspector, table, col):
    return any(c['name'] == col for c in inspector.get_columns(table))


def _fk_exists_to(inspector, table, referred_table):
    return any(fk['referred_table'] == referred_table for fk in inspector.get_foreign_keys(table))


def _index_exists(inspector, table, name):
    return any(i['name'] == name for i in inspector.get_indexes(table))


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # The composite indexes (team_id, challenge_id) and (user_id, challenge_id) back
    # the team_id and user_id FKs respectively — must drop those FKs first.
    _drop_fks_on_columns(inspector, 'challenge_start_tracking', ['team_id', 'user_id'])

    if _index_exists(inspector, 'challenge_start_tracking', 'idx_challenge_start_tracking_team_challenge'):
        op.drop_index('idx_challenge_start_tracking_team_challenge', table_name='challenge_start_tracking')
    if _index_exists(inspector, 'challenge_start_tracking', 'idx_challenge_start_tracking_user_challenge'):
        op.drop_index('idx_challenge_start_tracking_user_challenge', table_name='challenge_start_tracking')

    # Drop challenge_id FK then rename
    inspector = sa_inspect(bind)
    _drop_fks_on_columns(inspector, 'challenge_start_tracking', ['challenge_id'])

    if _col_exists(inspector, 'challenge_start_tracking', 'challenge_id'):
        op.alter_column('challenge_start_tracking', 'challenge_id',
            new_column_name='contest_challenge_id',
            existing_type=sa.Integer(), existing_nullable=False, nullable=False)

    # Recreate user_id / team_id FKs with named constraints
    inspector = sa_inspect(bind)
    fk_tables = {fk['referred_table'] for fk in inspector.get_foreign_keys('challenge_start_tracking')}
    if 'users' not in fk_tables:
        op.create_foreign_key(
            'fk_cst_user_id', 'challenge_start_tracking', 'users',
            ['user_id'], ['id'], ondelete='CASCADE')
    if 'teams' not in fk_tables:
        op.create_foreign_key(
            'fk_cst_team_id', 'challenge_start_tracking', 'teams',
            ['team_id'], ['id'], ondelete='CASCADE')
    if 'contests_challenges' not in fk_tables:
        op.create_foreign_key(
            'fk_cst_contest_challenge_id', 'challenge_start_tracking', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE')


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    _drop_fks_on_columns(inspector, 'challenge_start_tracking', ['contest_challenge_id', 'user_id', 'team_id'])

    op.alter_column('challenge_start_tracking', 'contest_challenge_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(), existing_nullable=False, nullable=False)

    op.create_foreign_key(
        'fk_challenge_start_tracking_challenge_id',
        'challenge_start_tracking', 'challenge_templates',
        ['challenge_id'], ['id'], ondelete='CASCADE')
    op.create_index('idx_challenge_start_tracking_user_challenge', 'challenge_start_tracking', ['user_id', 'challenge_id'], unique=False)
    op.create_index('idx_challenge_start_tracking_team_challenge', 'challenge_start_tracking', ['team_id', 'challenge_id'], unique=False)
    op.create_foreign_key(None, 'challenge_start_tracking', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'challenge_start_tracking', 'teams', ['team_id'], ['id'], ondelete='CASCADE')
