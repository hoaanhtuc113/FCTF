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
        """List challenges belonging to a given contest."""
        contest_id = request.args.get("contest_id", type=int)
        if not contest_id:
            return {"success": False, "errors": {"contest_id": ["Required"]}}, 400

        q = request.args.get("q", "").strip()
        category = request.args.get("category", "")
        type_ = request.args.get("type", "")
        difficulty = request.args.get("difficulty", "")
        page = abs(request.args.get("page", 1, type=int))
        per_page = min(abs(request.args.get("per_page", 50, type=int)), 200)

        query = Challenges.query.filter(Challenges.contest_id == contest_id)

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
                # All challenges returned already belong to this contest
                "imported": True,
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
        """Not applicable — challenges are created per-contest in the new schema."""
        return {
            "success": False,
            "error": (
                "Bulk import is not supported. "
                "Challenges are created directly within a contest."
            ),
        }, 405


@contest_challenges_namespace.route("/<int:cc_id>")
class ContestChallengeDetail(Resource):
    method_decorators = [admins_only]

    def delete(self, cc_id):
        """Remove (delete) a challenge from a contest by challenge id."""
        challenge = Challenges.query.filter_by(id=cc_id).first_or_404()
        db.session.delete(challenge)
        db.session.commit()
        return {"success": True, "data": {}}
