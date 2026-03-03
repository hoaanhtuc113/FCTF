"""add stopped_at and label to challenge_start_tracking

Revision ID: c2f7a1b0c1d2
Revises: b7c8d9e0f1a2
Create Date: 2026-03-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c2f7a1b0c1d2"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "challenge_start_tracking",
        sa.Column("stopped_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "challenge_start_tracking",
        sa.Column("label", sa.String(length=255), nullable=True),
    )


def downgrade():
    op.drop_column("challenge_start_tracking", "label")
    op.drop_column("challenge_start_tracking", "stopped_at")
