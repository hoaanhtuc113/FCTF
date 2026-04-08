"""add connection_protocol to challenges

Revision ID: e9a1c2d3f4b5
Revises: d4e5f6a7b8c9
Create Date: 2026-04-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e9a1c2d3f4b5"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "challenges",
        sa.Column(
            "connection_protocol",
            sa.String(length=10),
            nullable=False,
            server_default="http",
        ),
    )


def downgrade():
    op.drop_column("challenges", "connection_protocol")
