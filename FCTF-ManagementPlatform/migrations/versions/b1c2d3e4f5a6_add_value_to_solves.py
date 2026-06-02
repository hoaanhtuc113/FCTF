"""add value column to solves table

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f7
Create Date: 2026-06-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5a6'
down_revision = 'a1b2c3d4e5f7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('solves', sa.Column('value', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('solves', 'value')
