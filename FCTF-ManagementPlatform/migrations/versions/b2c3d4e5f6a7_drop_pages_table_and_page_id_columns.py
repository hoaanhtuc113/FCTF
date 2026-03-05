"""Drop pages table and page_id columns from files and comments

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def _fks_on_column(bind, table_name, column_name):
    """Return names of all FKs that include the given column."""
    inspector = Inspector.from_engine(bind)
    fks = inspector.get_foreign_keys(table_name)
    return [
        fk["name"]
        for fk in fks
        if fk.get("name") and column_name in fk.get("constrained_columns", [])
    ]


def _column_exists(bind, table_name, column_name):
    inspector = Inspector.from_engine(bind)
    cols = inspector.get_columns(table_name)
    return any(col["name"] == column_name for col in cols)


def _table_exists(bind, table_name):
    inspector = Inspector.from_engine(bind)
    return table_name in inspector.get_table_names()


def upgrade():
    bind = op.get_bind()

    # Drop any foreign keys on page_id + the column itself from comments
    with op.batch_alter_table("comments", schema=None) as batch_op:
        for fk_name in _fks_on_column(bind, "comments", "page_id"):
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        if _column_exists(bind, "comments", "page_id"):
            batch_op.drop_column("page_id")

    # Drop any foreign keys on page_id + the column itself from files
    with op.batch_alter_table("files", schema=None) as batch_op:
        for fk_name in _fks_on_column(bind, "files", "page_id"):
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        if _column_exists(bind, "files", "page_id"):
            batch_op.drop_column("page_id")

    # Drop the pages table
    if _table_exists(bind, "pages"):
        op.drop_table("pages")


def downgrade():
    # Recreate pages table
    op.create_table(
        "pages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=True),
        sa.Column("route", sa.String(length=128), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("draft", sa.Boolean(), nullable=True),
        sa.Column("hidden", sa.Boolean(), nullable=True),
        sa.Column("auth_required", sa.Boolean(), nullable=True),
        sa.Column("format", sa.String(length=80), nullable=True),
        sa.Column("link_target", sa.String(length=80), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route"),
    )

    # Re-add page_id to files
    with op.batch_alter_table("files", schema=None) as batch_op:
        batch_op.add_column(sa.Column("page_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "files_ibfk_page", "pages", ["page_id"], ["id"]
        )

    # Re-add page_id to comments
    with op.batch_alter_table("comments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("page_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "comments_ibfk_page", "pages", ["page_id"], ["id"], ondelete="CASCADE"
        )
