from flask import request
from flask_restx import Namespace, Resource

from CTFd.models import Challenges, Contests, db
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury, admins_only
from CTFd.utils.logging.action_logger import (
    DELETE_CHALLENGE,
    UPDATE_CHALLENGE_VISIBILITY,
    log_action,
)

contest_challenges_namespace = Namespace(
    "contest_challenges",
    description="Endpoint to manage Contest Challenges",
)


@contest_challenges_namespace.route("")
class ContestChallengeList(Resource):
    method_decorators = [admin_or_challenge_writer_only_or_jury]

    def get(self):
        """List challenges for a given contest."""
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
                "state": c.state,
                "source_bank_id": c.source_bank_id,
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
        """Bulk update challenge states within a contest (e.g. set to 'visible')."""
        body = request.get_json(force=True, silent=True) or {}
        contest_id = body.get("contest_id")
        challenge_ids = body.get("challenge_ids", [])
        state = body.get("state", "visible")

        if not contest_id:
            return {"success": False, "errors": {"contest_id": ["Required"]}}, 400

        Contests.query.filter_by(id=contest_id).first_or_404()

        updated_count = 0
        changed = []
        for cid in challenge_ids:
            chall = Challenges.query.filter_by(id=cid, contest_id=contest_id).first()
            if chall and chall.state != state:
                changed.append({"id": chall.id, "name": chall.name, "from": chall.state, "to": state})
                chall.state = state
                updated_count += 1
            elif chall:
                updated_count += 1

        db.session.commit()

        if changed:
            log_action(
                UPDATE_CHALLENGE_VISIBILITY,
                f'Set {len(changed)} challenge(s) to state "{state}"',
                contest_id=contest_id,
                before={"challenges": [{"id": c["id"], "name": c["name"], "state": c["from"]} for c in changed]},
                after={"state": state, "challenge_ids": [c["id"] for c in changed]},
            )

        return {
            "success": True,
            "data": {"updated": updated_count},
        }, 200


@contest_challenges_namespace.route("/<int:challenge_id>")
class ContestChallengeDetail(Resource):
    method_decorators = [admin_or_challenge_writer_only_or_jury]

    def delete(self, challenge_id):
        """Delete a challenge from a contest."""
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
        challenge_info = {
            "id": challenge.id,
            "name": challenge.name,
            "category": challenge.category,
            "contest_id": challenge.contest_id,
        }
        db.session.delete(challenge)
        db.session.commit()

        log_action(
            DELETE_CHALLENGE,
            f'Deleted challenge "{challenge_info["name"]}"',
            contest_id=challenge_info["contest_id"],
            before=challenge_info,
        )
        return {"success": True, "data": {}}
