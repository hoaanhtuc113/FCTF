from sqlalchemy.sql.expression import union_all

from CTFd.cache import cache
from CTFd.models import Achievements, AwardBadges, Awards, Brackets, Challenges, Solves, Teams, Users, db
from CTFd.utils import get_config
from CTFd.utils.dates import unix_time_to_utc
from CTFd.utils.modes import get_model
from sqlalchemy import func


@cache.memoize(timeout=60)
def get_standings(count=None, bracket_id=None, admin=False, fields=None):
    """
    Get standings as a list of tuples containing account_id, name, and score e.g. [(account_id, team_name, score)].

    Ties are broken by who reached a given score first based on the solve ID. Two users can have the same score but one
    user will have a solve ID that is before the others. That user will be considered the tie-winner.

    Challenges & Awards with a value of zero are filtered out of the calculations to avoid incorrect tie breaks.
    """
    if fields is None:
        fields = []
    Model = get_model()
    print(f"Arguments received: admin={admin}")
    scores = (
        db.session.query(
            Solves.account_id.label("account_id"),
            db.func.sum(Challenges.value).label("score"),
            db.func.max(Solves.id).label("id"),
            db.func.max(Solves.date).label("date"),
        )
        .join(Challenges)
        .filter(Challenges.value != 0)
        .group_by(Solves.account_id)
    )

    awards = (
        db.session.query(
            Awards.account_id.label("account_id"),
            db.func.sum(Awards.value).label("score"),
            db.func.max(Awards.id).label("id"),
            db.func.max(Awards.date).label("date"),
        )
        .filter(Awards.value != 0)
        .group_by(Awards.account_id)
    )

    """
    Filter out solves and awards that are before a specific time point.
    """
    freeze = get_config("freeze")
    

    if not admin and freeze:
        
        scores = scores.filter(Solves.date < unix_time_to_utc(freeze))
        awards = awards.filter(Awards.date < unix_time_to_utc(freeze))

    """
    Combine awards and solves with a union. They should have the same amount of columns
    """
    results = union_all(scores, awards).alias("results")

    """
    Sum each of the results by the team id to get their score.
    """
    print('a', scores)
    print('b', awards)
    sumscores = (
        db.session.query(
            results.columns.account_id,
            db.func.sum(results.columns.score).label("score"),
            db.func.max(results.columns.id).label("id"),
            db.func.max(results.columns.date).label("date"),
        )
        .group_by(results.columns.account_id)
        .subquery()
    )

    """
    Admins can see scores for all users but the public cannot see banned users.

    Filters out banned users.
    Properly resolves value ties by ID.

    Different databases treat time precision differently so resolve by the row ID instead.
    """
    if admin:
        standings_query = (
            db.session.query(
                Model.id.label("account_id"),
                Model.oauth_id.label("oauth_id"),
                Model.name.label("name"),
                Model.bracket_id.label("bracket_id"),
                Brackets.name.label("bracket_name"),
                Model.hidden,
                Model.banned,
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Model.id == sumscores.columns.account_id)
            .join(Brackets, isouter=True)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )
    else:
        standings_query = (
            db.session.query(
                Model.id.label("account_id"),
                Model.oauth_id.label("oauth_id"),
                Model.name.label("name"),
                Model.bracket_id.label("bracket_id"),
                Brackets.name.label("bracket_name"),
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Model.id == sumscores.columns.account_id)
            .join(Brackets, isouter=True)
            .filter(Model.banned == False, Model.hidden == False)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )

    # Filter on a bracket if asked
    if bracket_id is not None:
        standings_query = standings_query.filter(Model.bracket_id == bracket_id)

    # Only select a certain amount of users if asked.
    if count is None:
        standings = standings_query.all()
    else:
        standings = standings_query.limit(count).all()

    return standings


