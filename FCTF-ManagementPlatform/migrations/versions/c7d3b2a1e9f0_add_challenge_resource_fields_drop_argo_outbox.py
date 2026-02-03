"""add challenge resources and drop argo_outbox

Revision ID: c7d3b2a1e9f0
Revises: 9a2500d5d2fd
Create Date: 2026-02-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


def _has_table(bind, table_name: str) -> bool:
    inspector = sa.inspect(bind)
    return inspector.has_table(table_name)


# revision identifiers, used by Alembic.
revision = "c7d3b2a1e9f0"
down_revision = "9a2500d5d2fd"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "challenges",
        sa.Column("cpu_limit", sa.Integer(), nullable=False, server_default="300"),
    )
    op.add_column(
        "challenges",
        sa.Column("cpu_request", sa.Integer(), nullable=False, server_default="300"),
    )
    op.add_column(
        "challenges",
        sa.Column("memory_limit", sa.Integer(), nullable=False, server_default="256"),
    )
    op.add_column(
        "challenges",
        sa.Column("memory_request", sa.Integer(), nullable=False, server_default="256"),
    )
    op.add_column(
        "challenges",
        sa.Column(
            "use_gvisor", sa.Boolean(), nullable=False, server_default=sa.text("1")
        ),
    )

    bind = op.get_bind()
    if _has_table(bind, "argo_outbox"):
        op.drop_table("argo_outbox")



def downgrade():
    bind = op.get_bind()
    if not _has_table(bind, "argo_outbox"):
        op.create_table(
            "argo_outbox",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("status", sa.Integer(), nullable=True),
            sa.Column("expiry", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("workflow_name", sa.String(length=255), nullable=True),
            sa.Column("processing_at", sa.DateTime(), nullable=True),
            sa.Column("retry_count", sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )

    op.drop_column("challenges", "use_gvisor")
    op.drop_column("challenges", "memory_request")
    op.drop_column("challenges", "memory_limit")
    op.drop_column("challenges", "cpu_request")
    op.drop_column("challenges", "cpu_limit")
