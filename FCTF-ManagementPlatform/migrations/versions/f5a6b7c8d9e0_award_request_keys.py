"""Persist award idempotency keys without altering historical awards."""

from alembic import op
import sqlalchemy as sa

revision = "f5a6b7c8d9e0"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("awards", sa.Column("request_key", sa.String(64), nullable=True))
    op.add_column("awards", sa.Column("request_hash", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_awards_request_key", "awards", ["request_key"])


def downgrade():
    op.drop_constraint("uq_awards_request_key", "awards", type_="unique")
    op.drop_column("awards", "request_hash")
    op.drop_column("awards", "request_key")
