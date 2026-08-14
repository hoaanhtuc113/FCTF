"""Merge heads

The action-log diff columns (c7d9e1f3a5b8) and the notifications tables
(37c36844047f) were both branched off d4e6f8a0b2c4 independently and merged
into v5/main without anyone rebasing one onto the other, leaving two
heads. `flask db upgrade head` refuses to guess between them, so the
container's migration step failed on startup and the new pod never became
ready — which is what stalled the admin-mvc rollout.

Revision ID: fe2f937cf467
Revises: c7d9e1f3a5b8, 37c36844047f
Create Date: 2026-08-15 00:00:00.000000

"""

# revision identifiers, used by Alembic.
revision = 'fe2f937cf467'
down_revision = ('c7d9e1f3a5b8', '37c36844047f')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
