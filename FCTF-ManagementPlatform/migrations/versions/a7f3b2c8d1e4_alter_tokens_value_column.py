"""Alter tokens value column

Revision ID: a7f3b2c8d1e4
Revises: 11aea6182b75
Create Date: 2025-11-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7f3b2c8d1e4'
down_revision = '11aea6182b75'
branch_labels = None
depends_on = None


def upgrade():
    # Alter tokens.value column to TEXT with utf8mb4 charset
    op.alter_column(
        'tokens',
        'value',
        existing_type=sa.String(length=128),
        type_=sa.Text(),
        existing_nullable=True,
        nullable=True
    )


def downgrade():
    # Revert to original type (VARCHAR(128))
    op.alter_column(
        'tokens',
        'value',
        existing_type=sa.Text(),
        type_=sa.String(length=128),
        existing_nullable=True,
        nullable=True
    )
