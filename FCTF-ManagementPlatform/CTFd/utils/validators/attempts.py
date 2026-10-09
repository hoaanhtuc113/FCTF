from collections.abc import Mapping

from CTFd.utils.validators.scoring import score_integer, ScoringValidationError


def validate_attempt_input(data):
    if not isinstance(data, Mapping):
        raise ScoringValidationError("body", "Expected an object")
    challenge_id = data.get("challengeId", data.get("challenge_id"))
    challenge_id = score_integer(challenge_id, "challengeId", minimum=1)
    if "challengeId" in data and "challenge_id" in data:
        alias = score_integer(data["challenge_id"], "challenge_id", minimum=1)
        if alias != challenge_id:
            raise ScoringValidationError("challengeId", "Challenge IDs must match")
    submission = data.get("submission")
    if not isinstance(submission, str) or not submission.strip():
        raise ScoringValidationError("submission", "Submission must be a non-empty string")
    if len(submission.strip()) > 1000:
        raise ScoringValidationError("submission", "Submission must not exceed 1000 characters")
    return challenge_id
