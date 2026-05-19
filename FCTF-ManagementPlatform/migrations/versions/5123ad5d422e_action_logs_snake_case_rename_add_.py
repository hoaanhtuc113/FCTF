"""action_logs snake_case rename add contest_id to tracking tickets fields field_entries

Revision ID: 5123ad5d422e
Revises: ee355851f93f
Create Date: 2026-05-19 14:35:39.167460

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '5123ad5d422e'
down_revision = 'ee355851f93f'
branch_labels = None
depends_on = None


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # --- action_logs: rename camelCase columns to snake_case ---
    _drop_fks_on_columns(inspector, 'action_logs', ['userId'])

    op.alter_column('action_logs', 'actionId', new_column_name='id',
        existing_type=sa.Integer(), existing_nullable=False)
    op.alter_column('action_logs', 'userId', new_column_name='user_id',
        existing_type=sa.Integer(), existing_nullable=True, nullable=True)
    op.alter_column('action_logs', 'actionDate', new_column_name='date',
        existing_type=sa.DateTime(), existing_nullable=False)
    op.alter_column('action_logs', 'actionType', new_column_name='type',
        existing_type=sa.Integer(), existing_nullable=False)
    op.alter_column('action_logs', 'actionDetail', new_column_name='detail',
        existing_type=sa.String(255), existing_nullable=False)
    op.alter_column('action_logs', 'topicName', new_column_name='topic_name',
        existing_type=sa.String(255), existing_nullable=True, nullable=True)

    op.add_column('action_logs', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_action_logs_user_id', 'action_logs', 'users', ['user_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key(
        'fk_action_logs_contest_id', 'action_logs', 'contests', ['contest_id'], ['id'], ondelete='SET NULL')

    # --- tickets: rename create_at → created_at, add contest_id ---
    op.alter_column('tickets', 'create_at', new_column_name='created_at',
        existing_type=sa.DateTime(), existing_nullable=True, nullable=True)
    op.add_column('tickets', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_tickets_contest_id', 'tickets', 'contests', ['contest_id'], ['id'], ondelete='SET NULL')

    # --- tracking: add contest_id only (keep user_id FK as-is) ---
    op.add_column('tracking', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_tracking_contest_id', 'tracking', 'contests', ['contest_id'], ['id'], ondelete='SET NULL')

    # --- fields: add contest_id ---
    op.add_column('fields', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_fields_contest_id', 'fields', 'contests', ['contest_id'], ['id'], ondelete='SET NULL')

    # --- field_entries: add contest_id ---
    op.add_column('field_entries', sa.Column('contest_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_field_entries_contest_id', 'field_entries', 'contests', ['contest_id'], ['id'], ondelete='SET NULL')


def downgrade():
    bind = op.get_bind()

    op.drop_constraint('fk_field_entries_contest_id', 'field_entries', type_='foreignkey')
    op.drop_column('field_entries', 'contest_id')

    op.drop_constraint('fk_fields_contest_id', 'fields', type_='foreignkey')
    op.drop_column('fields', 'contest_id')

    op.drop_constraint('fk_tracking_contest_id', 'tracking', type_='foreignkey')
    op.drop_column('tracking', 'contest_id')

    op.drop_constraint('fk_tickets_contest_id', 'tickets', type_='foreignkey')
    op.drop_column('tickets', 'contest_id')
    op.alter_column('tickets', 'created_at', new_column_name='create_at',
        existing_type=sa.DateTime(), existing_nullable=True, nullable=True)

    op.drop_constraint('fk_action_logs_contest_id', 'action_logs', type_='foreignkey')
    op.drop_constraint('fk_action_logs_user_id', 'action_logs', type_='foreignkey')
    op.drop_column('action_logs', 'contest_id')
    op.alter_column('action_logs', 'topic_name', new_column_name='topicName',
        existing_type=sa.String(255), existing_nullable=True)
    op.alter_column('action_logs', 'detail', new_column_name='actionDetail',
        existing_type=sa.String(255), existing_nullable=False)
    op.alter_column('action_logs', 'type', new_column_name='actionType',
        existing_type=sa.Integer(), existing_nullable=False)
    op.alter_column('action_logs', 'date', new_column_name='actionDate',
        existing_type=sa.DateTime(), existing_nullable=False)
    op.alter_column('action_logs', 'user_id', new_column_name='userId',
        existing_type=sa.Integer(), existing_nullable=True)
    op.alter_column('action_logs', 'id', new_column_name='actionId',
        existing_type=sa.Integer(), existing_nullable=False)
    op.create_foreign_key('userId', 'action_logs', 'users', ['userId'], ['id'])
