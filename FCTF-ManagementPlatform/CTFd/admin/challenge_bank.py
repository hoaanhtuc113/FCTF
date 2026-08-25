from flask import render_template, request

from CTFd.admin import admin
from CTFd.models import ChallengeBank, db
from CTFd.utils.decorators import admins_only


@admin.route("/admin/challenge_bank")
@admins_only
def challenge_bank_listing():
    q = request.args.get("q", "")
    category = request.args.get("category", "")
    type_ = request.args.get("type", "")
    page = abs(request.args.get("page", 1, type=int))

    query = ChallengeBank.query
    if q:
        query = query.filter(
            db.or_(
                ChallengeBank.name.ilike(f"%{q}%"),
                ChallengeBank.category.ilike(f"%{q}%"),
            )
        )
    if category:
        query = query.filter(ChallengeBank.category == category)
    if type_:
        query = query.filter(ChallengeBank.type == type_)

    items = query.order_by(ChallengeBank.id.desc()).paginate(
        page=page, per_page=50, error_out=False
    )

    categories = sorted(
        {c[0] for c in db.session.query(ChallengeBank.category).distinct().all() if c[0]}
    )

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/challenge_bank/list.html",
        items=items,
        q=q,
        category=category,
        type_=type_,
        categories=categories,
        prev_page_args=args,
        next_page_args=args,
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
