"""add deploy_file to challenges

Revision ID: 11aea6182b75
Revises: fa7bd5a9f41f
Create Date: 2025-10-31 02:58:26.918602

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '11aea6182b75'
down_revision = 'fa7bd5a9f41f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('challenges', sa.Column('deploy_file', sa.String(length=256), nullable=True))


def downgrade():
    op.drop_column('challenges', 'deploy_file')
