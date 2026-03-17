"""add harden_container to challenges and challenge_versions

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('challenges', sa.Column('harden_container', sa.Boolean(), nullable=True, server_default=sa.text('1')))
    op.add_column('challenge_versions', sa.Column('harden_container', sa.Boolean(), nullable=True, server_default=sa.text('1')))


def downgrade():
    op.drop_column('challenges', 'harden_container')
    op.drop_column('challenge_versions', 'harden_container')
