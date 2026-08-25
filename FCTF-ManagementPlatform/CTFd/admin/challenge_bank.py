import json

from flask import render_template, request, url_for

from CTFd.admin import admin
from CTFd.models import ChallengeBank, Challenges, Users, db
from CTFd.utils.decorators import admins_only


@admin.route("/admin/challenge_bank")
@admins_only
def challenge_bank_listing():
    q = request.args.get("q", "").strip()
    field = request.args.get("field", "name")
    category = request.args.get("category", "")
    type_ = request.args.get("type", "")
    difficulty = request.args.get("difficulty", "")
    page = abs(request.args.get("page", 1, type=int))

    query = ChallengeBank.query

    if q:
        if field == "id":
            try:
                query = query.filter(ChallengeBank.id == int(q))
            except ValueError:
                pass
        elif field in {"name", "category"} and hasattr(ChallengeBank, field):
            query = query.filter(getattr(ChallengeBank, field).ilike(f"%{q}%"))

    if category:
        query = query.filter(ChallengeBank.category == category)
    if type_:
        query = query.filter(ChallengeBank.type == type_)
    if difficulty:
        try:
            query = query.filter(ChallengeBank.difficulty == int(difficulty))
        except ValueError:
            pass

    items = query.order_by(ChallengeBank.id.desc()).paginate(
        page=page, per_page=50, error_out=False
    )

    # How many contest challenges were cloned from each item on this page.
    # Grouped in one query rather than a count per row, so a full page costs
    # the same as a single item.
    page_ids = [b.id for b in items.items]
    clone_counts = {}
    if page_ids:
        rows = (
            db.session.query(Challenges.source_bank_id, db.func.count(Challenges.id))
            .filter(Challenges.source_bank_id.in_(page_ids))
            .group_by(Challenges.source_bank_id)
            .all()
        )
        clone_counts = {bank_id: count for bank_id, count in rows}

    for bank in items.items:
        # ChallengeBank already has a `creator` relationship (the Users row
        # itself) — a display attribute needs a different name or this
        # assignment trips SQLAlchemy trying to treat a plain string as a
        # mapped Users instance.
        user = Users.query.filter_by(id=bank.created_by).first() if bank.created_by else None
        bank.creator_name = user.name if user else "Unknown"
        bank.clone_count = clone_counts.get(bank.id, 0)

    raw_categories = (
        ChallengeBank.query.with_entities(ChallengeBank.category)
        .filter(ChallengeBank.category.isnot(None))
        .distinct().all()
    )
    raw_types = (
        ChallengeBank.query.with_entities(ChallengeBank.type)
        .filter(ChallengeBank.type.isnot(None))
        .distinct().all()
    )
    categories = sorted({c[0] for c in raw_categories if c and c[0]})
    types = sorted({t[0] for t in raw_types if t and t[0]})

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/challenge_bank/list.html",
        items=items,
        prev_page=url_for(request.endpoint, page=items.prev_num, **args),
        next_page=url_for(request.endpoint, page=items.next_num, **args),
        q=q,
        field=field,
        category=category,
        type=type_,
        difficulty=difficulty,
        categories=categories,
        types=types,
    )


@admin.route("/admin/challenge_bank/new")
@admins_only
def challenge_bank_new():
    return render_template("admin/challenge_bank/new.html")


@admin.route("/admin/challenge_bank/<int:bank_id>")
@admins_only
def challenge_bank_detail(bank_id):
    bank = ChallengeBank.query.filter_by(id=bank_id).first_or_404()
    versions = bank.versions.all()

    # image_link is stored as the JSON blob the deploy pipeline writes
    # ({"imageLink": ..., "exposedPort": ...}); split it the same way the
    # contest challenge detail route does so the page can show the image
    # name on its own rather than the raw JSON.
    expose_port = ""
    image_link_display = ""
    if bank.image_link:
        try:
            obj = json.loads(bank.image_link)
            expose_port = obj.get("exposedPort", "")
            image_link_display = obj.get("imageLink", "")
        except (ValueError, AttributeError):
            image_link_display = bank.image_link

    return render_template(
        "admin/challenge_bank/detail.html",
        bank=bank,
        versions=versions,
        expose_port=expose_port,
        image_link_display=image_link_display,
    )
