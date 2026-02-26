"""add difficulty to challenges

Revision ID: f2b3c4d5e6a7
Revises: e1a2b3c4d5f6
Create Date: 2026-02-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f2b3c4d5e6a7'
down_revision = 'e1a2b3c4d5f6'
branch_labels = None
depends_on = None


def upgrade():
    # Add difficulty column to challenges table (1-5 star rating, nullable)
    op.add_column('challenges', sa.Column('difficulty', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('challenges', 'difficulty')
