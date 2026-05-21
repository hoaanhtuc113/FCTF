"""replace challenge_templates and contests_challenges with unified challenges table

Revision ID: e6326bc7fe5c
Revises: 0c9d81b33b85
Create Date: 2026-05-21 14:57:12.987713

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = 'e6326bc7fe5c'
down_revision = '0c9d81b33b85'
branch_labels = None
depends_on = None


def _drop_fks_on_columns(inspector, table, columns):
    for fk in inspector.get_foreign_keys(table):
        if any(c in fk.get('constrained_columns', []) for c in columns):
            if fk.get('name'):
                op.drop_constraint(fk['name'], table, type_='foreignkey')


def upgrade():
    from sqlalchemy import inspect as sa_inspect
    bind = op.get_bind()
    inspector = sa_inspect(bind)

    # ── Phase A: table-level work (only needed on a fresh database) ──────────
    # On a previous partial run, challenges + challenge_versions were already
    # created and the old tables were already dropped; skip this entire block.
    if not inspector.has_table('challenges'):

        # 1. Drop FKs that child tables hold against contests_challenges
        for tbl, cols in [
            ('solves',                  ['contest_challenge_id']),
            ('submissions',             ['contest_challenge_id']),
            ('comments',                ['contest_challenge_id']),
            ('unlocks',                 ['contest_challenge_id']),
            ('challenge_start_tracking',['contest_challenge_id']),
        ]:
            if inspector.has_table(tbl):
                _drop_fks_on_columns(inspector, tbl, cols)

        # 2. Drop FKs that contests_challenges holds against other tables
        #    (challenge_templates, challenge_template_versions, self-ref next_id)
        if inspector.has_table('contests_challenges'):
            _drop_fks_on_columns(
                inspector, 'contests_challenges',
                ['challenge_template_id', 'template_version_id', 'next_id', 'contest_id'],
            )
            op.drop_table('contests_challenges')

        # 3. Drop FK that challenge_template_versions holds against challenge_templates
        if inspector.has_table('challenge_template_versions'):
            _drop_fks_on_columns(
                inspector, 'challenge_template_versions',
                ['challenge_template_id', 'created_by'],
            )
            op.drop_table('challenge_template_versions')

        # 4. Drop all remaining FKs that point to challenge_templates
        for tbl, cols in [
            ('dynamic_challenge',   ['id']),
            ('award_badges',        ['challenge_template_id']),
            ('challenge_topics',    ['challenge_template_id']),
            ('deploy_histories',    ['challenge_template_id']),
            ('files',               ['challenge_template_id']),
            ('flags',               ['challenge_template_id']),
            ('hints',               ['challenge_template_id']),
            ('tags',                ['challenge_template_id']),
        ]:
            if inspector.has_table(tbl):
                _drop_fks_on_columns(inspector, tbl, cols)
        if inspector.has_table('multiple_choice_challenge'):
            _drop_fks_on_columns(inspector, 'multiple_choice_challenge', ['id'])

        # 5. Now it is safe to drop challenge_templates
        if inspector.has_table('challenge_templates'):
            op.drop_table('challenge_templates')

        # 6. Create the new unified challenges table
        op.create_table(
            'challenges',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('contest_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(80), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('category', sa.String(80), nullable=True),
            sa.Column('type', sa.String(80), nullable=True),
            sa.Column('difficulty', sa.Integer(), nullable=True),
            sa.Column('value', sa.Integer(), nullable=True),
            sa.Column('state', sa.String(32), nullable=False, server_default='hidden'),
            sa.Column('max_attempts', sa.Integer(), nullable=True),
            sa.Column('cooldown', sa.Integer(), nullable=True),
            sa.Column('time_limit', sa.Integer(), nullable=True),
            sa.Column('start_time', sa.DateTime(), nullable=True),
            sa.Column('finish_time', sa.DateTime(), nullable=True),
            sa.Column('requirements', sa.JSON(), nullable=True),
            sa.Column('next_id', sa.Integer(), nullable=True),
            sa.Column('require_deploy', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('deploy_status', sa.Text(), nullable=True, server_default='CREATED'),
            sa.Column('deploy_file', sa.Text(), nullable=True),
            sa.Column('image_link', sa.Text(), nullable=True),
            sa.Column('connection_info', sa.Text(), nullable=True),
            sa.Column('connection_protocol', sa.String(10), nullable=False, server_default='http'),
            sa.Column('cpu_limit', sa.Integer(), nullable=True),
            sa.Column('cpu_request', sa.Integer(), nullable=True),
            sa.Column('memory_limit', sa.Integer(), nullable=True),
            sa.Column('memory_request', sa.Integer(), nullable=True),
            sa.Column('use_gvisor', sa.Boolean(), nullable=True),
            sa.Column('harden_container', sa.Boolean(), nullable=True, server_default='1'),
            sa.Column('shared_instant', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('max_deploy_count', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('last_update', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['next_id'], ['challenges.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )

    # ── Create challenge_versions if missing (covers both fresh and partial) ──
    if not inspector.has_table('challenge_versions'):
        op.create_table(
            'challenge_versions',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('challenge_id', sa.Integer(), nullable=False),
            sa.Column('version_number', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('image_link', sa.Text(), nullable=True),
            sa.Column('deploy_file', sa.Text(), nullable=True),
            sa.Column('cpu_limit', sa.String(50), nullable=True),
            sa.Column('cpu_request', sa.String(50), nullable=True),
            sa.Column('memory_limit', sa.String(50), nullable=True),
            sa.Column('memory_request', sa.String(50), nullable=True),
            sa.Column('use_gvisor', sa.Boolean(), nullable=True),
            sa.Column('harden_container', sa.Boolean(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('created_by', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(['challenge_id'], ['challenges.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )

    # ── Phase B: column-level work (same for both fresh and partial runs) ─────
    # Refresh the inspector so it reflects the tables we just created/dropped.
    inspector = sa_inspect(bind)

    # Rewire plugin tables to the new challenges table.
    # _drop_fks_on_columns is safe when no FK exists (no-op).
    _drop_fks_on_columns(inspector, 'dynamic_challenge', ['id'])
    op.create_foreign_key(None, 'dynamic_challenge', 'challenges', ['id'], ['id'], ondelete='CASCADE')
    if inspector.has_table('multiple_choice_challenge'):
        _drop_fks_on_columns(inspector, 'multiple_choice_challenge', ['id'])
        op.create_foreign_key(None, 'multiple_choice_challenge', 'challenges', ['id'], ['id'], ondelete='CASCADE')

    # award_badges
    op.add_column('award_badges', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'award_badges', 'challenges', ['challenge_id'], ['id'], ondelete='SET NULL')
    op.drop_column('award_badges', 'challenge_template_id')

    # challenge_start_tracking
    op.add_column('challenge_start_tracking', sa.Column('challenge_id', sa.Integer(), nullable=False))
    op.create_foreign_key(None, 'challenge_start_tracking', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('challenge_start_tracking', 'contest_challenge_id')

    # challenge_topics
    op.add_column('challenge_topics', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'challenge_topics', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('challenge_topics', 'challenge_template_id')

    # comments
    op.add_column('comments', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'comments', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('comments', 'contest_challenge_id')

    # deploy_histories
    op.add_column('deploy_histories', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'deploy_histories', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('deploy_histories', 'challenge_template_id')

    # files
    op.add_column('files', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'files', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('files', 'challenge_template_id')

    # flags
    op.add_column('flags', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'flags', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('flags', 'challenge_template_id')

    # hints
    op.add_column('hints', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'hints', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('hints', 'challenge_template_id')

    # solves
    op.add_column('solves', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.drop_index('uq_solves_cc_team', table_name='solves')
    op.drop_index('uq_solves_cc_user', table_name='solves')
    op.create_unique_constraint(None, 'solves', ['challenge_id', 'team_id'])
    op.create_unique_constraint(None, 'solves', ['challenge_id', 'user_id'])
    op.create_foreign_key(None, 'solves', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('solves', 'contest_challenge_id')

    # submissions
    op.add_column('submissions', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'submissions', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('submissions', 'contest_challenge_id')

    # tags
    op.add_column('tags', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'tags', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('tags', 'challenge_template_id')

    # unlocks
    op.add_column('unlocks', sa.Column('challenge_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'unlocks', 'challenges', ['challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('unlocks', 'contest_challenge_id')
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('unlocks', sa.Column('contest_challenge_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'unlocks', type_='foreignkey')
    op.create_foreign_key('fk_unlocks_contest_challenge_id', 'unlocks', 'contests_challenges', ['contest_challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('unlocks', 'challenge_id')
    op.create_foreign_key('1', 'tracking', 'users', ['user_id'], ['id'])
    op.add_column('tags', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'tags', type_='foreignkey')
    op.create_foreign_key('fk_tags_challenge_template_id', 'tags', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('tags', 'challenge_id')
    op.add_column('submissions', sa.Column('contest_challenge_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'submissions', type_='foreignkey')
    op.create_foreign_key('fk_submissions_contest_challenge_id', 'submissions', 'contests_challenges', ['contest_challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('submissions', 'challenge_id')
    op.add_column('solves', sa.Column('contest_challenge_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'solves', type_='foreignkey')
    op.create_foreign_key('fk_solves_contest_challenge_id', 'solves', 'contests_challenges', ['contest_challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint(None, 'solves', type_='unique')
    op.drop_constraint(None, 'solves', type_='unique')
    op.create_index('uq_solves_cc_user', 'solves', ['contest_challenge_id', 'user_id'], unique=True)
    op.create_index('uq_solves_cc_team', 'solves', ['contest_challenge_id', 'team_id'], unique=True)
    op.drop_column('solves', 'challenge_id')
    op.drop_constraint(None, 'multiple_choice_challenge', type_='foreignkey')
    op.create_foreign_key('1', 'multiple_choice_challenge', 'challenge_templates', ['id'], ['id'], ondelete='CASCADE')
    op.add_column('hints', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'hints', type_='foreignkey')
    op.create_foreign_key('fk_hints_challenge_template_id', 'hints', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('hints', 'challenge_id')
    op.add_column('flags', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'flags', type_='foreignkey')
    op.create_foreign_key('fk_flags_challenge_template_id', 'flags', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('flags', 'challenge_id')
    op.add_column('files', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'files', type_='foreignkey')
    op.create_foreign_key('fk_files_challenge_template_id', 'files', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('files', 'challenge_id')
    op.drop_constraint(None, 'dynamic_challenge', type_='foreignkey')
    op.create_foreign_key('1', 'dynamic_challenge', 'challenge_templates', ['id'], ['id'], ondelete='CASCADE')
    op.add_column('deploy_histories', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'deploy_histories', type_='foreignkey')
    op.create_foreign_key('fk_deploy_histories_challenge_template_id', 'deploy_histories', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('deploy_histories', 'challenge_id')
    op.add_column('comments', sa.Column('contest_challenge_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'comments', type_='foreignkey')
    op.create_foreign_key('fk_comments_contest_challenge_id', 'comments', 'contests_challenges', ['contest_challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('comments', 'challenge_id')
    op.add_column('challenge_topics', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'challenge_topics', type_='foreignkey')
    op.create_foreign_key('fk_challenge_topics_challenge_template_id', 'challenge_topics', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='CASCADE')
    op.drop_column('challenge_topics', 'challenge_id')
    op.add_column('challenge_start_tracking', sa.Column('contest_challenge_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=False))
    op.drop_constraint(None, 'challenge_start_tracking', type_='foreignkey')
    op.create_foreign_key('fk_cst_contest_challenge_id', 'challenge_start_tracking', 'contests_challenges', ['contest_challenge_id'], ['id'], ondelete='CASCADE')
    op.drop_column('challenge_start_tracking', 'challenge_id')
    op.create_foreign_key('1', 'awards', 'teams', ['team_id'], ['id'])
    op.create_foreign_key('2', 'awards', 'users', ['user_id'], ['id'])
    op.add_column('award_badges', sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'award_badges', type_='foreignkey')
    op.create_foreign_key('fk_award_badges_challenge_template_id', 'award_badges', 'challenge_templates', ['challenge_template_id'], ['id'], ondelete='SET NULL')
    op.drop_column('award_badges', 'challenge_id')
    op.create_index('ix_admin_audit_logs_actor_id_ts', 'admin_audit_logs', ['actor_id', 'timestamp'], unique=False)
    op.create_index('ix_admin_audit_logs_action', 'admin_audit_logs', ['action'], unique=False)
    op.create_table('contests_challenges',
    sa.Column('id', mysql.INTEGER(display_width=11), autoincrement=True, nullable=False),
    sa.Column('contest_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=False),
    sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=False),
    sa.Column('template_version_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('value', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('state', mysql.VARCHAR(length=32), nullable=False),
    sa.Column('max_attempts', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('cooldown', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('time_limit', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('start_time', mysql.DATETIME(fsp=6), nullable=True),
    sa.Column('finish_time', mysql.DATETIME(fsp=6), nullable=True),
    sa.Column('max_deploy_count', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('next_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.ForeignKeyConstraint(['challenge_template_id'], ['challenge_templates.id'], name='fk_cc_challenge_template_id', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], name='fk_cc_contest_id', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['next_id'], ['contests_challenges.id'], name='fk_cc_next_id', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['template_version_id'], ['challenge_template_versions.id'], name='fk_cc_template_version_id', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    mysql_collate='utf8mb4_uca1400_ai_ci',
    mysql_default_charset='utf8mb4',
    mysql_engine='InnoDB'
    )
    op.create_table('challenge_templates',
    sa.Column('id', mysql.INTEGER(display_width=11), autoincrement=True, nullable=False),
    sa.Column('name', mysql.VARCHAR(length=80), nullable=True),
    sa.Column('description', mysql.TEXT(), nullable=True),
    sa.Column('category', mysql.VARCHAR(length=80), nullable=True),
    sa.Column('type', mysql.VARCHAR(length=80), nullable=True),
    sa.Column('connection_info', mysql.TEXT(), nullable=True),
    sa.Column('require_deploy', mysql.TINYINT(display_width=1), autoincrement=False, nullable=False),
    sa.Column('deploy_status', mysql.TEXT(), nullable=True),
    sa.Column('last_update', mysql.DATETIME(fsp=6), nullable=True),
    sa.Column('image_link', mysql.TEXT(), nullable=True),
    sa.Column('created_by', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('cpu_limit', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('cpu_request', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('memory_limit', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('memory_request', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('use_gvisor', mysql.TINYINT(display_width=1), autoincrement=False, nullable=True),
    sa.Column('difficulty', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('harden_container', mysql.TINYINT(display_width=1), server_default=sa.text('1'), autoincrement=False, nullable=True),
    sa.Column('shared_instant', mysql.TINYINT(display_width=1), server_default=sa.text('0'), autoincrement=False, nullable=False),
    sa.Column('connection_protocol', mysql.VARCHAR(length=10), server_default=sa.text("'http'"), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name='fk_challenge_templates_created_by', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    mysql_collate='utf8mb4_uca1400_ai_ci',
    mysql_default_charset='utf8mb4',
    mysql_engine='InnoDB'
    )
    op.create_table('challenge_template_versions',
    sa.Column('id', mysql.INTEGER(display_width=11), autoincrement=True, nullable=False),
    sa.Column('challenge_template_id', mysql.INTEGER(display_width=11), autoincrement=False, nullable=False),
    sa.Column('version_number', mysql.INTEGER(display_width=11), server_default=sa.text('1'), autoincrement=False, nullable=False),
    sa.Column('image_link', mysql.TEXT(), nullable=True),
    sa.Column('is_active', mysql.TINYINT(display_width=1), server_default=sa.text('0'), autoincrement=False, nullable=False),
    sa.Column('created_by', mysql.INTEGER(display_width=11), autoincrement=False, nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=6), nullable=False),
    sa.Column('notes', mysql.TEXT(), nullable=True),
    sa.Column('deploy_file', mysql.TEXT(), nullable=True),
    sa.Column('cpu_limit', mysql.VARCHAR(length=50), nullable=True),
    sa.Column('cpu_request', mysql.VARCHAR(length=50), nullable=True),
    sa.Column('memory_limit', mysql.VARCHAR(length=50), nullable=True),
    sa.Column('memory_request', mysql.VARCHAR(length=50), nullable=True),
    sa.Column('use_gvisor', mysql.TINYINT(display_width=1), autoincrement=False, nullable=True),
    sa.Column('harden_container', mysql.TINYINT(display_width=1), autoincrement=False, nullable=True),
    sa.ForeignKeyConstraint(['challenge_template_id'], ['challenge_templates.id'], name='fk_challenge_template_versions_template_id', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name='fk_challenge_template_versions_created_by', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    mysql_collate='utf8mb4_uca1400_ai_ci',
    mysql_default_charset='utf8mb4',
    mysql_engine='InnoDB'
    )
    op.create_index('idx_challenge_versions_challenge_id', 'challenge_template_versions', ['challenge_template_id'], unique=False)
    op.create_index('idx_challenge_versions_active', 'challenge_template_versions', ['challenge_template_id', 'is_active'], unique=False)
    op.drop_table('challenge_versions')
    op.drop_table('challenges')
    # ### end Alembic commands ###
