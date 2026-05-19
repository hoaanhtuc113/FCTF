"""add user_team_members table drop users team_id website affiliation country language

Revision ID: 1bcf44afa41c
Revises: 7162f493c6ce
Create Date: 2026-05-19 14:21:24.573267

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '1bcf44afa41c'
down_revision = '7162f493c6ce'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_team_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('joined_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name='fk_utm_team_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_utm_user_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'team_id', name='uq_user_team_members'),
    )

    # Drop team_id FK before dropping column
    op.drop_constraint('fk_users_team_id', 'users', type_='foreignkey')
    op.drop_column('users', 'team_id')
    op.drop_column('users', 'website')
    op.drop_column('users', 'affiliation')
    op.drop_column('users', 'country')
    op.drop_column('users', 'language')


def downgrade():
    op.add_column('users', sa.Column('language', mysql.VARCHAR(length=32), nullable=True))
    op.add_column('users', sa.Column('country', mysql.VARCHAR(length=32), nullable=True))
    op.add_column('users', sa.Column('affiliation', mysql.VARCHAR(length=128), nullable=True))
    op.add_column('users', sa.Column('team_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.add_column('users', sa.Column('website', mysql.VARCHAR(length=128), nullable=True))
    op.create_foreign_key('fk_users_team_id', 'users', 'teams', ['team_id'], ['id'], ondelete='SET NULL')
    op.drop_table('user_team_members')
