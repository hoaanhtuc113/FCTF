import sqlalchemy as sa
from alembic import op


def drop_fk_if_exists(constraint_name, table_name):
    """Drop a MySQL foreign key only if it exists."""
    bind = op.get_bind()
    row = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = :t AND CONSTRAINT_NAME = :c "
        "AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
    ), {"t": table_name, "c": constraint_name}).fetchone()
    if row:
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def drop_unique_if_exists(constraint_name, table_name):
    """Drop a unique/index constraint only if it exists."""
    bind = op.get_bind()
    row = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = :t AND CONSTRAINT_NAME = :c"
    ), {"t": table_name, "c": constraint_name}).fetchone()
    if row:
        op.drop_constraint(constraint_name, table_name, type_="unique")
