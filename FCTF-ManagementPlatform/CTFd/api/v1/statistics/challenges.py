from flask_restx import Resource
from sqlalchemy import func, literal, text
from sqlalchemy.sql import and_

from CTFd.api.v1.statistics import statistics_namespace
from CTFd.models import Challenges, Fails, HintUnlocks, Hints, Solves, Teams, Users, db
from CTFd.utils import get_config
from CTFd.utils.dates import unix_time_to_utc
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury, admin_or_jury
from CTFd.utils.modes import get_model


@statistics_namespace.route("/challenges/<column>")
class ChallengePropertyCounts(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, column):
        if column in Challenges.__table__.columns.keys():
            prop = getattr(Challenges, column)
            data = (
                Challenges.query.with_entities(prop, func.count(prop))
                .group_by(prop)
                .all()
            )
            return {"success": True, "data": dict(data)}
        else:
            response = {"message": "That could not be found"}, 404
            return response


@statistics_namespace.route("/challenges/solves")
class ChallengeSolveStatistics(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        chals = (
            Challenges.query.filter(
                and_(Challenges.state != "hidden", Challenges.state != "locked")
            )
            .order_by(Challenges.value)
            .all()
        )

        Model = get_model()

        solves_sub = (
            db.session.query(
                Solves.challenge_id, db.func.count(Solves.challenge_id).label("solves")
            )
            .join(Model, Solves.account_id == Model.id)
            .filter(Model.banned == False, Model.hidden == False)
            .group_by(Solves.challenge_id)
            .subquery()
        )

        solves = (
            db.session.query(
                solves_sub.columns.challenge_id,
                solves_sub.columns.solves,
                Challenges.name,
            )
            .join(Challenges, solves_sub.columns.challenge_id == Challenges.id)
            .all()
        )

        response = []
        has_solves = []

        for challenge_id, count, name in solves:
            challenge = {"id": challenge_id, "name": name, "solves": count}
            response.append(challenge)
            has_solves.append(challenge_id)
        for c in chals:
            if c.id not in has_solves:
                challenge = {"id": c.id, "name": c.name, "solves": 0}
                response.append(challenge)

        db.session.close()
        return {"success": True, "data": response}


@statistics_namespace.route("/challenges/solves/percentages")
class ChallengeSolvePercentages(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        challenges = (
            Challenges.query.add_columns(
                Challenges.id,
                Challenges.name,
                Challenges.state,
                Challenges.max_attempts,
            )
            .order_by(Challenges.value)
            .all()
        )

        Model = get_model()

        teams_with_points = (
            db.session.query(Solves.account_id)
            .join(Model)
            .filter(Model.banned == False, Model.hidden == False)
            .group_by(Solves.account_id)
            .count()
        )

        percentage_data = []
        for challenge in challenges:
            solve_count = (
                Solves.query.join(Model, Solves.account_id == Model.id)
                .filter(
                    Solves.challenge_id == challenge.id,
                    Model.banned == False,
                    Model.hidden == False,
                )
                .count()
            )

            if teams_with_points > 0:
                percentage = float(solve_count) / float(teams_with_points)
            else:
                percentage = 0.0

            percentage_data.append(
                {"id": challenge.id, "name": challenge.name, "percentage": percentage}
            )

        response = sorted(percentage_data, key=lambda x: x["percentage"], reverse=True)
        return {"success": True, "data": response}


@statistics_namespace.route("/challenges/analytics")
class ChallengeAnalytics(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        start_raw = get_config("start")
        end_raw = get_config("end")
        start_ts = int(start_raw) if start_raw else 0
        end_ts = int(end_raw) if end_raw else 0

        start_dt = unix_time_to_utc(start_ts) if start_ts else None
        end_dt = unix_time_to_utc(end_ts) if end_ts else None

        Model = get_model()

        def time_filters(column):
            filters = []
            if start_dt:
                filters.append(column >= start_dt)
            if end_dt:
                filters.append(column <= end_dt)
            return filters

        total_accounts = (
            db.session.query(func.count(Model.id))
            .filter(Model.banned == False, Model.hidden == False)
            .scalar()
        ) or 0

        avg_expr = (
            func.avg(func.timestampdiff(text("SECOND"), start_dt, Solves.date))
            if start_dt
            else literal(None)
        )

        solves_sub = (
            db.session.query(
                Solves.challenge_id,
                func.count(Solves.id).label("solve_count"),
                avg_expr.label("avg_solve_seconds"),
            )
            .join(Model, Solves.account_id == Model.id)
            .filter(Model.banned == False, Model.hidden == False, *time_filters(Solves.date))
            .group_by(Solves.challenge_id)
            .subquery()
        )

        fails_sub = (
            db.session.query(
                Fails.challenge_id,
                func.count(Fails.id).label("wrong_attempts"),
            )
            .join(Model, Fails.account_id == Model.id)
            .filter(Model.banned == False, Model.hidden == False, *time_filters(Fails.date))
            .group_by(Fails.challenge_id)
            .subquery()
        )

        user_mode = get_config("user_mode")
        if user_mode == "teams":
            account_model = Teams
            account_join = HintUnlocks.team_id == Teams.id
            account_filters = [Teams.banned == False, Teams.hidden == False]
        else:
            account_model = Users
            account_join = HintUnlocks.user_id == Users.id
            account_filters = [Users.banned == False, Users.hidden == False]

        hint_usage_sub = (
            db.session.query(
                Hints.challenge_id,
                func.count(HintUnlocks.id).label("hint_usage"),
            )
            .join(Hints, HintUnlocks.target == Hints.id)
            .join(account_model, account_join)
            .filter(*account_filters, *time_filters(HintUnlocks.date))
            .group_by(Hints.challenge_id)
            .subquery()
        )

        hint_count_sub = (
            db.session.query(
                Hints.challenge_id,
                func.count(Hints.id).label("hint_count"),
            )
            .group_by(Hints.challenge_id)
            .subquery()
        )

        challenges = (
            db.session.query(
                Challenges.id,
                Challenges.name,
                Challenges.category,
                solves_sub.c.solve_count,
                solves_sub.c.avg_solve_seconds,
                fails_sub.c.wrong_attempts,
                hint_usage_sub.c.hint_usage,
                hint_count_sub.c.hint_count,
            )
            .outerjoin(solves_sub, Challenges.id == solves_sub.c.challenge_id)
            .outerjoin(fails_sub, Challenges.id == fails_sub.c.challenge_id)
            .outerjoin(hint_usage_sub, Challenges.id == hint_usage_sub.c.challenge_id)
            .outerjoin(hint_count_sub, Challenges.id == hint_count_sub.c.challenge_id)
            .filter(and_(Challenges.state != "hidden", Challenges.state != "locked"))
            .order_by(Challenges.category, Challenges.name)
            .all()
        )

        response = []
        for chal in challenges:
            solve_count = int(chal.solve_count or 0)
            solve_rate = (float(solve_count) / float(total_accounts)) if total_accounts else 0.0
            hint_usage = int(chal.hint_usage or 0)
            hint_count = int(chal.hint_count or 0)
            hint_usage_per_hint = (
                float(hint_usage) / float(hint_count) if hint_count else None
            )
            response.append(
                {
                    "id": chal.id,
                    "name": chal.name,
                    "category": chal.category or "Uncategorized",
                    "solve_count": solve_count,
                    "solve_rate": solve_rate,
                    "avg_solve_seconds": (
                        float(chal.avg_solve_seconds)
                        if chal.avg_solve_seconds is not None
                        else None
                    ),
                    "wrong_attempts": int(chal.wrong_attempts or 0),
                    "hint_usage": hint_usage,
                    "hint_count": hint_count,
                    "hint_usage_per_hint": hint_usage_per_hint,
                }
            )

        category_counts = (
            db.session.query(Challenges.category, func.count(Solves.id).label("solves"))
            .join(Solves, Solves.challenge_id == Challenges.id)
            .join(Model, Solves.account_id == Model.id)
            .filter(
                Model.banned == False,
                Model.hidden == False,
                and_(Challenges.state != "hidden", Challenges.state != "locked"),
                *time_filters(Solves.date)
            )
            .group_by(Challenges.category)
            .all()
        )

        categories = (
            db.session.query(Challenges.category)
            .filter(and_(Challenges.state != "hidden", Challenges.state != "locked"))
            .distinct()
            .all()
        )

        category_data = {
            (c[0] or "Uncategorized"): 0 for c in categories
        }
        for category, solves in category_counts:
            name = category or "Uncategorized"
            category_data[name] = int(solves or 0)

        most_category = None
        least_category = None
        if category_data:
            most_category = max(category_data, key=category_data.get)
            least_category = min(category_data, key=category_data.get)

        db.session.close()
        return {
            "success": True,
            "data": {
                "total_accounts": total_accounts,
                "start": start_ts,
                "end": end_ts,
                "challenges": response,
                "categories": category_data,
                "category_most_solved": {
                    "name": most_category,
                    "solves": category_data.get(most_category, 0) if most_category else 0,
                },
                "category_least_solved": {
                    "name": least_category,
                    "solves": category_data.get(least_category, 0) if least_category else 0,
                },
            },
        }
