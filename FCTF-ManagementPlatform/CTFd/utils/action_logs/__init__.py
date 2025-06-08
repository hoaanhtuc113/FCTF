from flask_socketio import emit
from CTFd.models import (
    Challenges,
)


def send_action_logs_to_client(logs):
    try:
        data = {"type": "action_logs", "logs": logs}
        emit("action_logs", data, broadcast=True, namespace="/")
    except Exception as e:
        print(f"Error sending action logs to client: {e}")


def send_challenge_selected_event(
    user_id, topic_name, challenge_id, challenge_name, action_type, action_date
):
    try:
        if not user_id or not topic_name or not challenge_id or not action_date:
            raise ValueError("Invalid parameters for challenge-selected event")

        challenge = Challenges.query.filter_by(id=challenge_id).first()
        challenge_name = challenge.name if challenge else "Unknown"

        log_entry = {
            "userId": user_id,
            "topicName": topic_name,
            "challengeId": challenge_id,
            "challengeName": challenge_name,
            "actionType": action_type,
            "actionDate": action_date,
        }

        print("Sending challenge-selected event:", log_entry)
        emit("challenge-selected", [log_entry], broadcast=True, namespace="/")
    except Exception as e:
        print(f"Error sending challenge-selected event: {e}")


def get_topic_name(challenge_id):
    if not challenge_id:
        return "Null"
    challenge = Challenges.query.filter_by(id=challenge_id).first()
    return challenge.category if challenge else "Null"
