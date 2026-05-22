import datetime
from collections import namedtuple

from sqlalchemy import func as sa_func
from sqlalchemy.sql import and_, false, true

from CTFd.cache import cache
from CTFd.models import Challenges, Solves, Users, db
from CTFd.schemas.tags import TagSchema
from CTFd.utils import get_config
from CTFd.utils.dates import isoformat, unix_time_to_utc
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.modes import generate_account_url, get_model

Challenge = namedtuple(
    "Challenge", ["id", "type", "name", "value", "category", "tags", "requirements"]
)


@cache.memoize(timeout=60)
def get_all_challenges(admin=False, field=None, q=None, **query_args):
    filters = build_model_filters(model=Challenges, query=q, field=field)
    chal_q = Challenges.query

    # Admins can see hidden and locked challenges in the admin view
    if admin is False:
        chal_q = chal_q.filter(
            and_(Challenges.state != "hidden", Challenges.state != "locked")
        )

    # Add filter for challenges created by the current user if provided
    if "challenge_writer" in query_args:
        chal_q = chal_q.filter_by(user_id=query_args)

    chal_q = (
        chal_q.filter_by(**query_args)
        .filter(*filters)
        .order_by(Challenges.value, Challenges.id)
    )

    tag_schema = TagSchema(view="user", many=True)

    results = []
    for c in chal_q:
        ct = Challenge(
            id=c.id,
            type=c.type,
            name=c.name,
            value=c.value,
            category=c.category,
            requirements=c.requirements,
            tags=tag_schema.dump(c.tags).data,
        )
        results.append(ct)
    return results


@cache.memoize(timeout=60)
def get_solves_for_challenge_id(challenge_id, freeze=False):
    """Get solves for a given challenge_id."""
    Model = get_model()
    solves = (
        Solves.query.add_columns(Model.name.label("account_name"))
        .join(Model, Solves.account_id == Model.id)
        .filter(
            Solves.challenge_id == challenge_id,
            Model.banned == False,
            Model.hidden == False,
        )
        .order_by(Solves.date.asc())
    )
    if freeze:
        freeze_time = get_config("freeze")
        if freeze_time:
            dt = datetime.datetime.utcfromtimestamp(freeze_time)
            solves = solves.filter(Solves.date < dt)
    results = []

    for solve in solves:
        # Seperate out the account name and the Solve object from the SQLAlchemy tuple
        solve, account_name = solve
        results.append(
            {
                "account_id": solve.account_id,
                "name": account_name,
                "date": isoformat(solve.date),
                "account_url": generate_account_url(account_id=solve.account_id),
            }
        )
    return results


@cache.memoize(timeout=60)
def get_solve_ids_for_user_id(user_id):
    """Return a set of challenge_ids that the user has solved."""
    user = Users.query.filter_by(id=user_id).first()
    solve_ids = (
        Solves.query.with_entities(Solves.challenge_id)
        .filter(Solves.account_id == user.account_id)
        .all()
    )
    solve_ids = {value for value, in solve_ids}
    return solve_ids


@cache.memoize(timeout=60)
def get_solve_counts_for_challenges(challenge_id=None, admin=False):
    """Return a dict of {challenge_id: solve_count}."""
    AccountModel = get_model()
    freeze = get_config("freeze")
    if freeze and not admin:
        freeze_cond = Solves.date < unix_time_to_utc(freeze)
    else:
        freeze_cond = true()
    exclude_solves_cond = and_(
        AccountModel.banned == false(),
        AccountModel.hidden == false(),
    )

    solves_q = (
        db.session.query(
            Solves.challenge_id,
            sa_func.count(Solves.id),
        )
        .join(AccountModel, Solves.account_id == AccountModel.id)
        .filter(freeze_cond, exclude_solves_cond)
    )

    if challenge_id is not None:
        solves_q = solves_q.filter(Solves.challenge_id == challenge_id)

    solves_q = solves_q.group_by(Solves.challenge_id)

    solve_counts = {}
    for chal_id, solve_count in solves_q:
        solve_counts[chal_id] = solve_count
    return solve_counts
