"""add multiple contest support
Create Date: 2026-04-23 10:00:00.000000

=== KIẾN TRÚC MỚI ===

  challenges          →  Bank / Template (teacher tạo, tái sử dụng nhiều contest)
  contests_challenges →  Instance của challenge trong từng contest

  Flags, Hints, ChallengeFiles, Tags, Topics
      vẫn FK vào challenges.id  (tài sản của bank)

  Submissions, Solves, DeployedChallenge, ChallengeStartTracking, Comments
      đổi FK từ challenges.id  →  contests_challenges.id  (runtime của contest)

=== THAY ĐỔI DATABASE ===

  Bảng MỚI:
    semester                 — kỳ học, contests.semester_name FK về đây
    contests                 — một cuộc thi
    contest_participants     — ai tham gia contest, role + score
    contests_challenges      — challenge instance trong contest

  Bảng SỬA — challenges (bank):
    XÓA: state, connection_info, next_id, max_attempts, value,
          time_limit, time_finished, start_time, require_deploy,
          deploy_status, last_update, user_id
    ĐỔI TÊN: user_id → author_id  (thực ra drop + add vì rename không safe)
    THÊM:  is_public, import_count, created_at, updated_at
           (requirements, tags, difficulty, image_link, deploy_file,
            cpu_*, memory_*, use_gvisor, harden_container,
            max_deploy_count, shared_instant, connection_protocol
            → giữ nguyên, đây là config deploy của bank)

  Bảng SỬA — contests_challenges (instance):
    THÊM tất cả cột runtime từ challenges cũ:
    state, max_attempts, value, time_limit, time_finished, start_time,
    cooldown, require_deploy, deploy_status, last_update, connection_info,
    next_id (self-ref), connection_protocol, user_id

  Bảng SỬA — submissions:
    ĐỔI: challenge_id FK challenges.id → contest_challenge_id FK contests_challenges.id
    contest_id đã có → giữ nguyên, thêm NOT NULL sau khi có data

  Bảng SỬA — solves:
    ĐỔI: challenge_id → contest_challenge_id FK contests_challenges.id
    Unique constraint: (challenge_id, user_id) → (contest_challenge_id, user_id)

  Bảng SỬA — deploy_histories:
    ĐỔI: challenge_id FK challenges.id → contest_challenge_id FK contests_challenges.id

  Bảng SỬA — challenge_start_tracking:
    ĐỔI: challenge_id FK challenges.id → contest_challenge_id FK contests_challenges.id
    contest_id đã có → giữ nguyên

  Bảng SỬA — comments:
    ĐỔI: challenge_id FK challenges.id → contest_challenge_id FK contests_challenges.id
    contest_id đã có → giữ nguyên

  Bảng SỬA — achievements, award_badges:
    ĐỔI: challenge_id FK challenges.id → contest_challenge_id FK contests_challenges.id
    contest_id đã có → giữ nguyên

  Bảng SỬA — awards, unlocks, action_logs:
    contest_id đã có → giữ nguyên, không thay đổi gì thêm
"""

from alembic import op
import sqlalchemy as sa


# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "a2211261115p"
down_revision = "e9a1c2d3f4b5"
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _has_column(bind, table: str, column: str) -> bool:
    if not _has_table(bind, table):
        return False
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _has_index(bind, table: str, index_name: str) -> bool:
    return any(
        ix["name"] == index_name
        for ix in sa.inspect(bind).get_indexes(table)
    )


def _has_fk(bind, table: str, fk_name: str) -> bool:
    return any(
        fk.get("name") == fk_name
        for fk in sa.inspect(bind).get_foreign_keys(table)
    )


def _drop_col_with_fk(bind, table: str, col: str) -> None:
    """Drop FK constraints referencing `col` then drop the column itself.
    MariaDB/MySQL requires FK constraints to be dropped before columns."""
    for fk in sa.inspect(bind).get_foreign_keys(table):
        if col in fk.get("constrained_columns", []) and fk.get("name"):
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_constraint(fk["name"], type_="foreignkey")
    op.drop_column(table, col)