@cache.memoize(timeout=60)
def get_team_standings(count=None, bracket_id=None, admin=False, fields=None):
    if fields is None:
        fields = []
    scores = (
        db.session.query(
            Solves.team_id.label("team_id"),
            db.func.sum(Challenges.value).label("score"),
            db.func.max(Solves.id).label("id"),
            db.func.max(Solves.date).label("date"),
        )
        .join(Challenges)
        .filter(Challenges.value != 0)
        .group_by(Solves.team_id)
    )

    awards = (
        db.session.query(
            Awards.team_id.label("team_id"),
            db.func.sum(Awards.value).label("score"),
            db.func.max(Awards.id).label("id"),
            db.func.max(Awards.date).label("date"),
        )
        .filter(Awards.value != 0)
        .group_by(Awards.team_id)
    )

    freeze = get_config("freeze")
    if not admin and freeze:
        scores = scores.filter(Solves.date < unix_time_to_utc(freeze))
        awards = awards.filter(Awards.date < unix_time_to_utc(freeze))

    results = union_all(scores, awards).alias("results")

    sumscores = (
        db.session.query(
            results.columns.team_id,
            db.func.sum(results.columns.score).label("score"),
            db.func.max(results.columns.id).label("id"),
            db.func.max(results.columns.date).label("date"),
        )
        .group_by(results.columns.team_id)
        .subquery()
    )

    if admin:
        standings_query = (
            db.session.query(
                Teams.id.label("team_id"),
                Teams.oauth_id.label("oauth_id"),
                Teams.name.label("name"),
                Teams.hidden,
                Teams.banned,
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Teams.id == sumscores.columns.team_id)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )
    else:
        standings_query = (
            db.session.query(
                Teams.id.label("team_id"),
                Teams.oauth_id.label("oauth_id"),
                Teams.name.label("name"),
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Teams.id == sumscores.columns.team_id)
            .filter(Teams.banned == False)
            .filter(Teams.hidden == False)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )

    if bracket_id is not None:
        standings_query = standings_query.filter(Teams.bracket_id == bracket_id)

    if count is None:
        standings = standings_query.all()
    else:
        standings = standings_query.limit(count).all()

    return standings


@cache.memoize(timeout=60)
def get_user_standings(count=None, bracket_id=None, admin=False, fields=None):
    if fields is None:
        fields = []
    scores = (
        db.session.query(
            Solves.user_id.label("user_id"),
            db.func.sum(Challenges.value).label("score"),
            db.func.max(Solves.id).label("id"),
            db.func.max(Solves.date).label("date"),
        )
        .join(Challenges)
        .filter(Challenges.value != 0)
        .group_by(Solves.user_id)
    )

    awards = (
        db.session.query(
            Awards.user_id.label("user_id"),
            db.func.sum(Awards.value).label("score"),
            db.func.max(Awards.id).label("id"),
            db.func.max(Awards.date).label("date"),
        )
        .filter(Awards.value != 0)
        .group_by(Awards.user_id)
    )

    freeze = get_config("freeze")
    if not admin and freeze:
        print(freeze)
        scores = scores.filter(Solves.date < unix_time_to_utc(freeze))
        awards = awards.filter(Awards.date < unix_time_to_utc(freeze))

    results = union_all(scores, awards).alias("results")

    sumscores = (
        db.session.query(
            results.columns.user_id,
            db.func.sum(results.columns.score).label("score"),
            db.func.max(results.columns.id).label("id"),
            db.func.max(results.columns.date).label("date"),
        )
        .group_by(results.columns.user_id)
        .subquery()
    )

    if admin:
        standings_query = (
            db.session.query(
                Users.id.label("user_id"),
                Users.oauth_id.label("oauth_id"),
                Users.name.label("name"),
                Users.team_id.label("team_id"),
                Users.hidden,
                Users.banned,
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Users.id == sumscores.columns.user_id)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )
    else:
        standings_query = (
            db.session.query(
                Users.id.label("user_id"),
                Users.oauth_id.label("oauth_id"),
                Users.name.label("name"),
                Users.team_id.label("team_id"),
                sumscores.columns.score,
                *fields,
            )
            .join(sumscores, Users.id == sumscores.columns.user_id)
            .filter(Users.banned == False, Users.hidden == False)
            .order_by(
                sumscores.columns.score.desc(),
                sumscores.columns.date.asc(),
                sumscores.columns.id.asc(),
            )
        )

    if bracket_id is not None:
        standings_query = standings_query.filter(Users.bracket_id == bracket_id)

    if count is None:
        standings = standings_query.all()
    else:
        standings = standings_query.limit(count).all()

    return standings

