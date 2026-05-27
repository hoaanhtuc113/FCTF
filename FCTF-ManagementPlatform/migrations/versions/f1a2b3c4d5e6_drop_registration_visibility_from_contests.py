"""Drop orphaned registration_visibility column from contests table

The column was created in the initial contests migration but is not
represented in the Contests SQLAlchemy model (platform-wide
registration_visibility is stored in the config table instead).
Because it has nullable=False with no server_default, any INSERT to
contests fails with OperationalError 1364.

Revision ID: f1a2b3c4d5e6
Revises: e4c52818cd2a
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'e4c52818cd2a'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('contests', 'registration_visibility')


def downgrade():
    op.add_column(
        'contests',
        sa.Column(
            'registration_visibility',
            mysql.VARCHAR(length=32),
            nullable=False,
            server_default='public',
        )
    )
