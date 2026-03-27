"""add admin_audit_logs table

Revision ID: b7c8d9e0f1a2
Revises: f2b3c4d5e6a7
Create Date: 2026-02-27 00:01:00.000000

Adds ``admin_audit_logs`` — a persistent record of every privileged
mutation performed by admins, jury users, and challenge writers.

Each row captures:
  * Who acted  (actor_id / actor_name / actor_type)
  * What changed  (action / target_type / target_id)
  * State snapshots  (before_state / after_state as JSON)
  * Extra context  (extra_data as JSON)
  * Request metadata  (ip_address / timestamp)
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision      = "b7c8d9e0f1a2"
down_revision = "f2b3c4d5e6a7"
branch_labels = None
depends_on    = None


def upgrade():
    op.create_table(
        "admin_audit_logs",
        sa.Column("id",           sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("actor_id",     sa.Integer(),    sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_name",   sa.String(128),  nullable=True),
        sa.Column("actor_type",   sa.String(80),   nullable=True),
        sa.Column("action",       sa.String(128),  nullable=False),
        sa.Column("target_type",  sa.String(80),   nullable=True),
        sa.Column("target_id",    sa.Integer(),    nullable=True),
        sa.Column("before_state", sa.JSON(),        nullable=True),
        sa.Column("after_state",  sa.JSON(),        nullable=True),
        sa.Column("extra_data",   sa.JSON(),        nullable=True),
        sa.Column("ip_address",   sa.String(46),   nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    # Index on timestamp for efficient date-range filtering
    op.create_index("ix_admin_audit_logs_timestamp", "admin_audit_logs", ["timestamp"])
    # Composite index for common actor-based queries
    op.create_index("ix_admin_audit_logs_actor_id_ts", "admin_audit_logs", ["actor_id", "timestamp"])
    # Index to filter by action / target pair
    op.create_index("ix_admin_audit_logs_action", "admin_audit_logs", ["action"])


def downgrade():
    op.drop_index("ix_admin_audit_logs_action",      table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_actor_id_ts", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_timestamp",   table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