def getSubmitStandings(count=None, bracket_id=None, fields=None, challenge_id=None, admin=False):
    if fields is None:
        fields = []

    
    submissions_query = (
        db.session.query(
            Solves.team_id.label("team_id"),
            Teams.name.label("team_name"),
            Challenges.id.label("challenge_id"),
            Challenges.name.label("challenge_name"),
            Solves.date.label("submission_time"),
            Teams.country.label("country"),

            *fields,
        )
        .join(Teams, Solves.team_id == Teams.id)
        .join(Challenges, Solves.challenge_id == Challenges.id)
        .order_by(Solves.date.asc())
    )

   
    if challenge_id is not None:
        submissions_query = submissions_query.filter(Solves.challenge_id == challenge_id)

    
    if bracket_id is not None:
        submissions_query = submissions_query.filter(Solves.bracket_id == bracket_id)

   
    if not admin:
        submissions_query = submissions_query.filter(Teams.hidden == False, Teams.banned == False)

    
    if count is not None:
        fastest_submissions = submissions_query.limit(count).all()
    else:
        fastest_submissions = submissions_query.all()

    return fastest_submissions

def get_team_challenge_counts(team_name=None, min_solved_count=None, hidden=None, banned=None, is_admin=False):
    query = (
        db.session.query(
            Teams.id.label("team_id"),
            Teams.name.label("team_name"),
            func.count(Solves.challenge_id).label("solved_challenges_count"),
            Teams.hidden,
            Teams.banned
        )
        .join(Solves, Solves.team_id == Teams.id)
        .group_by(Teams.id)
        .order_by(func.count(Solves.challenge_id).desc())
    )

    if team_name:
        query = query.filter(Teams.name.ilike(f"%{team_name}%"))

    if min_solved_count is not None:
        query = query.having(func.count(Solves.challenge_id) >= min_solved_count)

    if not is_admin:
        query = query.filter(Teams.hidden == False, Teams.banned == False)
    else:
        if hidden is not None:
            query = query.filter(Teams.hidden == hidden)

        if banned is not None:
            query = query.filter(Teams.banned == banned)

    team_challenge_counts = query.all()
    return team_challenge_counts


def get_teams_cleared_all_challenges_by_topic(team_name=None, country=None, user_is_admin=False):
    # Lấy danh sách các chủ đề (categories)
    topics = db.session.query(Challenges.category).distinct().all()
    cleared_teams = {}

    for topic in topics:
        topic_name = topic[0]

        # Lấy danh sách ID của các bài trong chủ đề
        challenge_ids = db.session.query(Challenges.id).filter(Challenges.category == topic_name, Challenges.state != 'hidden').all()
        challenge_ids = [challenge.id for challenge in challenge_ids]

        if not challenge_ids:
            continue  # Bỏ qua nếu không có bài trong chủ đề

        # Truy vấn các đội đã giải bài
        teams_query = (
            db.session.query(
                Teams.id.label("team_id"),
                Teams.name.label("team_name"),
                func.count(Solves.challenge_id).label("solved_count"),
                func.max(Solves.date).label("last_submission_time")
            )
            .join(Solves, (Solves.team_id == Teams.id) & (Solves.type == "correct"))
            .filter(Solves.challenge_id.in_(challenge_ids))
            .group_by(Teams.id)
        )

        # Lọc các đội nếu user không phải admin
        if not user_is_admin:
            teams_query = teams_query.filter(Teams.hidden.is_(False), Teams.banned.is_(False))

        # Lọc theo tên đội và quốc gia nếu có
        if team_name:
            teams_query = teams_query.filter(Teams.name.ilike(f"%{team_name}%"))
        if country:
            teams_query = teams_query.filter(Teams.country.ilike(f"%{country}%"))

        # Tìm các đội đã giải hết tất cả bài trong chủ đề
        all_cleared_teams = teams_query.having(func.count(Solves.challenge_id) == len(challenge_ids)).all()

        if all_cleared_teams:
            # Nếu có đội giải hết, thêm trạng thái CLEARED
            cleared_teams[topic_name] = [
                {
                    "team_id":team.team_id,
                    "team_name": team.team_name,
                    "status": "CLEARED",
                    "last_submission_time": team.last_submission_time,
                }
                for team in all_cleared_teams
            ]
        else:
            # Nếu không đội nào giải hết, xếp hạng theo số bài giải được và thời gian nhanh nhất
            top_teams = teams_query.order_by(
                func.count(Solves.challenge_id).desc(),
                func.max(Solves.date).asc()
            ).all()
            cleared_teams[topic_name] = [
                {
                    "team_id":team.team_id,
                    "team_name": team.team_name,
                    
                    "status": f"{team.solved_count} solved",
                    "last_submission_time": team.last_submission_time,
                }
                for team in top_teams
            ]

    return cleared_teams

