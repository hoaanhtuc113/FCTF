"""drop notifications table

Revision ID: a1b2c3d4e5f6
Revises: f3c4d5e6a7b8
Create Date: 2026-03-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'f3c4d5e6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('notifications')


def downgrade():
    op.create_table(
        'notifications',
        sa.Column('id', mysql.INTEGER(), autoincrement=True, nullable=False),
        sa.Column('title', mysql.TEXT(), nullable=True),
        sa.Column('content', mysql.TEXT(), nullable=True),
        sa.Column('date', mysql.DATETIME(), nullable=True),
        sa.Column('user_id', mysql.INTEGER(), autoincrement=False, nullable=True),
        sa.Column('team_id', mysql.INTEGER(), autoincrement=False, nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name='notifications_ibfk_2'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='notifications_ibfk_1'),
        sa.PrimaryKeyConstraint('id'),
    )
