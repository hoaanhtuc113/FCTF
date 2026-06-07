"""Drop KYPO tables: pool, sandbox_definition, sandbox_challenge, sandbox_run_tracking

Revision ID: f5a7b9c1d3e2
Revises: e1f2a3b4c5d6
Create Date: 2026-06-07 00:00:00.000000

"""
from alembic import op
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = 'f5a7b9c1d3e2'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def _existing_tables():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return set(inspector.get_table_names())


def upgrade():
    tables = _existing_tables()
    if 'sandbox_run_tracking' in tables:
        op.drop_table('sandbox_run_tracking')
    if 'sandbox_challenge' in tables:
        op.drop_table('sandbox_challenge')
    if 'sandbox_definition' in tables:
        op.drop_table('sandbox_definition')
    if 'pool' in tables:
        op.drop_table('pool')


def downgrade():
    pass
