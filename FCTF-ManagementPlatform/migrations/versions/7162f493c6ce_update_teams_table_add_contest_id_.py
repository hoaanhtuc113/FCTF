"""update teams table add contest_id rename captain_id

Revision ID: 7162f493c6ce
Revises: 7f55cd5a00bf
Create Date: 2026-05-19 14:18:19.162558

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '7162f493c6ce'
down_revision = '7f55cd5a00bf'
branch_labels = None
depends_on = None


def upgrade():
    # Add new columns
    op.add_column('teams', sa.Column('captain_user_id', sa.Integer(), nullable=True))
    op.add_column('teams', sa.Column('contest_id', sa.Integer(), nullable=True))

    # Drop old email unique index and replace with (contest_id, email) unique constraint
    op.drop_index('email', table_name='teams')
    op.create_unique_constraint('uq_teams_contest_email', 'teams', ['contest_id', 'email'])

    # Drop old captain_id FK and column, create new captain_user_id FK
    op.drop_constraint('team_captain_id', 'teams', type_='foreignkey')
    op.drop_column('teams', 'captain_id')
    op.create_foreign_key(
        'fk_teams_captain_user_id', 'teams', 'users',
        ['captain_user_id'], ['id'], ondelete='SET NULL', use_alter=True,
    )

    # Add FK for contest_id
    op.create_foreign_key(
        'fk_teams_contest_id', 'teams', 'contests',
        ['contest_id'], ['id'], ondelete='CASCADE',
    )


def downgrade():
    op.drop_constraint('fk_teams_contest_id', 'teams', type_='foreignkey')
    op.drop_constraint('fk_teams_captain_user_id', 'teams', type_='foreignkey')
    op.drop_column('teams', 'contest_id')

    op.add_column('teams', sa.Column('captain_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.create_foreign_key('team_captain_id', 'teams', 'users', ['captain_id'], ['id'], ondelete='SET NULL')

    op.drop_constraint('uq_teams_contest_email', 'teams', type_='unique')
    op.create_index('email', 'teams', ['email'], unique=True)

    op.drop_column('teams', 'captain_user_id')
