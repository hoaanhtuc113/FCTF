"""Enforce generated username uniqueness and non-NULL award names.

Preflight checks intentionally stop before DDL when historical rows conflict.
"""
from alembic import op
import sqlalchemy as sa

revision = "a6b7c8d9e0f1"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    users = sa.table("users", sa.column("id"), sa.column("name"))
    groups = {}
    for record_id, key in connection.execute(sa.select(users.c.id, sa.func.lower(sa.func.trim(users.c.name)))):
        if key is not None:
            groups.setdefault(key, []).append(record_id)
    duplicates = [ids for ids in groups.values() if len(ids) > 1]
    awards = sa.table("awards", sa.column("id"), sa.column("name"))
    unnamed = list(connection.execute(sa.select(awards.c.id).where(awards.c.name.is_(None)).limit(20)).scalars())
    if duplicates or unnamed:
        raise RuntimeError("Repair legacy rows before migrating. Duplicate username ID groups: {}; NULL award name IDs: {}".format(duplicates[:20], unnamed))
    name_type = sa.String(128)
    if connection.dialect.name == "mysql":
        from sqlalchemy.dialects.mysql import VARCHAR
        name_type = VARCHAR(128, charset="utf8mb4", collation="utf8mb4_bin")
    with op.batch_alter_table("users", recreate="always" if connection.dialect.name == "sqlite" else "auto") as batch:
        batch.add_column(sa.Column("name_key", name_type,
                         sa.Computed("lower(trim(name))", persisted=True)))
        batch.create_index("uq_users_name_key", ["name_key"], unique=True)
    with op.batch_alter_table("awards") as batch:
        batch.alter_column("name", existing_type=sa.String(80), nullable=False)


def downgrade():
    with op.batch_alter_table("awards") as batch:
        batch.alter_column("name", existing_type=sa.String(80), nullable=True)
    op.drop_index("uq_users_name_key", table_name="users")
    op.drop_column("users", "name_key")