def create_achievement_for_team_or_user(team_or_user, challenge, name):
    """
    Hàm hỗ trợ tạo thành tích cho đội hoặc người dùng.
    """
    # Kiểm tra xem đã có thành tích cho đội này và challenge này chưa
    existing_achievement = db.session.query(Achievements).filter_by(
        challenge_id=challenge.id,
        name=name,
        team_id=team_or_user.id if isinstance(team_or_user, Teams) else None,
        user_id=team_or_user.id if isinstance(team_or_user, Users) else None
    ).first()

    if not existing_achievement:
        achievement = Achievements(
            name=name,
            challenge_id=challenge.id,
            team_id=team_or_user.id if isinstance(team_or_user, Teams) else None,
            user_id=team_or_user.id if isinstance(team_or_user, Users) else None
        )
        db.session.add(achievement)

def get_teams_completed_challenges_in_topic(topic):
    """
    Lấy danh sách các đội đã hoàn thành challenge trong một topic
    """
    # Lấy danh sách các challenge trong topic và các đội đã làm đúng những challenge này
    challenges_in_topic = db.session.query(Challenges).filter_by(topic_id=topic.id).all()
    completed_teams = set()

    for challenge in challenges_in_topic:
        solves = db.session.query(Solves).filter_by(challenge_id=challenge.id, type="correct").all()
        for solve in solves:
            completed_teams.add(solve.team_id)

    return [team for team in db.session.query(Teams).filter(Teams.id.in_(completed_teams)).all()]

def team_completed_all_challenges_in_topic(team, topic):
    """
    Kiểm tra xem đội đã hoàn thành tất cả các challenges trong topic chưa.
    """
    challenges_in_topic = db.session.query(Challenges).filter_by(topic_id=topic.id).all()
    for challenge in challenges_in_topic:
        solve = db.session.query(Solves).filter_by(team_id=team.id, challenge_id=challenge.id, type="correct").first()
        if not solve:
            return False  # Nếu đội chưa hoàn thành challenge nào đó, trả về False
    return True  # Nếu đội hoàn thành tất cả các challenge, trả về True


