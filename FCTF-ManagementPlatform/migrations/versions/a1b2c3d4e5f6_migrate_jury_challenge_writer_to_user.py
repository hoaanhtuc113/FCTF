"""Migrate jury/challenge_writer platform types to user + create ContestParticipant records

Revision ID: a1b2c3d4e5f6
Revises: ccb6204815ab
Create Date: 2026-05-25

Background
----------
Previously users.type could be 'jury' or 'challenge_writer' (platform-level roles).
After the multi-contest refactor, users.type is now only 'admin' or 'user'.
Contest-level roles (contestant / jury / challenge_writer) live in contest_participants.

This migration:
  1. Finds all users with type IN ('jury', 'challenge_writer')
  2. For each, creates a ContestParticipant record in every contest they had submissions in
     (so their contest role is preserved as best-effort)
  3. Updates users.type = 'user' for all affected rows
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column, text

revision = 'a1b2c3d4e5f6'
down_revision = 'ccb6204815ab'
branch_labels = None
depends_on = None

ROLE_MAP = {
    'jury': 'jury',
    'challenge_writer': 'challenge_writer',
}


def upgrade():
    bind = op.get_bind()

    # 1. Find affected users
    rows = bind.execute(text(
        "SELECT id, type FROM users WHERE type IN ('jury', 'challenge_writer')"
    )).fetchall()

    if rows:
        # 2. Best-effort: create ContestParticipant records for each affected user
        #    Map user → contests they participated in via submissions
        for user_id, user_type in rows:
            contest_role = ROLE_MAP.get(user_type, 'contestant')

            # Find contests this user submitted to
            contest_ids_rows = bind.execute(text("""
                SELECT DISTINCT c.id
                FROM contests c
                JOIN challenges ch ON ch.contest_id = c.id
                JOIN submissions s ON s.challenge_id = ch.id
                WHERE s.user_id = :uid
            """), {"uid": user_id}).fetchall()

            for (contest_id,) in contest_ids_rows:
                # Check if record already exists
                existing = bind.execute(text(
                    "SELECT id FROM contest_participants WHERE contest_id = :cid AND user_id = :uid"
                ), {"cid": contest_id, "uid": user_id}).fetchone()

                if not existing:
                    bind.execute(text(
                        "INSERT INTO contest_participants (contest_id, user_id, role, joined_at) "
                        "VALUES (:cid, :uid, :role, NOW())"
                    ), {"cid": contest_id, "uid": user_id, "role": contest_role})

        # 3. Update users.type to 'user' for all affected rows
        bind.execute(text(
            "UPDATE users SET type = 'user' WHERE type IN ('jury', 'challenge_writer')"
        ))

    print(f"[migration] Updated {len(rows)} users: jury/challenge_writer → user")


def downgrade():
    # Cannot reliably restore old types — ContestParticipant records remain
    # This migration is intentionally irreversible at the type level
    pass
