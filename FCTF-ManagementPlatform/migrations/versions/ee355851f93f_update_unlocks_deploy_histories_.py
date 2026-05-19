"""update unlocks deploy_histories comments for multi-contest

Revision ID: ee355851f93f
Revises: 3b3e402fe4d7
Create Date: 2026-05-19 14:30:54.841403

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = 'ee355851f93f'
down_revision = '3b3e402fe4d7'
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

    # --- comments: rename challenge_id → contest_challenge_id ---
    if _col_exists(inspector, 'comments', 'challenge_id'):
        _drop_fks_on_columns(inspector, 'comments', ['challenge_id'])
        op.alter_column(
            'comments', 'challenge_id',
            new_column_name='contest_challenge_id',
            existing_type=sa.Integer(), existing_nullable=True, nullable=True,
        )
    inspector = sa_inspect(bind)
    if not _fk_exists_to(inspector, 'comments', 'contests_challenges'):
        op.create_foreign_key(
            'fk_comments_contest_challenge_id',
            'comments', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE',
        )

    # --- deploy_histories: rename challenge_id → contest_challenge_id ---
    inspector = sa_inspect(bind)
    if _col_exists(inspector, 'deploy_histories', 'challenge_id'):
        _drop_fks_on_columns(inspector, 'deploy_histories', ['challenge_id'])
        op.alter_column(
            'deploy_histories', 'challenge_id',
            new_column_name='contest_challenge_id',
            existing_type=sa.Integer(), existing_nullable=False, nullable=True,
        )
    inspector = sa_inspect(bind)
    if not _fk_exists_to(inspector, 'deploy_histories', 'contests_challenges'):
        op.create_foreign_key(
            'fk_deploy_histories_contest_challenge_id',
            'deploy_histories', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE',
        )

    # --- unlocks: rename target → hint_id, add contest_challenge_id ---
    inspector = sa_inspect(bind)
    if _index_exists(inspector, 'unlocks', 'unlocks_unique'):
        # Drop FKs on user_id/team_id first — they back the unique index
        _drop_fks_on_columns(inspector, 'unlocks', ['user_id', 'team_id'])
        op.drop_index('unlocks_unique', table_name='unlocks')

    inspector = sa_inspect(bind)
    if _col_exists(inspector, 'unlocks', 'target'):
        op.alter_column(
            'unlocks', 'target',
            new_column_name='hint_id',
            existing_type=sa.Integer(), existing_nullable=True, nullable=True,
        )

    inspector = sa_inspect(bind)
    # Re-create user_id / team_id FKs if they were dropped
    fk_tables = {fk['referred_table'] for fk in inspector.get_foreign_keys('unlocks')}
    if 'users' not in fk_tables:
        op.create_foreign_key('fk_unlocks_user_id', 'unlocks', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    if 'teams' not in fk_tables:
        op.create_foreign_key('fk_unlocks_team_id', 'unlocks', 'teams', ['team_id'], ['id'], ondelete='CASCADE')
    if 'hints' not in fk_tables:
        op.create_foreign_key('fk_unlocks_hint_id', 'unlocks', 'hints', ['hint_id'], ['id'], ondelete='CASCADE')

    inspector = sa_inspect(bind)
    if not _col_exists(inspector, 'unlocks', 'contest_challenge_id'):
        op.add_column('unlocks', sa.Column('contest_challenge_id', sa.Integer(), nullable=True))
    inspector = sa_inspect(bind)
    if not _fk_exists_to(inspector, 'unlocks', 'contests_challenges'):
        op.create_foreign_key(
            'fk_unlocks_contest_challenge_id',
            'unlocks', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE',
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # unlocks
    op.drop_constraint('fk_unlocks_contest_challenge_id', 'unlocks', type_='foreignkey')
    op.drop_column('unlocks', 'contest_challenge_id')
    op.drop_constraint('fk_unlocks_hint_id', 'unlocks', type_='foreignkey')
    op.alter_column(
        'unlocks', 'hint_id',
        new_column_name='target',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True,
    )
    op.create_index('unlocks_unique', 'unlocks', ['team_id', 'target'], unique=True)

    # deploy_histories
    op.drop_constraint('fk_deploy_histories_contest_challenge_id', 'deploy_histories', type_='foreignkey')
    op.alter_column(
        'deploy_histories', 'contest_challenge_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=False,
    )

    # comments
    op.drop_constraint('fk_comments_contest_challenge_id', 'comments', type_='foreignkey')
    op.alter_column(
        'comments', 'contest_challenge_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True,
    )
