"""add durable challenge instance registry and request-log audit target

Revision ID: i8d2e7f4a9b1
Revises: 37c36844047f, b1c2d3e4f5a6, c5e9f1a3b6d7, c7d9e1f3a5b8, f5a7b9c1d3e2
Create Date: 2026-09-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "i8d2e7f4a9b1"
down_revision = (
    "37c36844047f",
    "b1c2d3e4f5a6",
    "c5e9f1a3b6d7",
    "c7d9e1f3a5b8",
    "f5a7b9c1d3e2",
)
branch_labels = None
depends_on = None


def _has_table(bind, name):
    return sa.inspect(bind).has_table(name)


def _has_column(bind, table, name):
    return name in {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade():
    bind = op.get_bind()
    dt6 = mysql.DATETIME(fsp=6)

    if not _has_table(bind, "challenge_instances"):
        op.create_table(
            "challenge_instances",
            sa.Column("instance_id", sa.String(36, collation="ascii_bin"), primary_key=True, nullable=False),
            sa.Column("provision_request_id", sa.String(36, collation="ascii_bin"), nullable=False),
            sa.Column("contest_id", sa.Integer(), nullable=False),
            sa.Column("challenge_id", sa.Integer(), nullable=False),
            sa.Column("contest_name_snapshot", sa.String(255), nullable=False),
            sa.Column("challenge_name_snapshot", sa.String(255), nullable=False),
            sa.Column("namespace", sa.String(63, collation="ascii_bin"), nullable=False),
            sa.Column("instance_scope", sa.String(16), nullable=False),
            sa.Column("instance_owner_team_id", sa.Integer(), nullable=True),
            sa.Column("owner_team_name_snapshot", sa.String(255), nullable=True),
            sa.Column("started_by_user_id", sa.Integer(), nullable=True),
            sa.Column("requested_at", dt6, nullable=False),
            sa.Column("running_at", dt6, nullable=True),
            sa.Column("stopped_at", dt6, nullable=True),
            sa.Column("expires_at", dt6, nullable=True),
            sa.Column("lifecycle_state", sa.String(24), nullable=False),
            sa.Column("terminal_reason", sa.String(64), nullable=True),
            sa.Column("identity_source", sa.String(16), nullable=False),
            sa.Column("state_version", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("state_changed_at", dt6, nullable=False),
            sa.Column("created_at", dt6, nullable=False),
            sa.Column("updated_at", dt6, nullable=False),
            sa.CheckConstraint(
                "(instance_scope = 'team' AND instance_owner_team_id IS NOT NULL) OR "
                "(instance_scope = 'shared' AND instance_owner_team_id IS NULL)",
                name="ck_challenge_instances_scope_owner",
            ),
            sa.CheckConstraint(
                "lifecycle_state IN ('provisioning', 'running', 'stopping', 'stopped', 'failed')",
                name="ck_challenge_instances_lifecycle",
            ),
        )
        op.create_index("uq_challenge_instances_provision_request_id", "challenge_instances", ["provision_request_id"], unique=True)
        op.create_index("uq_challenge_instances_namespace", "challenge_instances", ["namespace"], unique=True)
        op.create_index("ix_challenge_instances_contest_challenge_requested", "challenge_instances", ["contest_id", "challenge_id", "requested_at"])
        op.create_index("ix_challenge_instances_state_expires", "challenge_instances", ["lifecycle_state", "expires_at"])

    if not _has_table(bind, "challenge_instance_pods"):
        op.create_table(
            "challenge_instance_pods",
            sa.Column("instance_id", sa.String(36, collation="ascii_bin"), nullable=False),
            sa.Column("pod_uid", sa.String(64, collation="ascii_bin"), nullable=False),
            sa.Column("pod_name", sa.String(63, collation="ascii_bin"), nullable=False),
            sa.Column("first_observed_at", dt6, nullable=False),
            sa.Column("last_observed_at", dt6, nullable=False),
            sa.Column("terminated_at", dt6, nullable=True),
            sa.Column("termination_reason", sa.String(64), nullable=True),
            sa.PrimaryKeyConstraint("instance_id", "pod_uid"),
            sa.ForeignKeyConstraint(["instance_id"], ["challenge_instances.instance_id"], ondelete="RESTRICT", name="fk_challenge_instance_pods_instance"),
        )
        op.create_index("ix_challenge_instance_pods_instance_observed", "challenge_instance_pods", ["instance_id", "last_observed_at"])
        op.create_index("uq_challenge_instance_pods_pod_uid", "challenge_instance_pods", ["pod_uid"], unique=True)

    # An instance UUID cannot fit in target_id. Keep the numeric field nullable
    # for legacy audit rows and index the new immutable business reference.
    if _has_table(bind, "admin_audit_logs") and not _has_column(bind, "admin_audit_logs", "target_ref"):
        op.add_column("admin_audit_logs", sa.Column("target_ref", sa.String(36, collation="ascii_bin"), nullable=True))
        op.create_index("ix_admin_audit_logs_target_ref_timestamp", "admin_audit_logs", ["target_type", "target_ref", "timestamp"])


def downgrade():
    bind = op.get_bind()
    if _has_table(bind, "admin_audit_logs") and _has_column(bind, "admin_audit_logs", "target_ref"):
        op.drop_index("ix_admin_audit_logs_target_ref_timestamp", table_name="admin_audit_logs")
        op.drop_column("admin_audit_logs", "target_ref")
    if _has_table(bind, "challenge_instance_pods"):
        op.drop_index("uq_challenge_instance_pods_pod_uid", table_name="challenge_instance_pods")
        op.drop_index("ix_challenge_instance_pods_instance_observed", table_name="challenge_instance_pods")
        op.drop_table("challenge_instance_pods")
    if _has_table(bind, "challenge_instances"):
        op.drop_index("ix_challenge_instances_state_expires", table_name="challenge_instances")
        op.drop_index("ix_challenge_instances_contest_challenge_requested", table_name="challenge_instances")
        op.drop_index("uq_challenge_instances_namespace", table_name="challenge_instances")
        op.drop_index("uq_challenge_instances_provision_request_id", table_name="challenge_instances")
        op.drop_table("challenge_instances")
