"""add ContestParticipant model, remove ChallengeWriter and Jury global roles

Revision ID: ccb6204815ab
Revises: e17d77a765d3
Create Date: 2026-05-25 10:42:08.389990

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ccb6204815ab'
down_revision = 'e17d77a765d3'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()
    if 'contest_participants' not in existing_tables:
        op.create_table('contest_participants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('contest_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.Enum('contestant', 'jury', 'challenge_writer', name='contest_role_enum'), nullable=False),
        sa.Column('joined_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('contest_id', 'user_id', name='uq_contest_participant')
        )


def downgrade():
    op.drop_table('contest_participants')
