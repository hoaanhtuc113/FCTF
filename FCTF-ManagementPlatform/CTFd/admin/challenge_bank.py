from flask import render_template, request, url_for

from CTFd.admin import admin
from CTFd.models import ChallengeBank, Users, db
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

    for bank in items.items:
        user = Users.query.filter_by(id=bank.created_by).first() if bank.created_by else None
        bank.creator = user.name if user else "Unknown"

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
    return render_template("admin/challenge_bank/detail.html", bank=bank, versions=versions)
