"""refactor award_badges achievements tables

Revision ID: c10af5a5adb6
Revises: 5123ad5d422e
Create Date: 2026-05-19 14:41:09.663500

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'c10af5a5adb6'
down_revision = '5123ad5d422e'
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

    # --- award_badges: drop user_id/team_id, rename challenge_id → challenge_template_id ---
    _drop_fks_on_columns(inspector, 'award_badges', ['user_id', 'team_id', 'challenge_id'])
    op.alter_column('award_badges', 'challenge_id',
        new_column_name='challenge_template_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.create_foreign_key(
        'fk_award_badges_challenge_template_id',
        'award_badges', 'challenge_templates',
        ['challenge_template_id'], ['id'], ondelete='SET NULL')
    op.drop_column('award_badges', 'user_id')
    op.drop_column('award_badges', 'team_id')

    # --- achievements: rename achievement_id → award_badge_id, add date, drop user_id/challenge_id/name ---
    inspector = sa_inspect(bind)
    _drop_fks_on_columns(inspector, 'achievements', ['achievement_id', 'challenge_id', 'user_id'])
    op.alter_column('achievements', 'achievement_id',
        new_column_name='award_badge_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.create_foreign_key(
        'fk_achievements_award_badge_id',
        'achievements', 'award_badges',
        ['award_badge_id'], ['id'], ondelete='CASCADE')
    op.add_column('achievements', sa.Column('date', sa.DateTime(), nullable=False,
        server_default=sa.func.now()))
    op.drop_column('achievements', 'user_id')
    op.drop_column('achievements', 'challenge_id')
    op.drop_column('achievements', 'name')


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # achievements
    op.drop_constraint('fk_achievements_award_badge_id', 'achievements', type_='foreignkey')
    op.alter_column('achievements', 'award_badge_id',
        new_column_name='achievement_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.drop_column('achievements', 'date')
    op.add_column('achievements', sa.Column('user_id', sa.Integer(), nullable=True))
    op.add_column('achievements', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.add_column('achievements', sa.Column('name', sa.String(80), nullable=True))
    op.create_foreign_key('1', 'achievements', 'award_badges', ['achievement_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('2', 'achievements', 'challenge_templates', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('4', 'achievements', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # award_badges
    op.drop_constraint('fk_award_badges_challenge_template_id', 'award_badges', type_='foreignkey')
    op.alter_column('award_badges', 'challenge_template_id',
        new_column_name='challenge_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.add_column('award_badges', sa.Column('user_id', sa.Integer(), nullable=True))
    op.add_column('award_badges', sa.Column('team_id', sa.Integer(), nullable=True))
    op.create_foreign_key('1', 'award_badges', 'challenge_templates', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('3', 'award_badges', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('2', 'award_badges', 'teams', ['team_id'], ['id'], ondelete='CASCADE')
