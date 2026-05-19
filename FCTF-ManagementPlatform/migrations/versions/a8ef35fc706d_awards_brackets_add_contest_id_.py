"""awards brackets add contest_id challenge_template_versions add deploy fields deploy_histories fix fk to challenge_templates

Revision ID: a8ef35fc706d
Revises: 017a5111e108
Create Date: 2026-05-19 16:37:32.626202

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'a8ef35fc706d'
down_revision = '017a5111e108'
branch_labels = None
depends_on = None


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # --- awards: add contest_id ---
    op.add_column('awards', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_awards_contest_id', 'awards', 'contests',
        ['contest_id'], ['id'], ondelete='CASCADE')

    # --- brackets: add contest_id ---
    op.add_column('brackets', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_brackets_contest_id', 'brackets', 'contests',
        ['contest_id'], ['id'], ondelete='CASCADE')

    # --- challenge_template_versions: rename note→notes, add new deploy columns ---
    op.alter_column('challenge_template_versions', 'note',
        new_column_name='notes',
        existing_type=sa.Text(), existing_nullable=True, nullable=True)
    op.add_column('challenge_template_versions', sa.Column('deploy_file', sa.Text(), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('cpu_limit', sa.String(50), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('cpu_request', sa.String(50), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('memory_limit', sa.String(50), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('memory_request', sa.String(50), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('use_gvisor', sa.Boolean(), nullable=True))
    op.add_column('challenge_template_versions', sa.Column('harden_container', sa.Boolean(), nullable=True))

    # --- deploy_histories: rename contest_challenge_id → challenge_template_id ---
    _drop_fks_on_columns(inspector, 'deploy_histories', ['contest_challenge_id'])
    op.alter_column('deploy_histories', 'contest_challenge_id',
        new_column_name='challenge_template_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.create_foreign_key(
        'fk_deploy_histories_challenge_template_id', 'deploy_histories', 'challenge_templates',
        ['challenge_template_id'], ['id'], ondelete='CASCADE')


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # deploy_histories
    _drop_fks_on_columns(inspector, 'deploy_histories', ['challenge_template_id'])
    op.alter_column('deploy_histories', 'challenge_template_id',
        new_column_name='contest_challenge_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.create_foreign_key(
        'fk_deploy_histories_contest_challenge_id', 'deploy_histories', 'contests_challenges',
        ['contest_challenge_id'], ['id'], ondelete='CASCADE')

    # challenge_template_versions
    op.drop_column('challenge_template_versions', 'harden_container')
    op.drop_column('challenge_template_versions', 'use_gvisor')
    op.drop_column('challenge_template_versions', 'memory_request')
    op.drop_column('challenge_template_versions', 'memory_limit')
    op.drop_column('challenge_template_versions', 'cpu_request')
    op.drop_column('challenge_template_versions', 'cpu_limit')
    op.drop_column('challenge_template_versions', 'deploy_file')
    op.alter_column('challenge_template_versions', 'notes',
        new_column_name='note',
        existing_type=sa.Text(), existing_nullable=True, nullable=True)

    # brackets
    op.drop_constraint('fk_brackets_contest_id', 'brackets', type_='foreignkey')
    op.drop_column('brackets', 'contest_id')

    # awards
    op.drop_constraint('fk_awards_contest_id', 'awards', type_='foreignkey')
    op.drop_column('awards', 'contest_id')
