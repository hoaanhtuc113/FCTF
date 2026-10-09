"""Keep solve mutations and dynamic values in the same database transaction.

All score writers lock the parent challenge before writing solves. MySQL locking
reads also avoid an older REPEATABLE READ snapshot established by authentication.
The caller owns commit/rollback; these helpers never commit.
"""

from CTFd.models import Challenges, Solves, Teams, Users, db
from sqlalchemy import false, or_
from CTFd.utils.config import is_teams_mode
from CTFd.utils.validators.scoring import ScoringValidationError, score_integer


def lock_challenge(challenge_id):
    with db.session.no_autoflush:
        challenge = (Challenges.query.filter_by(id=challenge_id).populate_existing()
                     .with_for_update().first_or_404())
        if challenge.type == "dynamic":
            from CTFd.plugins.dynamic_challenges import DynamicChallenge

            # Refresh the joined child with a locking read too; lazy loading it
            # would still use a snapshot taken before another writer committed.
            challenge = (DynamicChallenge.query.filter_by(id=challenge_id)
                         .populate_existing().with_for_update().first_or_404())
        return challenge


def validate_solve_account(submission):
    user = Users.query.get(submission.user_id)
    if user is None:
        raise ScoringValidationError("user_id", "User does not exist")
    if is_teams_mode() and submission.team_id is None:
        submission.team_id = user.team_id
    if is_teams_mode() and submission.team_id is None:
        raise ScoringValidationError("team_id", "A team is required in team mode")
    if submission.team_id is not None:
        if Teams.query.get(submission.team_id) is None or user.team_id != submission.team_id:
            raise ScoringValidationError("team_id", "Team must match the submitting user")


def existing_solve(submission):
    return Solves.query.filter(
        Solves.challenge_id == submission.challenge_id,
        or_(Solves.user_id == submission.user_id,
            Solves.team_id == submission.team_id if submission.team_id is not None else false()),
    ).with_for_update().first()


def recalculate(challenge):
    if challenge.type == "dynamic":
        from CTFd.plugins.dynamic_challenges import DynamicValueChallenge

        DynamicValueChallenge.calculate_value(challenge, commit=False)
    else:
        score_integer(challenge.value)
