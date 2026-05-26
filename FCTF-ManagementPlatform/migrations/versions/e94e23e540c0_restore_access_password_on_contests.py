"""Restore access_password on contests

Revision ID: e94e23e540c0
Revises: 4fe265292d90
Create Date: 2026-05-26 15:24:51.686456

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e94e23e540c0'
down_revision = '4fe265292d90'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contests', sa.Column('access_password', sa.String(length=128), nullable=True))


def downgrade():
    op.drop_column('contests', 'access_password')