def calculate_and_assign_awards():
    """
    Tính toán và gán giải thưởng, đồng thời trả về danh sách giải thưởng đã gán.
    """
    from datetime import datetime

    # Lấy danh sách các challenges
    challenges = db.session.query(Challenges).all()

    # Ví dụ tiêu chí đạt giải (có thể thay đổi theo yêu cầu)
    criteria = [
        {"name": "First Blood", "condition": lambda solves: solves[0] if solves else None},
        {"name": "Top Scorer", "condition": lambda solves: solves[-1] if solves else None},  # Last solve
    ]

    # Danh sách giải thưởng để trả về
    assigned_awards = []

    # Lặp qua từng challenge
    for challenge in challenges:
        # Lấy tất cả các bài solve cho challenge này, sắp xếp theo thời gian
        solves = (
            db.session.query(Solves)
            .filter(Solves.challenge_id == challenge.id, Solves.type == "correct")
            .order_by(Solves.date.asc())
            .all()
        )

        # Kiểm tra từng tiêu chí
        for criterion in criteria:
            achievement_solve = criterion["condition"](solves)
            if achievement_solve:
                # Nếu đạt giải, kiểm tra và tạo Achievement và AwardBadge
                existing_achievement = (
                    db.session.query(Achievements)
                    .filter(
                        Achievements.challenge_id == challenge.id,
                        Achievements.name == criterion["name"],
                        Achievements.team_id == achievement_solve.team_id,
                        Achievements.user_id == achievement_solve.user_id,
                    )
                    .first()
                )

                if not existing_achievement:
                    # Tạo AwardBadge nếu chưa có
                    award_badge = (
                        db.session.query(AwardBadges)
                        .filter(
                            AwardBadges.challenge_id == challenge.id,
                            AwardBadges.name == criterion["name"],
                        )
                        .first()
                    )
                    if not award_badge:
                        award_badge = AwardBadges(
                            name=criterion["name"],
                            challenge_id=challenge.id,
                            team_id=achievement_solve.team_id,
                            user_id=achievement_solve.user_id,
                        )
                        db.session.add(award_badge)
                        db.session.flush()  # Lấy ID ngay sau khi thêm

                    # Tạo Achievement
                    achievement = Achievements(
                        name=criterion["name"],
                        challenge_id=challenge.id,
                        team_id=achievement_solve.team_id,
                        user_id=achievement_solve.user_id,
                        achievement_id=award_badge.id,
                    )
                    db.session.add(achievement)

                    # Thêm vào danh sách trả về
                    assigned_awards.append({
                        "name": criterion["name"],
                        "description": f"Award for {criterion['name']} in {challenge.name}",
                        "team_name": achievement_solve.team.name if achievement_solve.team else None,
                        "user_name": achievement_solve.user.name if achievement_solve.user else None,
                    })

    # Lưu các thay đổi vào database
    db.session.commit()

    print("Tính toán và gán giải thưởng thành công!")
    return assigned_awards


def create_achievement_for_team_or_user(team_or_user, challenge, name):
    """
    Hàm hỗ trợ tạo thành tích cho đội hoặc người dùng.
    """
    existing_achievement = db.session.query(Achievements).filter_by(
        challenge_id=challenge.id,
        name=name,
        team_id=team_or_user.team_id if isinstance(team_or_user, Solves) else None,
        user_id=team_or_user.user_id if isinstance(team_or_user, Solves) else None
    ).first()

    if not existing_achievement:
        achievement = Achievements(
            name=name,
            challenge_id=challenge.id,
            team_id=team_or_user.team_id if isinstance(team_or_user, Solves) else None,
            user_id=team_or_user.user_id if isinstance(team_or_user, Solves) else None
        )
        db.session.add(achievement)
def get_last_submission_user(challenge_id=None, team_id=None):
    """
    Lấy dữ liệu của người nộp bài cuối cùng cho một challenge hoặc cho một đội.
    """
    query = (
        db.session.query(
            Solves.team_id.label("team_id"),
            Solves.user_id.label("user_id"),
            Solves.date.label("submission_time"),
            Teams.name.label("team_name"),
            Users.name.label("user_name"),
            Challenges.id.label("challenge_id"),
            Challenges.name.label("challenge_name"),
        )
        .join(Teams, Solves.team_id == Teams.id)
        .join(Users, Solves.user_id == Users.id)
        .join(Challenges, Solves.challenge_id == Challenges.id)
        .order_by(Solves.date.desc())  # Sắp xếp theo thời gian nộp bài mới nhất
    )

    if challenge_id is not None:
        query = query.filter(Solves.challenge_id == challenge_id)

    if team_id is not None:
        query = query.filter(Solves.team_id == team_id)

    last_submission = query.all()  # Lấy kết quả nộp bài đầu tiên, tức là bài nộp cuối cùng

    return last_submission
