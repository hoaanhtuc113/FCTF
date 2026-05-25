"""Restore action_logs id auto increment

Revision ID: f4a6b8c9d0e1
Revises: d0e1f2a3b4c5
Create Date: 2026-05-25

The action_logs camelCase to snake_case migration renamed actionId to id on
MySQL/MariaDB. On some production databases that ALTER lost the AUTO_INCREMENT
attribute, so inserts from ContestantBE fail with:

    Field 'id' doesn't have a default value
"""

from alembic import op

revision = 'f4a6b8c9d0e1'
down_revision = 'd0e1f2a3b4c5'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE action_logs "
        "MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT"
    )


def downgrade():
    op.execute(
        "ALTER TABLE action_logs "
        "MODIFY COLUMN id INT(11) NOT NULL"
    )
