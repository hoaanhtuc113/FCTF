"""Add ondelete cascade to foreign keys

Revision ID: b295b033364d
Revises: b5551cd26764
Create Date: 2019-05-03 19:26:57.746887

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b295b033364d"
down_revision = "b5551cd26764"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(constraint_name, table_name):
    """Drop a foreign key constraint only if it exists (MySQL)."""
    bind = op.get_bind()
    result = bind.execute(sa.text(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = :table AND CONSTRAINT_NAME = :name "
        "AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
    ), {"table": table_name, "name": constraint_name})
    if result.fetchone():
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def upgrade():
    bind = op.get_bind()
    url = str(bind.engine.url)
    if url.startswith("mysql"):
        _drop_fk_if_exists("awards_ibfk_1", "awards")
        _drop_fk_if_exists("awards_ibfk_2", "awards")
        op.create_foreign_key(
            "awards_ibfk_1", "awards", "teams", ["team_id"], ["id"], ondelete="CASCADE"
        )
        op.create_foreign_key(
            "awards_ibfk_2", "awards", "users", ["user_id"], ["id"], ondelete="CASCADE"
        )

        _drop_fk_if_exists("files_ibfk_1", "files")
        op.create_foreign_key(
            "files_ibfk_1",
            "files",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        _drop_fk_if_exists("flags_ibfk_1", "flags")
        op.create_foreign_key(
            "flags_ibfk_1",
            "flags",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        _drop_fk_if_exists("hints_ibfk_1", "hints")
        op.create_foreign_key(
            "hints_ibfk_1",
            "hints",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        _drop_fk_if_exists("tags_ibfk_1", "tags")
        op.create_foreign_key(
            "tags_ibfk_1",
            "tags",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        _drop_fk_if_exists("team_captain_id", "teams")
        op.create_foreign_key(
            "team_captain_id",
            "teams",
            "users",
            ["captain_id"],
            ["id"],
            ondelete="SET NULL",
        )

        _drop_fk_if_exists("tracking_ibfk_1", "tracking")
        op.create_foreign_key(
            "tracking_ibfk_1",
            "tracking",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

        _drop_fk_if_exists("unlocks_ibfk_1", "unlocks")
        _drop_fk_if_exists("unlocks_ibfk_2", "unlocks")
        op.create_foreign_key(
            "unlocks_ibfk_1",
            "unlocks",
            "teams",
            ["team_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "unlocks_ibfk_2",
            "unlocks",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
    elif url.startswith("postgres"):
        op.drop_constraint("awards_team_id_fkey", "awards", type_="foreignkey")
        op.drop_constraint("awards_user_id_fkey", "awards", type_="foreignkey")
        op.create_foreign_key(
            "awards_team_id_fkey",
            "awards",
            "teams",
            ["team_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "awards_user_id_fkey",
            "awards",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("files_challenge_id_fkey", "files", type_="foreignkey")
        op.create_foreign_key(
            "files_challenge_id_fkey",
            "files",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("flags_challenge_id_fkey", "flags", type_="foreignkey")
        op.create_foreign_key(
            "flags_challenge_id_fkey",
            "flags",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("hints_challenge_id_fkey", "hints", type_="foreignkey")
        op.create_foreign_key(
            "hints_challenge_id_fkey",
            "hints",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("tags_challenge_id_fkey", "tags", type_="foreignkey")
        op.create_foreign_key(
            "tags_challenge_id_fkey",
            "tags",
            "challenges",
            ["challenge_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("team_captain_id", "teams", type_="foreignkey")
        op.create_foreign_key(
            "team_captain_id",
            "teams",
            "users",
            ["captain_id"],
            ["id"],
            ondelete="SET NULL",
        )

        op.drop_constraint("tracking_user_id_fkey", "tracking", type_="foreignkey")
        op.create_foreign_key(
            "tracking_user_id_fkey",
            "tracking",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

        op.drop_constraint("unlocks_team_id_fkey", "unlocks", type_="foreignkey")
        op.drop_constraint("unlocks_user_id_fkey", "unlocks", type_="foreignkey")
        op.create_foreign_key(
            "unlocks_team_id_fkey",
            "unlocks",
            "teams",
            ["team_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "unlocks_user_id_fkey",
            "unlocks",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade():
    bind = op.get_bind()
    url = str(bind.engine.url)
    if url.startswith("mysql"):
        op.drop_constraint("unlocks_ibfk_1", "unlocks", type_="foreignkey")
        op.drop_constraint("unlocks_ibfk_2", "unlocks", type_="foreignkey")
        op.create_foreign_key("unlocks_ibfk_1", "unlocks", "teams", ["team_id"], ["id"])
        op.create_foreign_key("unlocks_ibfk_2", "unlocks", "users", ["user_id"], ["id"])

        op.drop_constraint("tracking_ibfk_1", "tracking", type_="foreignkey")
        op.create_foreign_key(
            "tracking_ibfk_1", "tracking", "users", ["user_id"], ["id"]
        )

        op.drop_constraint("team_captain_id", "teams", type_="foreignkey")
        op.create_foreign_key(
            "team_captain_id", "teams", "users", ["captain_id"], ["id"]
        )

        op.drop_constraint("tags_ibfk_1", "tags", type_="foreignkey")
        op.create_foreign_key(
            "tags_ibfk_1", "tags", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("hints_ibfk_1", "hints", type_="foreignkey")
        op.create_foreign_key(
            "hints_ibfk_1", "hints", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("flags_ibfk_1", "flags", type_="foreignkey")
        op.create_foreign_key(
            "flags_ibfk_1", "flags", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("files_ibfk_1", "files", type_="foreignkey")
        op.create_foreign_key(
            "files_ibfk_1", "files", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("awards_ibfk_1", "awards", type_="foreignkey")
        op.drop_constraint("awards_ibfk_2", "awards", type_="foreignkey")
        op.create_foreign_key("awards_ibfk_1", "awards", "teams", ["team_id"], ["id"])
        op.create_foreign_key("awards_ibfk_2", "awards", "users", ["user_id"], ["id"])
    elif url.startswith("postgres"):
        op.drop_constraint("unlocks_team_id_fkey", "unlocks", type_="foreignkey")
        op.drop_constraint("unlocks_user_id_fkey", "unlocks", type_="foreignkey")
        op.create_foreign_key(
            "unlocks_team_id_fkey", "unlocks", "teams", ["team_id"], ["id"]
        )
        op.create_foreign_key(
            "unlocks_user_id_fkey", "unlocks", "users", ["user_id"], ["id"]
        )

        op.drop_constraint("tracking_user_id_fkey", "tracking", type_="foreignkey")
        op.create_foreign_key(
            "tracking_user_id_fkey", "tracking", "users", ["user_id"], ["id"]
        )

        op.drop_constraint("team_captain_id", "teams", type_="foreignkey")
        op.create_foreign_key(
            "team_captain_id", "teams", "users", ["captain_id"], ["id"]
        )

        op.drop_constraint("tags_challenge_id_fkey", "tags", type_="foreignkey")
        op.create_foreign_key(
            "tags_challenge_id_fkey", "tags", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("hints_challenge_id_fkey", "hints", type_="foreignkey")
        op.create_foreign_key(
            "hints_challenge_id_fkey", "hints", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("flags_challenge_id_fkey", "flags", type_="foreignkey")
        op.create_foreign_key(
            "flags_challenge_id_fkey", "flags", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("files_challenge_id_fkey", "files", type_="foreignkey")
        op.create_foreign_key(
            "files_challenge_id_fkey", "files", "challenges", ["challenge_id"], ["id"]
        )

        op.drop_constraint("awards_team_id_fkey", "awards", type_="foreignkey")
        op.drop_constraint("awards_user_id_fkey", "awards", type_="foreignkey")
        op.create_foreign_key(
            "awards_team_id_fkey", "awards", "teams", ["team_id"], ["id"]
        )
        op.create_foreign_key(
            "awards_user_id_fkey", "awards", "users", ["user_id"], ["id"]
        )
