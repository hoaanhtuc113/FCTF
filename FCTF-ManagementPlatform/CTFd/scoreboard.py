from flask import Blueprint, render_template, jsonify

from CTFd.utils import config
from CTFd.utils.config.visibility import scores_visible
from CTFd.utils.decorators.visibility import (
    check_account_visibility,
    check_score_visibility,
)
from CTFd.utils.helpers import get_infos
from CTFd.utils.scores import get_standings, getSubmitStandings
from CTFd.utils.user import is_admin

scoreboard = Blueprint("scoreboard", __name__)


@scoreboard.route("/scoreboard")
@check_account_visibility
@check_score_visibility
def listing():
    infos = get_infos()

    if config.is_scoreboard_frozen():
        infos.append("Scoreboard has been frozen")

    if is_admin() is True and scores_visible() is False:
        infos.append("Scores are not currently visible to users")

    standings = get_standings()
    fastestSubmissions = []
    for submission in getSubmitStandings():
        submission_dict = {column: getattr(submission, column) for column in submission.keys()}
        fastestSubmissions.append(submission_dict)
    print(fastestSubmissions)
    return render_template("scoreboard.html", standings=standings, infos=infos, fastestSubmissions= fastestSubmissions)

@scoreboard.route("/scoreboard-topstanding")
@check_account_visibility
@check_score_visibility
def listStanding(): 
    standings= get_standings()

    response_data = [
        {
            "account_id": standing.account_id,
            "oauth_id": standing.oauth_id,  # If OAuth integration is used
            "name": standing.name,
            "bracket_id": standing.bracket_id,
            "bracket_name": standing.bracket_name,
            "score": standing.score,
        }
        for standing in standings
    ]
    return response_data

    

    



    
