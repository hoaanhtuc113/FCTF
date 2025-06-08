from flask import Blueprint, request, jsonify
from flask_socketio import emit

# Hàm gửi thông báo với exception handling
def notify_to_contestant(notif_type="alert", notif_sound=True,notif_title="Notify from management", notif_message="Hello from management"):
    try:
        data = {
            "notif_type": notif_type,
            "notif_sound": notif_sound,
            "notif_title": notif_title,
            "notif_message": notif_message
            
        }
        emit("notify", data, broadcast=True, namespace="/")
        return {"status": "success", "data": data}
    
    except Exception as e:
        return {"status": "error", "message": str(e)}

