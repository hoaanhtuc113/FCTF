"""add contests_challenges table

Revision ID: 7f55cd5a00bf
Revises: 62b5e90cf53c
Create Date: 2026-05-19 14:16:36.414547

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7f55cd5a00bf'
down_revision = '62b5e90cf53c'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'contests_challenges',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('contest_id', sa.Integer(), nullable=False),
        sa.Column('challenge_template_id', sa.Integer(), nullable=False),
        sa.Column('template_version_id', sa.Integer(), nullable=True),
        sa.Column('value', sa.Integer(), nullable=True),
        sa.Column('state', sa.String(length=32), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=True),
        sa.Column('cooldown', sa.Integer(), nullable=True),
        sa.Column('time_limit', sa.Integer(), nullable=True),
        sa.Column('start_time', sa.DateTime(), nullable=True),
        sa.Column('finish_time', sa.DateTime(), nullable=True),
        sa.Column('max_deploy_count', sa.Integer(), nullable=True),
        sa.Column('next_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['challenge_template_id'], ['challenge_templates.id'], name='fk_cc_challenge_template_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], name='fk_cc_contest_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['next_id'], ['contests_challenges.id'], name='fk_cc_next_id', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['template_version_id'], ['challenge_template_versions.id'], name='fk_cc_template_version_id', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade():
    op.drop_table('contests_challenges')