# ===========================================================================
# UPGRADE
# ===========================================================================
def upgrade():
    bind = op.get_bind()

    # ===================================================================
    # PHẦN 1 — TẠO BẢNG MỚI
    # ===================================================================

    # -------------------------------------------------------------------
    # 1.1  semester
    # -------------------------------------------------------------------
    if not _has_table(bind, "semester"):
        op.create_table(
            "semester",
            sa.Column("id",            sa.Integer(),   primary_key=True, autoincrement=True),
            sa.Column("semester_name", sa.String(128), nullable=False, unique=True),
            sa.Column("start_time",    sa.DateTime(),  nullable=True),
            sa.Column("end_time",      sa.DateTime(),  nullable=True),
        )

    # -------------------------------------------------------------------
    # 1.2  contests
    # -------------------------------------------------------------------
    if not _has_table(bind, "contests"):
        op.create_table(
            "contests",
            sa.Column("id",                   sa.Integer(),   primary_key=True, autoincrement=True),
            sa.Column("name",                 sa.String(255), nullable=False),
            sa.Column("description",          sa.Text(),      nullable=True),
            sa.Column("slug",                 sa.String(100), nullable=False),
            sa.Column("owner_id",             sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="SET NULL"),                    nullable=True),
            sa.Column("semester_name",        sa.String(128),
                      sa.ForeignKey("semester.semester_name", ondelete="SET NULL"),      nullable=True),
            sa.Column("state",                sa.String(20),  nullable=False, server_default="draft"),
            sa.Column("user_mode",            sa.String(20),  nullable=False, server_default="users"),
            sa.Column("start_time",           sa.DateTime(),  nullable=True),
            sa.Column("end_time",             sa.DateTime(),  nullable=True),
            sa.Column("freeze_scoreboard_at", sa.DateTime(),  nullable=True),
            sa.Column("created_at",           sa.DateTime(),  nullable=False,
                      server_default=sa.text("NOW()")),
            sa.Column("updated_at",           sa.DateTime(),  nullable=True),
            sa.UniqueConstraint("slug", name="uq_contests_slug"),
        )
        op.create_index("ix_contests_state", "contests", ["state"])

    # -------------------------------------------------------------------
    # 1.3  contests_challenges  — TRUNG TÂM, tạo trước khi sửa FK runtime
    # -------------------------------------------------------------------
    if not _has_table(bind, "contests_challenges"):
        op.create_table(
            "contests_challenges",
            sa.Column("id",                  sa.Integer(),  primary_key=True, autoincrement=True),
            sa.Column("contest_id",          sa.Integer(),
                      sa.ForeignKey("contests.id",   ondelete="CASCADE"),  nullable=False),
            sa.Column("bank_id",             sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="SET NULL"), nullable=True),

            # --- Runtime config (kế thừa / override từ bank challenge) ---
            sa.Column("name",                sa.String(80),  nullable=True),
            sa.Column("connection_info",     sa.Text(),      nullable=True),
            sa.Column("next_id",             sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="SET NULL"), nullable=True),
            sa.Column("max_attempts",        sa.Integer(),   nullable=True, server_default=sa.text("0")),
            sa.Column("value",               sa.Integer(),   nullable=True),
            sa.Column("state",               sa.String(80),  nullable=False, server_default="visible"),
            sa.Column("time_limit",          sa.Integer(),   nullable=True),
            sa.Column("start_time",          sa.DateTime(),  nullable=True),
            sa.Column("time_finished",       sa.DateTime(),  nullable=True),
            sa.Column("cooldown",            sa.Integer(),   nullable=True, server_default=sa.text("0")),
            sa.Column("require_deploy",      sa.Boolean(),   nullable=False, server_default=sa.text("0")),
            sa.Column("deploy_status",       sa.Text(),      nullable=True,  server_default="CREATED"),
            sa.Column("last_update",         sa.DateTime(),  nullable=True),
            sa.Column("max_deploy_count",    sa.Integer(),   nullable=True, server_default=sa.text("0")),
            sa.Column("connection_protocol", sa.String(10),  nullable=True, server_default="http"),
            sa.Column("user_id",             sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index("ix_cc_contest_id", "contests_challenges", ["contest_id"])
        op.create_index("ix_cc_bank_id",    "contests_challenges", ["bank_id"])

    # -------------------------------------------------------------------
    # 1.4  contest_participants
    # -------------------------------------------------------------------
    if not _has_table(bind, "contest_participants"):
        op.create_table(
            "contest_participants",
            sa.Column("id",            sa.Integer(),  primary_key=True, autoincrement=True),
            sa.Column("contest_id",    sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id",       sa.Integer(),
                      sa.ForeignKey("users.id",    ondelete="CASCADE"), nullable=False),
            sa.Column("team_id",       sa.Integer(),
                      sa.ForeignKey("teams.id",    ondelete="SET NULL"), nullable=True),
            sa.Column("role",          sa.String(20),  nullable=False, server_default="contestant"),
            sa.Column("score",         sa.Integer(),   nullable=False, server_default=sa.text("0")),
            sa.Column("joined_at",     sa.DateTime(),  nullable=False,
                      server_default=sa.text("NOW()")),
            sa.Column("last_solve_at", sa.DateTime(),  nullable=True),
            sa.UniqueConstraint("contest_id", "user_id",
                                name="uq_contest_participants_contest_user"),
        )

    # ===================================================================
    # PHẦN 2 — SỬA BẢNG challenges (bank)
    # XÓA các cột runtime đã chuyển sang contests_challenges
    # ===================================================================

    # Các cột runtime cần XÓA khỏi challenges (giờ thuộc contests_challenges)
    runtime_cols_to_drop = [
        "state",          # visible/hidden — per-contest
        "connection_info",# URL per-contest
        "next_id",        # chuỗi challenge per-contest
        "max_attempts",   # per-contest
        "value",          # điểm per-contest
        "time_limit",     # giới hạn thời gian per-contest
        "time_finished",  # per-contest
        "start_time",     # per-contest
        "require_deploy", # per-contest
        "deploy_status",  # per-contest
        "last_update",    # per-contest
    ]
    for col in runtime_cols_to_drop:
        if _has_column(bind, "challenges", col):
            _drop_col_with_fk(bind, "challenges", col)

    # user_id → đổi tên thành author_id
    # SQLAlchemy không có rename_column portable → drop + add
    if _has_column(bind, "challenges", "user_id") and \
       not _has_column(bind, "challenges", "author_id"):
        op.add_column("challenges",
            sa.Column("author_id", sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        # Copy data
        op.execute("UPDATE challenges SET author_id = user_id")
        _drop_col_with_fk(bind, "challenges", "user_id")
    elif not _has_column(bind, "challenges", "author_id"):
        op.add_column("challenges",
            sa.Column("author_id", sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))

    # Thêm cột bank metadata mới
    bank_new_cols = {
        "is_public":    sa.Column("is_public",    sa.Boolean(),  nullable=False,
                                  server_default=sa.text("0")),
        "import_count": sa.Column("import_count", sa.Integer(),  nullable=False,
                                  server_default=sa.text("0")),
        "created_at":   sa.Column("created_at",   sa.DateTime(), nullable=True),
        "updated_at":   sa.Column("updated_at",   sa.DateTime(), nullable=True),
    }
    for col_name, col_def in bank_new_cols.items():
        if not _has_column(bind, "challenges", col_name):
            op.add_column("challenges", col_def)

    # ===================================================================
    # PHẦN 3 — ĐỔI FK: challenges.id → contests_challenges.id
    # Các bảng runtime phải trỏ vào instance, không phải bank template
    # ===================================================================

    # -------------------------------------------------------------------
    # 3.1  submissions
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    # -------------------------------------------------------------------
    if _has_column(bind, "submissions", "challenge_id") and \
       not _has_column(bind, "submissions", "contest_challenge_id"):

        op.add_column("submissions",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))  # nullable=True trước, set data sau
        # Copy giá trị cũ (tạm thời — sẽ cần data migration riêng)
        # Ở đây set NULL vì không thể tự động map challenge_id → contest_challenge_id
        op.create_index("ix_submissions_cc_id", "submissions", ["contest_challenge_id"])
        _drop_col_with_fk(bind, "submissions", "challenge_id")

    # -------------------------------------------------------------------
    # 3.2  solves
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    #   Unique constraint cũng phải cập nhật
    # -------------------------------------------------------------------
    if _has_column(bind, "solves", "challenge_id") and \
       not _has_column(bind, "solves", "contest_challenge_id"):

        # Bước 1: Drop FK constraints trỏ vào challenge_id TRƯỚC (MariaDB yêu cầu trước khi drop index)
        for fk in sa.inspect(bind).get_foreign_keys("solves"):
            if "challenge_id" in fk.get("constrained_columns", []) and fk.get("name"):
                with op.batch_alter_table("solves") as batch_op:
                    batch_op.drop_constraint(fk["name"], type_="foreignkey")

        # Bước 2: Drop unique constraints có chứa challenge_id (sau khi FK đã drop)
        existing_uqs = [
            uc["name"]
            for uc in sa.inspect(bind).get_unique_constraints("solves")
            if "challenge_id" in uc.get("column_names", []) and uc.get("name")
        ]
        if existing_uqs:
            with op.batch_alter_table("solves") as batch_op:
                for uq_name in existing_uqs:
                    batch_op.drop_constraint(uq_name, type_="unique")

        op.add_column("solves",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        # FK đã drop ở bước 1, chỉ cần drop column
        op.drop_column("solves", "challenge_id")

        # Tạo unique constraint mới
        op.create_unique_constraint(
            "uq_solves_cc_user",
            "solves", ["contest_challenge_id", "user_id"]
        )
        op.create_unique_constraint(
            "uq_solves_cc_team",
            "solves", ["contest_challenge_id", "team_id"]
        )

    # -------------------------------------------------------------------
    # 3.3  deploy_histories
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    # -------------------------------------------------------------------
    if _has_column(bind, "deploy_histories", "challenge_id") and \
       not _has_column(bind, "deploy_histories", "contest_challenge_id"):

        op.add_column("deploy_histories",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        _drop_col_with_fk(bind, "deploy_histories", "challenge_id")

    # -------------------------------------------------------------------
    # 3.4  challenge_start_tracking
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    #   contest_id đã có → giữ nguyên
    # -------------------------------------------------------------------
    if _has_column(bind, "challenge_start_tracking", "challenge_id") and \
       not _has_column(bind, "challenge_start_tracking", "contest_challenge_id"):

        op.add_column("challenge_start_tracking",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        op.create_index(
            "ix_cst_cc_id", "challenge_start_tracking", ["contest_challenge_id"]
        )
        _drop_col_with_fk(bind, "challenge_start_tracking", "challenge_id")

    # -------------------------------------------------------------------
    # 3.5  comments
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    #   contest_id đã có → giữ nguyên
    # -------------------------------------------------------------------
    if _has_column(bind, "comments", "challenge_id") and \
       not _has_column(bind, "comments", "contest_challenge_id"):

        op.add_column("comments",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        _drop_col_with_fk(bind, "comments", "challenge_id")

    # -------------------------------------------------------------------
    # 3.6  achievements
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    #   contest_id đã có → giữ nguyên
    # -------------------------------------------------------------------
    if _has_column(bind, "achievements", "challenge_id") and \
       not _has_column(bind, "achievements", "contest_challenge_id"):

        op.add_column("achievements",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        _drop_col_with_fk(bind, "achievements", "challenge_id")

    # -------------------------------------------------------------------
    # 3.7  award_badges
    #   CŨ: challenge_id FK challenges.id
    #   MỚI: contest_challenge_id FK contests_challenges.id
    #   contest_id đã có → giữ nguyên
    # -------------------------------------------------------------------
    if _has_column(bind, "award_badges", "challenge_id") and \
       not _has_column(bind, "award_badges", "contest_challenge_id"):

        op.add_column("award_badges",
            sa.Column("contest_challenge_id", sa.Integer(),
                      sa.ForeignKey("contests_challenges.id", ondelete="CASCADE"),
                      nullable=True))
        _drop_col_with_fk(bind, "award_badges", "challenge_id")

    # ===================================================================
    # PHẦN 4 — ĐỔI FK: tags và challenge_topics → contests_challenges.id
    # Trước: challenge_id FK challenges.id
    # Sau:   challenge_id FK contests_challenges.id
    # ===================================================================

    for tbl in ("tags", "challenge_topics"):
        if not _has_table(bind, tbl):
            continue
        fks = sa.inspect(bind).get_foreign_keys(tbl)
        # Tìm FK trỏ vào challenges.id và drop nó
        for fk in fks:
            if fk.get("referred_table") == "challenges" and "challenge_id" in fk.get("constrained_columns", []):
                with op.batch_alter_table(tbl) as batch_op:
                    if fk.get("name"):
                        batch_op.drop_constraint(fk["name"], type_="foreignkey")
                # Nullify data cũ (challenge_id cũ trỏ vào challenges, không match contests_challenges)
                op.execute(f"UPDATE `{tbl}` SET challenge_id = NULL")
                # Tạo FK mới trỏ vào contests_challenges
                with op.batch_alter_table(tbl) as batch_op:
                    batch_op.create_foreign_key(
                        f"{tbl}_cc_fk",
                        "contests_challenges",
                        ["challenge_id"],
                        ["id"],
                        ondelete="CASCADE",
                    )
                break

    # ===================================================================
    # PHẦN 5 — THÊM contest_id vào các bảng chưa có
    # (awards, unlocks, action_logs đã có từ SQL file → kiểm tra lại)
    # ===================================================================
    need_contest_id = ["awards", "unlocks", "action_logs"]
    for tbl in need_contest_id:
        if _has_table(bind, tbl) and not _has_column(bind, tbl, "contest_id"):
            op.add_column(tbl,
                sa.Column("contest_id", sa.Integer(),
                          sa.ForeignKey("contests.id", ondelete="SET NULL"),
                          nullable=True))
            op.create_index(f"ix_{tbl}_contest_id", tbl, ["contest_id"])

    # ===================================================================
    # PHẦN 6 — notifications (tạo lại nếu đã bị drop, hoặc thêm contest_id)
    # ===================================================================
    if not _has_table(bind, "notifications"):
        op.create_table(
            "notifications",
            sa.Column("id",         sa.Integer(),   primary_key=True, autoincrement=True),
            sa.Column("contest_id", sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="CASCADE"), nullable=True),
            sa.Column("title",      sa.String(256), nullable=True),
            sa.Column("content",    sa.Text(),      nullable=True),
            sa.Column("date",       sa.DateTime(),  nullable=True,
                      server_default=sa.text("NOW()")),
            sa.Column("user_id",    sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("team_id",    sa.Integer(),
                      sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True),
        )
    elif not _has_column(bind, "notifications", "contest_id"):
        op.add_column("notifications",
            sa.Column("contest_id", sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="SET NULL"), nullable=True))

    # ===================================================================
    # PHẦN 7 — THÊM contest_id vào teams
    # ===================================================================
    if _has_table(bind, "teams") and not _has_column(bind, "teams", "contest_id"):
        op.add_column("teams",
            sa.Column("contest_id", sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="SET NULL"),
                      nullable=True))
        op.create_index("ix_teams_contest_id", "teams", ["contest_id"])

    # ===================================================================
    # PHẦN 8 — THÊM contest_id vào tickets
    # ===================================================================
    if _has_table(bind, "tickets") and not _has_column(bind, "tickets", "contest_id"):
        op.add_column("tickets",
            sa.Column("contest_id", sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="SET NULL"),
                      nullable=True))
        op.create_index("ix_tickets_contest_id", "tickets", ["contest_id"])

    # ===================================================================
    # PHẦN 9 — XÓA team_id khỏi users
    # Membership của user trong team được quản lý qua contest_participants.team_id
    # ===================================================================
    if _has_table(bind, "users") and _has_column(bind, "users", "team_id"):
        _drop_col_with_fk(bind, "users", "team_id")

    # ===================================================================
    # PHẦN 10 — ĐẢM BẢO challenge_start_tracking có contest_id
    # Phòng trường hợp bảng tạo từ schema cũ thiếu cột này
    # ===================================================================
    if _has_table(bind, "challenge_start_tracking") and \
       not _has_column(bind, "challenge_start_tracking", "contest_id"):
        op.add_column("challenge_start_tracking",
            sa.Column("contest_id", sa.Integer(),
                      sa.ForeignKey("contests.id", ondelete="CASCADE"),
                      nullable=True))
        op.create_index("ix_cst_contest_id", "challenge_start_tracking", ["contest_id"])


# ===========================================================================
# DOWNGRADE — hoàn tác theo thứ tự ngược
# ===========================================================================
def downgrade():
    bind = op.get_bind()

    # -------------------------------------------------------------------
    # 10. challenge_start_tracking.contest_id
    # -------------------------------------------------------------------
    if _has_table(bind, "challenge_start_tracking") and \
       _has_column(bind, "challenge_start_tracking", "contest_id"):
        try:
            op.drop_index("ix_cst_contest_id", table_name="challenge_start_tracking")
        except Exception:
            pass
        _drop_col_with_fk(bind, "challenge_start_tracking", "contest_id")

    # -------------------------------------------------------------------
    # 9. Khôi phục team_id vào users
    # -------------------------------------------------------------------
    if _has_table(bind, "users") and not _has_column(bind, "users", "team_id"):
        op.add_column("users",
            sa.Column("team_id", sa.Integer(),
                      sa.ForeignKey("teams.id", ondelete="SET NULL",
                                    use_alter=True, name="fk_users_team_id"),
                      nullable=True))

    # -------------------------------------------------------------------
    # 8. Drop contest_id khỏi tickets
    # -------------------------------------------------------------------
    if _has_table(bind, "tickets") and _has_column(bind, "tickets", "contest_id"):
        try:
            op.drop_index("ix_tickets_contest_id", table_name="tickets")
        except Exception:
            pass
        _drop_col_with_fk(bind, "tickets", "contest_id")

    # -------------------------------------------------------------------
    # 7. Drop contest_id khỏi teams
    # -------------------------------------------------------------------
    if _has_table(bind, "teams") and _has_column(bind, "teams", "contest_id"):
        try:
            op.drop_index("ix_teams_contest_id", table_name="teams")
        except Exception:
            pass
        _drop_col_with_fk(bind, "teams", "contest_id")

    # -------------------------------------------------------------------
    # 6. notifications
    # -------------------------------------------------------------------
    if _has_table(bind, "notifications") and _has_column(bind, "notifications", "contest_id"):
        op.drop_column("notifications", "contest_id")

    # -------------------------------------------------------------------
    # 5. contest_id trong awards, unlocks, action_logs
    # -------------------------------------------------------------------
    for tbl in ["action_logs", "unlocks", "awards"]:
        if _has_table(bind, tbl) and _has_column(bind, tbl, "contest_id"):
            try:
                op.drop_index(f"ix_{tbl}_contest_id", table_name=tbl)
            except Exception:
                pass
            op.drop_column(tbl, "contest_id")

    # -------------------------------------------------------------------
    # 4. Hoàn tác FK tags và challenge_topics: contests_challenges → challenges
    # -------------------------------------------------------------------
    for tbl in ("challenge_topics", "tags"):
        if not _has_table(bind, tbl):
            continue
        fks = sa.inspect(bind).get_foreign_keys(tbl)
        for fk in fks:
            if fk.get("referred_table") == "contests_challenges" and "challenge_id" in fk.get("constrained_columns", []):
                with op.batch_alter_table(tbl) as batch_op:
                    if fk.get("name"):
                        batch_op.drop_constraint(fk["name"], type_="foreignkey")
                op.execute(f"UPDATE `{tbl}` SET challenge_id = NULL")
                with op.batch_alter_table(tbl) as batch_op:
                    batch_op.create_foreign_key(
                        None,
                        "challenges",
                        ["challenge_id"],
                        ["id"],
                        ondelete="CASCADE",
                    )
                break

    # -------------------------------------------------------------------
    # 3. Đổi FK ngược: contest_challenge_id → challenge_id
    # -------------------------------------------------------------------

    # award_badges
    if _has_column(bind, "award_badges", "contest_challenge_id") and \
       not _has_column(bind, "award_badges", "challenge_id"):
        op.add_column("award_badges",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("award_badges", "contest_challenge_id")

    # achievements
    if _has_column(bind, "achievements", "contest_challenge_id") and \
       not _has_column(bind, "achievements", "challenge_id"):
        op.add_column("achievements",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("achievements", "contest_challenge_id")

    # comments
    if _has_column(bind, "comments", "contest_challenge_id") and \
       not _has_column(bind, "comments", "challenge_id"):
        op.add_column("comments",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("comments", "contest_challenge_id")

    # challenge_start_tracking
    if _has_column(bind, "challenge_start_tracking", "contest_challenge_id") and \
       not _has_column(bind, "challenge_start_tracking", "challenge_id"):
        try:
            op.drop_index("ix_cst_cc_id", table_name="challenge_start_tracking")
        except Exception:
            pass
        op.add_column("challenge_start_tracking",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("challenge_start_tracking", "contest_challenge_id")

    # deploy_histories
    if _has_column(bind, "deploy_histories", "contest_challenge_id") and \
       not _has_column(bind, "deploy_histories", "challenge_id"):
        op.add_column("deploy_histories",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("deploy_histories", "contest_challenge_id")

    # solves
    if _has_column(bind, "solves", "contest_challenge_id") and \
       not _has_column(bind, "solves", "challenge_id"):
        try:
            op.drop_constraint("uq_solves_cc_user", "solves", type_="unique")
            op.drop_constraint("uq_solves_cc_team", "solves", type_="unique")
        except Exception:
            pass
        op.add_column("solves",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("solves", "contest_challenge_id")
        op.create_unique_constraint("solves_challenge_user",  "solves", ["challenge_id", "user_id"])
        op.create_unique_constraint("solves_challenge_team",  "solves", ["challenge_id", "team_id"])

    # submissions
    if _has_column(bind, "submissions", "contest_challenge_id") and \
       not _has_column(bind, "submissions", "challenge_id"):
        try:
            op.drop_index("ix_submissions_cc_id", table_name="submissions")
        except Exception:
            pass
        op.add_column("submissions",
            sa.Column("challenge_id", sa.Integer(),
                      sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=True))
        op.drop_column("submissions", "contest_challenge_id")

    # -------------------------------------------------------------------
    # 2. challenges — khôi phục cột runtime, đổi author_id → user_id
    # -------------------------------------------------------------------
    if _has_column(bind, "challenges", "author_id") and \
       not _has_column(bind, "challenges", "user_id"):
        op.add_column("challenges",
            sa.Column("user_id", sa.Integer(),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        op.execute("UPDATE challenges SET user_id = author_id")
        op.drop_column("challenges", "author_id")

    for col in ["updated_at", "created_at", "import_count", "is_public"]:
        if _has_column(bind, "challenges", col):
            op.drop_column("challenges", col)

    runtime_cols_to_restore = {
        "state":          sa.Column("state",          sa.String(80),  nullable=False, server_default="visible"),
        "connection_info": sa.Column("connection_info", sa.Text(),     nullable=True),
        "next_id":        sa.Column("next_id",        sa.Integer(),   nullable=True),
        "max_attempts":   sa.Column("max_attempts",   sa.Integer(),   server_default=sa.text("0")),
        "value":          sa.Column("value",          sa.Integer(),   nullable=True),
        "time_limit":     sa.Column("time_limit",     sa.Integer(),   nullable=True),
        "time_finished":  sa.Column("time_finished",  sa.DateTime(),  nullable=True),
        "start_time":     sa.Column("start_time",     sa.DateTime(),  nullable=True),
        "require_deploy": sa.Column("require_deploy", sa.Boolean(),   nullable=False, server_default=sa.text("0")),
        "deploy_status":  sa.Column("deploy_status",  sa.Text(),      nullable=True),
        "last_update":    sa.Column("last_update",    sa.DateTime(),  nullable=True),
    }
    for col_name, col_def in runtime_cols_to_restore.items():
        if not _has_column(bind, "challenges", col_name):
            op.add_column("challenges", col_def)

    # -------------------------------------------------------------------
    # 1. Xóa bảng mới theo thứ tự ngược dependency
    # -------------------------------------------------------------------
    for tbl in [
        "contest_participants",
        "contests_challenges",
        "contests",
        "semester",
    ]:
        if _has_table(bind, tbl):
            op.drop_table(tbl)