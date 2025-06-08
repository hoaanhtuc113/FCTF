"""Add Brackets table

Revision ID: 9889b8c53673
Revises: 5c4996aeb2cb
Create Date: 2024-01-25 03:17:52.734753

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "9889b8c53673"
down_revision = "5c4996aeb2cb"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    # Create the 'brackets' table if it does not exist
    if not inspector.has_table("brackets"):
        op.create_table(
            "brackets",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("type", sa.String(length=80), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )

    # Modify 'teams' table if it exists
    if inspector.has_table("teams"):
        columns = {col["name"] for col in inspector.get_columns("teams")}

        # Add 'bracket_id' column if it doesn't exist
        if "bracket_id" not in columns:
            op.add_column("teams", sa.Column("bracket_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_teams_bracket_id",  # Foreign key name
                "teams",
                "brackets",
                ["bracket_id"],
                ["id"],
                ondelete="SET NULL",
            )

        # Drop 'bracket' column if it exists
        if "bracket" in columns:
            op.drop_column("teams", "bracket")

    # Modify 'users' table if it exists
    if inspector.has_table("users"):
        columns = {col["name"] for col in inspector.get_columns("users")}

        # Add 'bracket_id' column if it doesn't exist
        if "bracket_id" not in columns:
            op.add_column("users", sa.Column("bracket_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_users_bracket_id",  # Foreign key name
                "users",
                "brackets",
                ["bracket_id"],
                ["id"],
                ondelete="SET NULL",
            )

        # Drop 'bracket' column if it exists
        if "bracket" in columns:
            op.drop_column("users", "bracket")


def downgrade():
    op.add_column(
        "users", sa.Column("bracket", mysql.VARCHAR(length=32), nullable=True)
    )
    op.drop_constraint(None, "users", type_="foreignkey")
    op.drop_column("users", "bracket_id")
    op.add_column(
        "teams", sa.Column("bracket", mysql.VARCHAR(length=32), nullable=True)
    )
    op.drop_constraint(None, "teams", type_="foreignkey")
    op.drop_column("teams", "bracket_id")
    op.drop_table("brackets")
