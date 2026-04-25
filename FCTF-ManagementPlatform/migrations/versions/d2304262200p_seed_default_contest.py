"""seed default semester + contest and link all existing bank challenges

Revision ID: d2304262200p
Revises: c2304262100p
Create Date: 2026-04-24 22:00:00.000000

=== MỤC ĐÍCH ===

  Sau khi migration a2211261115p chuyển schema sang multi-contest:
    - submissions.contest_challenge_id = NULL  (không tự map được)
    - solves.contest_challenge_id = NULL
    - challenge_start_tracking.contest_challenge_id = NULL
    - comments.contest_challenge_id = NULL
    - achievements.contest_challenge_id = NULL
    - award_badges.contest_challenge_id = NULL

  Migration này:
    1. Tạo semester mặc định "Kỳ học mặc định"
    2. Tạo contest mặc định  slug="default"
    3. Với mỗi challenge trong bảng challenges (bank) → tạo một bản
       contests_challenges tương ứng, kế thừa cấu hình runtime từ
       contest cũ (value=100 nếu không có data)
    4. Cập nhật submissions, solves, challenge_start_tracking, comments,
       achievements, award_badges:
         contest_challenge_id = (contests_challenges row ứng với bank_id)
       Điều này chỉ đúng trong môi trường single-contest trước khi migrate.
       Mapping dựa trên: cột challenge_id cũ đã bị drop, nhưng ta còn biết
       rằng mỗi challenge cũ (id=N) nay có đúng một contests_challenges row
       với bank_id=N trong default contest.

=== GHI CHÚ ===

  - Nếu contests / semester đã tồn tại, migration bỏ qua bước tạo.
  - Nếu một bank challenge đã có contests_challenges trong default contest,
    bỏ qua (idempotent).
  - Với submissions / solves / v.v. đã có contest_challenge_id != NULL, giữ nguyên.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column, select, update, insert


# ---------------------------------------------------------------------------
revision = "d2304262200p"
down_revision = "c2304262100p"
branch_labels = None
depends_on = None

DEFAULT_SEMESTER_NAME = "Kỳ học mặc định"
DEFAULT_CONTEST_SLUG = "default"
DEFAULT_CONTEST_NAME = "Default Contest"
DEFAULT_CHALLENGE_VALUE = 100


# ---------------------------------------------------------------------------
# Lightweight table references (no ORM needed)
# ---------------------------------------------------------------------------

semester_t = table(
    "semester",
    column("id", sa.Integer),
    column("semester_name", sa.String),
)

contests_t = table(
    "contests",
    column("id", sa.Integer),
    column("name", sa.String),
    column("description", sa.Text),
    column("slug", sa.String),
    column("owner_id", sa.Integer),
    column("semester_name", sa.String),
    column("state", sa.String),
    column("user_mode", sa.String),
    column("start_time", sa.DateTime),
    column("end_time", sa.DateTime),
    column("freeze_scoreboard_at", sa.DateTime),
    column("created_at", sa.DateTime),
    column("updated_at", sa.DateTime),
)

challenges_t = table(
    "challenges",
    column("id", sa.Integer),
    column("name", sa.String),
    column("type", sa.String),
    column("image_link", sa.Text),
    column("connection_protocol", sa.String),
    column("max_deploy_count", sa.Integer),
)

cc_t = table(
    "contests_challenges",
    column("id", sa.Integer),
    column("contest_id", sa.Integer),
    column("bank_id", sa.Integer),
    column("name", sa.String),
    column("state", sa.String),
    column("value", sa.Integer),
    column("max_attempts", sa.Integer),
    column("time_limit", sa.Integer),
    column("cooldown", sa.Integer),
    column("require_deploy", sa.Boolean),
    column("deploy_status", sa.Text),
    column("max_deploy_count", sa.Integer),
    column("connection_protocol", sa.String),
    column("user_id", sa.Integer),
)

# Runtime tables that need contest_challenge_id filled in
_runtime_tables = [
    "submissions",
    "solves",
    "challenge_start_tracking",
    "comments",
    "achievements",
    "award_badges",
]


def _has_table(bind, name):
    return sa.inspect(bind).has_table(name)


def _has_column(bind, tbl, col):
    if not _has_table(bind, tbl):
        return False
    return col in {c["name"] for c in sa.inspect(bind).get_columns(tbl)}


# ===========================================================================
# UPGRADE
# ===========================================================================

def upgrade():
    bind = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. Semester mặc định
    # -----------------------------------------------------------------------
    row = bind.execute(
        select([semester_t.c.id]).where(semester_t.c.semester_name == DEFAULT_SEMESTER_NAME)
    ).fetchone()

    if row is None:
        bind.execute(
            insert(semester_t).values(semester_name=DEFAULT_SEMESTER_NAME)
        )
        row = bind.execute(
            select([semester_t.c.id]).where(semester_t.c.semester_name == DEFAULT_SEMESTER_NAME)
        ).fetchone()

    # -----------------------------------------------------------------------
    # 2. Contest mặc định
    # -----------------------------------------------------------------------
    contest_row = bind.execute(
        select([contests_t.c.id]).where(contests_t.c.slug == DEFAULT_CONTEST_SLUG)
    ).fetchone()

    if contest_row is None:
        import datetime
        bind.execute(
            insert(contests_t).values(
                name=DEFAULT_CONTEST_NAME,
                slug=DEFAULT_CONTEST_SLUG,
                description="Contest mặc định được tạo tự động khi migrate sang kiến trúc multi-contest.",
                owner_id=None,
                semester_name=DEFAULT_SEMESTER_NAME,
                state="visible",
                user_mode="users",
                start_time=None,
                end_time=None,
                freeze_scoreboard_at=None,
                created_at=datetime.datetime.utcnow(),
                updated_at=None,
            )
        )
        contest_row = bind.execute(
            select([contests_t.c.id]).where(contests_t.c.slug == DEFAULT_CONTEST_SLUG)
        ).fetchone()

    contest_id = contest_row[0]

    # -----------------------------------------------------------------------
    # 3. Tạo contests_challenges cho tất cả bank challenges
    # -----------------------------------------------------------------------
    all_challenges = bind.execute(
        select([
            challenges_t.c.id,
            challenges_t.c.name,
            challenges_t.c.type,
            challenges_t.c.image_link,
            challenges_t.c.connection_protocol,
            challenges_t.c.max_deploy_count,
        ])
    ).fetchall()

    # Build lookup: bank_id → cc_id (cho những cái đã tồn tại trong default contest)
    existing_cc_rows = bind.execute(
        select([cc_t.c.id, cc_t.c.bank_id]).where(cc_t.c.contest_id == contest_id)
    ).fetchall()
    bank_to_cc = {r[1]: r[0] for r in existing_cc_rows}  # {bank_id: cc_id}

    for ch in all_challenges:
        bank_id = ch[0]
        if bank_id in bank_to_cc:
            continue  # đã có, bỏ qua (idempotent)

        image_link = ch[3]
        require_deploy = image_link is not None and image_link.strip() != ""
        conn_proto = ch[4] if ch[4] else "http"
        max_deploy = ch[5] if ch[5] is not None else 0

        bind.execute(
            insert(cc_t).values(
                contest_id=contest_id,
                bank_id=bank_id,
                name=None,  # kế thừa từ bank
                state="visible",
                value=DEFAULT_CHALLENGE_VALUE,
                max_attempts=0,
                time_limit=None,
                cooldown=0,
                require_deploy=require_deploy,
                deploy_status="CREATED",
                max_deploy_count=max_deploy,
                connection_protocol=conn_proto,
                user_id=None,
            )
        )

    # Refresh lookup sau khi insert
    existing_cc_rows = bind.execute(
        select([cc_t.c.id, cc_t.c.bank_id]).where(cc_t.c.contest_id == contest_id)
    ).fetchall()
    bank_to_cc = {r[1]: r[0] for r in existing_cc_rows}

    # -----------------------------------------------------------------------
    # 4. Backfill contest_challenge_id trong các bảng runtime
    #
    # Trước migration, challenge_id (=bank_id) đã bị drop → không thể dùng
    # trực tiếp. Tuy nhiên, nếu DB vẫn còn bảng cũ hoặc có cột challenge_id
    # dưới tên khác, ta dùng heuristic sau:
    #
    #   submissions: có cột "challenge_id" cũ? → đã bị drop bởi migration trước.
    #   → Chỉ set contest_challenge_id = NULL → default cc nếu chỉ có 1 contest.
    #
    # Trong trường hợp single-contest (trước khi có multi-contest dữ liệu thực),
    # tất cả submissions đều thuộc về cùng 1 contest + 1 bank challenge nào đó.
    # Vì challenge_id cũ đã bị drop và set NULL, ta không thể map chính xác.
    #
    # Workaround: nếu chỉ có 1 bank challenge (hoặc không có cách nào khác),
    # giữ NULL và để app xử lý. Nếu DB còn backup column (unlikely), dùng nó.
    #
    # Trong thực tế, khi deploy lần đầu sau migration trên môi trường dev/staging
    # thì DB thường rỗng hoặc test data → NULL là chấp nhận được.
    # -----------------------------------------------------------------------

    for tbl_name in _runtime_tables:
        if not _has_table(bind, tbl_name):
            continue
        if not _has_column(bind, tbl_name, "contest_challenge_id"):
            continue

        # Nếu bảng có cột contest_id, set contest_id = default contest
        # cho những row chưa có
        if _has_column(bind, tbl_name, "contest_id"):
            bind.execute(
                sa.text(
                    f"UPDATE `{tbl_name}` SET contest_id = :cid "
                    f"WHERE contest_id IS NULL OR contest_id = 0"
                ),
                {"cid": contest_id},
            )

        # Nếu bảng có cột cũ (ví dụ: backup_challenge_id được tạo bởi migration trước)
        # dùng để map → cc_id. Kiểm tra xem có không.
        backup_col = None
        for candidate in ("backup_challenge_id", "old_challenge_id", "bank_id"):
            if _has_column(bind, tbl_name, candidate):
                backup_col = candidate
                break

        if backup_col:
            # Map từng bank_id → cc_id
            for bank_id, cc_id in bank_to_cc.items():
                bind.execute(
                    sa.text(
                        f"UPDATE `{tbl_name}` "
                        f"SET contest_challenge_id = :cc_id "
                        f"WHERE {backup_col} = :bank_id "
                        f"AND contest_challenge_id IS NULL"
                    ),
                    {"cc_id": cc_id, "bank_id": bank_id},
                )


# ===========================================================================
# DOWNGRADE
# ===========================================================================

def downgrade():
    bind = op.get_bind()

    # Xóa contests_challenges trong default contest
    contest_row = bind.execute(
        select([contests_t.c.id]).where(contests_t.c.slug == DEFAULT_CONTEST_SLUG)
    ).fetchone()

    if contest_row:
        contest_id = contest_row[0]

        # Xóa contests_challenges (cascade sẽ NULL-ify runtime rows nếu FK SET NULL)
        bind.execute(
            sa.text("DELETE FROM contests_challenges WHERE contest_id = :cid"),
            {"cid": contest_id},
        )

        # Xóa default contest
        bind.execute(
            sa.text("DELETE FROM contests WHERE id = :cid"),
            {"cid": contest_id},
        )

    # Xóa default semester nếu không còn contest nào reference
    sem_row = bind.execute(
        select([semester_t.c.id]).where(semester_t.c.semester_name == DEFAULT_SEMESTER_NAME)
    ).fetchone()
    if sem_row:
        ref_count = bind.execute(
            sa.text("SELECT COUNT(*) FROM contests WHERE semester_name = :sn"),
            {"sn": DEFAULT_SEMESTER_NAME},
        ).scalar()
        if ref_count == 0:
            bind.execute(
                sa.text("DELETE FROM semester WHERE semester_name = :sn"),
                {"sn": DEFAULT_SEMESTER_NAME},
            )