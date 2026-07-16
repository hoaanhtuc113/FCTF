"""Remove access_password from contests

Revision ID: 7ad27bd6692c
Revises: h7c9d1e3f5a4
Create Date: 2026-07-17 02:05:14.444406

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '7ad27bd6692c'
down_revision = 'h7c9d1e3f5a4'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('contests', 'access_password')


def downgrade():
    op.add_column('contests', sa.Column('access_password', mysql.VARCHAR(length=128), nullable=True))
