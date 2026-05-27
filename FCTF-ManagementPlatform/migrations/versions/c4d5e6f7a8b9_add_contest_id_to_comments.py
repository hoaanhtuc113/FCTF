"""Add contest_id to comments for per-contest user comments

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-05-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('comments')]
    if 'contest_id' not in cols:
        op.add_column(
            'comments',
            sa.Column('contest_id', sa.Integer(), nullable=True)
        )
        op.create_foreign_key(
            'fk_comments_contest_id',
            'comments', 'contests',
            ['contest_id'], ['id'],
            ondelete='CASCADE'
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    for fk in inspector.get_foreign_keys('comments'):
        if 'contest_id' in fk.get('constrained_columns', []):
            if fk.get('name'):
                op.drop_constraint(fk['name'], 'comments', type_='foreignkey')
            break
    cols = [c['name'] for c in inspector.get_columns('comments')]
    if 'contest_id' in cols:
        op.drop_column('comments', 'contest_id')
