from flask_socketio import emit
from random import randint
from datetime import datetime
from CTFd import socketio

characters_on_map = []


def add_character_to_map(character_data):
    try:
        global characters_on_map
        if not isinstance(characters_on_map, list):
            characters_on_map = []

        existing_char = next(
            (
                char
                for char in characters_on_map
                if char["id"] == character_data.get("id")
            ),
            None,
        )

        if existing_char:
            return {"status": "error", "message": "Character already exists"}

        data = {
            "id": character_data.get("id"),
            "name": character_data.get("name"),
            "team": character_data.get("team", "No team"),
            "x": character_data.get("position", {}).get("x", randint(-300, 300)),
            "y": character_data.get("position", {}).get("y", randint(-200, 200)),
            "animation": character_data.get("animation", "idle"),
            "time": datetime.now().strftime("%H:%M:%S"),
            "date": datetime.now().strftime("%Y-%m-%d"),
            "last_active": datetime.now().isoformat(),
        }

        characters_on_map.append(data)
        emit(
            "add-character-to-map",
            data,
            broadcast=True,
            namespace="/",
        )
        emit(
            "all-characters",
            {"characters": characters_on_map},
            broadcast=True,
            namespace="/",
        )
        emit(
            "user-login-notification",
            {
                "name": data["name"],
                "team": data["team"],
                "time": data["time"],
                "date": data["date"],
            },
            broadcast=True,
            namespace="/",
        )

        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def remove_character_from_map(user_id):
    try:
        emit(
            "remove-character-from-map",
            {"id": user_id},
            broadcast=True,
            namespace="/"
        )
    except Exception as e:
        return {"status": "error", "message": str(e)}


@socketio.on("update-character-position")
def handle_position_update(data):
    try:
        user_id = data.get("userId")
        new_position = data.get("position")
        animation = data.get("animation")

        if not user_id or not new_position:
            return {"status": "error", "message": "Missing user ID or position"}

        return update_character_position(user_id, new_position, animation)
    except Exception as e:
        return {"status": "error", "message": str(e)}


def update_character_position(user_id, new_position, animation=None):
    try:
        global characters_on_map
        character = next(
            (char for char in characters_on_map if char["id"] == user_id), None
        )

        if character:
            update_data = {
                "x": new_position.get("x", character["x"]),
                "y": new_position.get("y", character["y"]),
                "last_active": datetime.now().isoformat(),
            }

            if animation:
                update_data["animation"] = animation

            character.update(update_data)

            emit(
                "update-character-position",
                {
                    "id": user_id,
                    "position": {"x": character["x"], "y": character["y"]},
                    "animation": animation,
                },
                broadcast=True,
                namespace="/",
            )
            return {"status": "success"}
        return {"status": "not_found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@socketio.on("request-all-characters")
def handle_request_all_characters():
    try:
        emit(
            "all-characters",
            {"characters": characters_on_map},
            broadcast=True,
            namespace="/",
        )
    except Exception as e:
        print(f"Error sending all characters: {str(e)}")

def send_challenge_positions_to_clients(positions):
    try:
        emit(
            "update-challenge-positions",
            {"positions": positions},
            broadcast=True,
            namespace="/",
        )
    except Exception as e:
        print(f"Error sending challenge positions to clients: {e}")