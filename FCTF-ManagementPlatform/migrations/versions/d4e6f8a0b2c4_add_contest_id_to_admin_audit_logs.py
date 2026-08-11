"""add contest_id to admin_audit_logs

Revision ID: d4e6f8a0b2c4
Revises: 7ad27bd6692c
Create Date: 2026-08-10 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e6f8a0b2c4'
down_revision = '7ad27bd6692c'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'admin_audit_logs',
        sa.Column('contest_id', sa.Integer(), nullable=True)
    )
    op.create_index(
        'ix_admin_audit_logs_contest_id',
        'admin_audit_logs',
        ['contest_id']
    )


def downgrade():
    op.drop_index(
        'ix_admin_audit_logs_contest_id',
        table_name='admin_audit_logs'
    )
    op.drop_column('admin_audit_logs', 'contest_id')
