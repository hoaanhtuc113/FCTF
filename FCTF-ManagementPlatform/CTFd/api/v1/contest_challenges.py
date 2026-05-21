from flask import request
from flask_restx import Namespace, Resource

from CTFd.models import Challenges, Contests, db
from CTFd.utils.decorators import admins_only

contest_challenges_namespace = Namespace(
    "contest_challenges",
    description="Endpoint to manage Contest Challenges",
)


@contest_challenges_namespace.route("")
class ContestChallengeList(Resource):
    method_decorators = [admins_only]

    def get(self):
        """List challenge bank with imported flag for a given contest."""
        contest_id = request.args.get("contest_id", type=int)
        if not contest_id:
            return {"success": False, "errors": {"contest_id": ["Required"]}}, 400

        q = request.args.get("q", "").strip()
        category = request.args.get("category", "")
        type_ = request.args.get("type", "")
        difficulty = request.args.get("difficulty", "")
        page = abs(request.args.get("page", 1, type=int))
        per_page = min(abs(request.args.get("per_page", 50, type=int)), 200)

        imported_ids = {
            r[0]
            for r in db.session.query(ContestChallenge.challenge_template_id)
            .filter(ContestChallenge.contest_id == contest_id)
            .all()
        }

        query = Challenges.query
        if q:
            query = query.filter(
                db.or_(
                    Challenges.name.ilike(f"%{q}%"),
                    Challenges.category.ilike(f"%{q}%"),
                )
            )
        if category:
            query = query.filter(Challenges.category == category)
        if type_:
            query = query.filter(Challenges.type == type_)
        if difficulty:
            try:
                query = query.filter(Challenges.difficulty == int(difficulty))
            except ValueError:
                pass

        paginated = query.order_by(Challenges.id.asc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        data = [
            {
                "id": c.id,
                "name": c.name,
                "category": c.category or "",
                "type": c.type or "standard",
                "difficulty": c.difficulty,
                "require_deploy": bool(c.require_deploy),
                "imported": c.id in imported_ids,
            }
            for c in paginated.items
        ]

        return {
            "success": True,
            "data": data,
            "meta": {
                "page": paginated.page,
                "pages": paginated.pages,
                "per_page": per_page,
                "total": paginated.total,
            },
        }

    def post(self):
        """Bulk import challenges into a contest."""
        body = request.get_json(force=True, silent=True) or {}
        contest_id = body.get("contest_id")
        challenge_ids = body.get("challenge_ids", [])

        if not contest_id:
            return {"success": False, "errors": {"contest_id": ["Required"]}}, 400
        if not challenge_ids:
            return {"success": False, "errors": {"challenge_ids": ["At least one required"]}}, 400

        Contests.query.filter_by(id=contest_id).first_or_404()

        existing = {
            r[0]
            for r in db.session.query(ContestChallenge.challenge_template_id)
            .filter(ContestChallenge.contest_id == contest_id)
            .all()
        }

        imported_count = 0
        skipped_count = 0
        for cid in challenge_ids:
            if cid in existing:
                skipped_count += 1
                continue
            chall = Challenges.query.filter_by(id=cid).first()
            if not chall:
                skipped_count += 1
                continue
            db.session.add(
                ContestChallenge(
                    contest_id=contest_id,
                    challenge_template_id=cid,
                    state="hidden",
                )
            )
            imported_count += 1

        db.session.commit()

        return {
            "success": True,
            "data": {"imported": imported_count, "skipped": skipped_count},
        }, 201


@contest_challenges_namespace.route("/<int:cc_id>")
class ContestChallengeDetail(Resource):
    method_decorators = [admins_only]

    def delete(self, cc_id):
        """Remove a challenge from a contest."""
        cc = ContestChallenge.query.filter_by(id=cc_id).first_or_404()
        db.session.delete(cc)
        db.session.commit()
        return {"success": True, "data": {}}
