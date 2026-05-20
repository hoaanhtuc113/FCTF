"""
Contest-scoped statistics API — mirrors /api/v1/statistics/* but filtered
to a single contest's challenges and submissions.
"""
import datetime

from flask import request
from flask_restx import Namespace, Resource
from sqlalchemy import func

from CTFd.models import (
    Challenges,
    ContestChallenge,
    Contests,
    Fails,
    Hints,
    Solves,
    Submissions,
    Teams,
    Tracking,
    Unlocks,
    Users,
    db,
)
from CTFd.utils.decorators import admins_only

contest_statistics_namespace = Namespace(
    "contest_statistics",
    description="Per-contest statistics endpoints",
)


def _get_contest_challenge_ids(contest_id: int):
    """Return list of ContestChallenge.id for a given contest."""
    return [
        r[0]
        for r in db.session.query(ContestChallenge.id)
        .filter(ContestChallenge.contest_id == contest_id)
        .all()
    ]


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/summary
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/summary")
class ContestSummary(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        cc_ids = _get_contest_challenge_ids(contest_id)

        challenge_count = len(cc_ids)
        total_points = 0
        if cc_ids:
            total_points = (
                db.session.query(func.coalesce(func.sum(ContestChallenge.value), 0))
                .filter(ContestChallenge.contest_id == contest_id)
                .scalar() or 0
            )

        solve_count = 0
        wrong_count = 0
        if cc_ids:
            solve_count = (
                db.session.query(func.count(Solves.id))
                .filter(Solves.contest_challenge_id.in_(cc_ids))
                .scalar() or 0
            )
            wrong_count = (
                db.session.query(func.count(Fails.id))
                .filter(Fails.contest_challenge_id.in_(cc_ids))
                .scalar() or 0
            )

        # Participants
        if contest.user_mode == "teams":
            participant_count = (
                db.session.query(func.count(func.distinct(Submissions.team_id)))
                .filter(
                    Submissions.contest_challenge_id.in_(cc_ids),
                    Submissions.team_id.isnot(None),
                )
                .scalar() or 0
            ) if cc_ids else 0
        else:
            participant_count = (
                db.session.query(func.count(func.distinct(Submissions.user_id)))
                .filter(
                    Submissions.contest_challenge_id.in_(cc_ids),
                    Submissions.user_id.isnot(None),
                )
                .scalar() or 0
            ) if cc_ids else 0

        # Most / least solved challenge
        solve_data = {}
        if cc_ids:
            rows = (
                db.session.query(
                    Challenges.name,
                    func.count(Solves.id).label("cnt"),
                )
                .join(ContestChallenge, ContestChallenge.challenge_template_id == Challenges.id)
                .outerjoin(Solves, Solves.contest_challenge_id == ContestChallenge.id)
                .filter(ContestChallenge.contest_id == contest_id)
                .group_by(Challenges.name)
                .all()
            )
            solve_data = {r[0]: r[1] for r in rows}

        most_solved = max(solve_data, key=solve_data.get) if solve_data else None
        least_solved = min(solve_data, key=solve_data.get) if solve_data else None

        return {
            "success": True,
            "data": {
                "challenge_count": challenge_count,
                "total_points": int(total_points),
                "solve_count": solve_count,
                "wrong_count": wrong_count,
                "participant_count": participant_count,
                "user_mode": contest.user_mode,
                "solve_data": solve_data,
                "most_solved": most_solved,
                "least_solved": least_solved,
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/challenges/solves
# Mirrors /api/v1/statistics/challenges (solve counts per challenge)
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/challenges/solves")
class ContestChallengeSolves(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        cc_ids = _get_contest_challenge_ids(contest_id)
        if not cc_ids:
            return {"success": True, "data": []}

        rows = (
            db.session.query(
                ContestChallenge.id,
                Challenges.name,
                func.count(Solves.id).label("solves"),
            )
            .join(Challenges, Challenges.id == ContestChallenge.challenge_template_id)
            .outerjoin(Solves, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id)
            .group_by(ContestChallenge.id, Challenges.name)
            .all()
        )

        return {
            "success": True,
            "data": [{"id": r[0], "name": r[1], "solves": r[2]} for r in rows],
        }


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/challenges/percentages
# Mirrors /api/v1/statistics/challenges/percentages
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/challenges/percentages")
class ContestChallengePercentages(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        cc_ids = _get_contest_challenge_ids(contest_id)
        if not cc_ids:
            return {"success": True, "data": {}}

        # Total unique participants
        if contest.user_mode == "teams":
            total = (
                db.session.query(func.count(func.distinct(Submissions.team_id)))
                .filter(
                    Submissions.contest_challenge_id.in_(cc_ids),
                    Submissions.team_id.isnot(None),
                )
                .scalar() or 0
            )
        else:
            total = (
                db.session.query(func.count(func.distinct(Submissions.user_id)))
                .filter(
                    Submissions.contest_challenge_id.in_(cc_ids),
                    Submissions.user_id.isnot(None),
                )
                .scalar() or 0
            )

        rows = (
            db.session.query(
                ContestChallenge.id,
                Challenges.name,
                func.count(Solves.id).label("solves"),
            )
            .join(Challenges, Challenges.id == ContestChallenge.challenge_template_id)
            .outerjoin(Solves, Solves.contest_challenge_id == ContestChallenge.id)
            .filter(ContestChallenge.contest_id == contest_id)
            .group_by(ContestChallenge.id, Challenges.name)
            .all()
        )

        data = {}
        for r in rows:
            data[r[0]] = {
                "name": r[1],
                "solves": r[2],
                "percentage": round(r[2] / total, 4) if total > 0 else 0,
            }

        return {"success": True, "data": data}


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/submissions/types
# Mirrors /api/v1/statistics/submissions (correct vs incorrect counts)
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/submissions/types")
class ContestSubmissionTypes(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        cc_ids = _get_contest_challenge_ids(contest_id)
        if not cc_ids:
            return {"success": True, "data": {"correct": 0, "incorrect": 0}}

        correct = (
            db.session.query(func.count(Solves.id))
            .filter(Solves.contest_challenge_id.in_(cc_ids))
            .scalar() or 0
        )
        incorrect = (
            db.session.query(func.count(Fails.id))
            .filter(Fails.contest_challenge_id.in_(cc_ids))
            .scalar() or 0
        )

        return {"success": True, "data": {"correct": correct, "incorrect": incorrect}}


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/scores/distribution
# Mirrors /api/v1/statistics/scores/distribution
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/scores/distribution")
class ContestScoreDistribution(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        contest = Contests.query.filter_by(id=contest_id).first_or_404()
        cc_ids = _get_contest_challenge_ids(contest_id)
        if not cc_ids:
            return {"success": True, "data": {"brackets": {}}}

        # Compute score per participant
        if contest.user_mode == "teams":
            score_rows = (
                db.session.query(
                    Solves.team_id,
                    func.coalesce(func.sum(ContestChallenge.value), 0).label("score"),
                )
                .join(ContestChallenge, ContestChallenge.id == Solves.contest_challenge_id)
                .filter(Solves.contest_challenge_id.in_(cc_ids), Solves.team_id.isnot(None))
                .group_by(Solves.team_id)
                .all()
            )
        else:
            score_rows = (
                db.session.query(
                    Solves.user_id,
                    func.coalesce(func.sum(ContestChallenge.value), 0).label("score"),
                )
                .join(ContestChallenge, ContestChallenge.id == Solves.contest_challenge_id)
                .filter(Solves.contest_challenge_id.in_(cc_ids), Solves.user_id.isnot(None))
                .group_by(Solves.user_id)
                .all()
            )

        scores = [int(r[1]) for r in score_rows]
        if not scores:
            return {"success": True, "data": {"brackets": {}}}

        max_score = max(scores)
        bracket_size = max(1, max_score // 10)
        brackets = {}
        for score in scores:
            bracket = ((score // bracket_size) + 1) * bracket_size
            brackets[bracket] = brackets.get(bracket, 0) + 1

        return {"success": True, "data": {"brackets": brackets}}


# ─────────────────────────────────────────────────────────────────────────────
# /api/v1/contest_statistics/<contest_id>/challenges/analytics
# Mirrors /api/v1/statistics/challenges/analytics
# ─────────────────────────────────────────────────────────────────────────────
@contest_statistics_namespace.route("/<int:contest_id>/challenges/analytics")
class ContestChallengeAnalytics(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        cc_ids = _get_contest_challenge_ids(contest_id)
        if not cc_ids:
            return {
                "success": True,
                "data": {
                    "challenges": [],
                    "categories": {},
                    "category_most_solved": None,
                    "category_least_solved": None,
                },
            }

        # Per-challenge analytics
        rows = (
            db.session.query(
                ContestChallenge.id,
                Challenges.name,
                Challenges.category,
                ContestChallenge.value,
                ContestChallenge.max_attempts,
            )
            .join(Challenges, Challenges.id == ContestChallenge.challenge_template_id)
            .filter(ContestChallenge.contest_id == contest_id)
            .all()
        )

        challenges_out = []
        category_solves = {}

        for cc_id, name, category, value, max_attempts in rows:
            solve_count = (
                db.session.query(func.count(Solves.id))
                .filter(Solves.contest_challenge_id == cc_id)
                .scalar() or 0
            )
            wrong_attempts = (
                db.session.query(func.count(Fails.id))
                .filter(Fails.contest_challenge_id == cc_id)
                .scalar() or 0
            )
            attempter_count = (
                db.session.query(func.count(func.distinct(Submissions.user_id)))
                .filter(Submissions.contest_challenge_id == cc_id)
                .scalar() or 0
            )

            # Avg solve time (seconds from first submission to solve)
            avg_solve_seconds = None
            solve_times = (
                db.session.query(Solves.date)
                .filter(Solves.contest_challenge_id == cc_id)
                .all()
            )
            if solve_times:
                # Use contest start_time as reference if available
                contest_obj = Contests.query.get(contest_id)
                ref = contest_obj.start_time if contest_obj and contest_obj.start_time else None
                if ref:
                    deltas = [(s[0] - ref).total_seconds() for s in solve_times if s[0] and s[0] > ref]
                    if deltas:
                        avg_solve_seconds = sum(deltas) / len(deltas)

            # Hint usage
            hint_users = (
                db.session.query(func.count(func.distinct(Unlocks.user_id)))
                .join(Hints, Hints.id == Unlocks.hint_id)
                .filter(
                    Unlocks.contest_challenge_id == cc_id,
                    Unlocks.type == "hints",
                )
                .scalar() or 0
            )
            pct_solvers_used_hints = (
                round(hint_users / solve_count * 100, 2) if solve_count > 0 else None
            )
            avg_hints_per_solve = (
                round(hint_users / solve_count, 2) if solve_count > 0 else None
            )
            avg_attempts_per_attempter = (
                round((solve_count + wrong_attempts) / attempter_count, 2)
                if attempter_count > 0
                else None
            )

            challenges_out.append({
                "id": cc_id,
                "name": name,
                "category": category or "Uncategorized",
                "value": value,
                "max_attempts": max_attempts or 0,
                "solve_count": solve_count,
                "wrong_attempts": wrong_attempts,
                "attempter_count": attempter_count,
                "avg_solve_seconds": avg_solve_seconds,
                "pct_solvers_used_hints": pct_solvers_used_hints,
                "avg_hints_per_solve": avg_hints_per_solve,
                "avg_attempts_per_attempter": avg_attempts_per_attempter,
            })

            cat = category or "Uncategorized"
            category_solves[cat] = category_solves.get(cat, 0) + solve_count

        category_most_solved = None
        category_least_solved = None
        if category_solves:
            most_cat = max(category_solves, key=category_solves.get)
            least_cat = min(category_solves, key=category_solves.get)
            category_most_solved = {"name": most_cat, "solves": category_solves[most_cat]}
            category_least_solved = {"name": least_cat, "solves": category_solves[least_cat]}

        return {
            "success": True,
            "data": {
                "challenges": challenges_out,
                "categories": category_solves,
                "category_most_solved": category_most_solved,
                "category_least_solved": category_least_solved,
            },
        }
