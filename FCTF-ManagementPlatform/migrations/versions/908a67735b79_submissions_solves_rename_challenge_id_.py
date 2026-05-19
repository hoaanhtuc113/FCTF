"""submissions solves rename challenge_id to contest_challenge_id

Revision ID: 908a67735b79
Revises: 1bcf44afa41c
Create Date: 2026-05-19 14:23:01.999234

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = '908a67735b79'
down_revision = '1bcf44afa41c'
branch_labels = None
depends_on = None


def _col_exists(inspector, table, col):
    return any(c['name'] == col for c in inspector.get_columns(table))


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def _index_exists(inspector, table, index_name):
    return any(i['name'] == index_name for i in inspector.get_indexes(table))


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # --- submissions ---
    if _col_exists(inspector, 'submissions', 'challenge_id'):
        _drop_fks_on_columns(inspector, 'submissions', ['challenge_id'])
        op.alter_column(
            'submissions', 'challenge_id',
            new_column_name='contest_challenge_id',
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=True,
        )

    # Re-inspect after potential rename
    inspector = sa_inspect(bind)
    # Add FK if not already present (check by looking for FK to contests_challenges)
    existing_fks = [fk['referred_table'] for fk in inspector.get_foreign_keys('submissions')]
    if 'contests_challenges' not in existing_fks:
        op.create_foreign_key(
            'fk_submissions_contest_challenge_id',
            'submissions', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE',
        )

    # --- solves ---
    inspector = sa_inspect(bind)
    if _col_exists(inspector, 'solves', 'challenge_id'):
        # Drop FK first (it backs the unique indexes), then indexes
        _drop_fks_on_columns(inspector, 'solves', ['challenge_id'])
        if _index_exists(inspector, 'solves', 'challenge_id'):
            op.drop_index('challenge_id', table_name='solves')
        if _index_exists(inspector, 'solves', 'challenge_id_2'):
            op.drop_index('challenge_id_2', table_name='solves')

        op.alter_column(
            'solves', 'challenge_id',
            new_column_name='contest_challenge_id',
            existing_type=sa.Integer(),
            existing_nullable=True,
            nullable=True,
        )

    inspector = sa_inspect(bind)
    existing_fks_solves = [fk['referred_table'] for fk in inspector.get_foreign_keys('solves')]
    if 'contests_challenges' not in existing_fks_solves:
        op.create_foreign_key(
            'fk_solves_contest_challenge_id',
            'solves', 'contests_challenges',
            ['contest_challenge_id'], ['id'], ondelete='CASCADE',
        )

    existing_indexes_solves = [i['name'] for i in inspector.get_indexes('solves')]
    if 'uq_solves_cc_user' not in existing_indexes_solves:
        op.create_unique_constraint('uq_solves_cc_user', 'solves', ['contest_challenge_id', 'user_id'])
    if 'uq_solves_cc_team' not in existing_indexes_solves:
        op.create_unique_constraint('uq_solves_cc_team', 'solves', ['contest_challenge_id', 'team_id'])


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    op.drop_constraint('uq_solves_cc_team', 'solves', type_='unique')
    op.drop_constraint('uq_solves_cc_user', 'solves', type_='unique')
    _drop_fks_on_columns(inspector, 'solves', ['contest_challenge_id'])
    op.alter_column(
        'solves', 'contest_challenge_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(),
        existing_nullable=True,
        nullable=True,
    )
    op.create_foreign_key('1', 'solves', 'challenge_templates', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.create_index('challenge_id', 'solves', ['challenge_id', 'team_id'], unique=True)
    op.create_index('challenge_id_2', 'solves', ['challenge_id', 'user_id'], unique=True)

    inspector = sa_inspect(bind)
    _drop_fks_on_columns(inspector, 'submissions', ['contest_challenge_id'])
    op.alter_column(
        'submissions', 'contest_challenge_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(),
        existing_nullable=True,
        nullable=True,
    )
    op.create_foreign_key('1', 'submissions', 'challenge_templates', ['challenge_id'], ['id'], ondelete='CASCADE')
