"""Remove unused contest fields: access_password, challenge_visibility, account_visibility; set score_visibility default to public

Revision ID: 4fe265292d90
Revises: a1b2c3d4e5f7
Create Date: 2026-05-26 15:15:18.188833

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '4fe265292d90'
down_revision = 'a1b2c3d4e5f7'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('contests', 'challenge_visibility')
    op.drop_column('contests', 'access_password')
    op.drop_column('contests', 'account_visibility')


def downgrade():
    op.add_column('contests', sa.Column('account_visibility', mysql.VARCHAR(length=32), nullable=False))
    op.add_column('contests', sa.Column('access_password', mysql.VARCHAR(length=128), nullable=True))
    op.add_column('contests', sa.Column('challenge_visibility', mysql.VARCHAR(length=32), nullable=False))
