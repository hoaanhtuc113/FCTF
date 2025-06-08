from curses import flash
import hashlib
import os
import time
import requests
from flask import (
    abort,
    current_app,
    jsonify,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
    redirect,
    Blueprint
)
from werkzeug.utils import secure_filename

from CTFd.admin import admin
from CTFd.models import Challenges, DeployedChallenge, Flags, Solves, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class, BaseChallenge
from CTFd.schemas.tags import TagSchema
from CTFd.utils.decorators import (
    admin_or_challenge_writer_only,
    admins_only,
    admin_or_challenge_writer_only_or_jury,
    is_challenge_writer,
    is_jury
)
from CTFd.utils.security.signing import serialize
from CTFd.utils.user import get_current_team, get_current_user, is_admin,is_jury
from CTFd.utils.uploads import upload_file
from CTFd.constants.envvars import API_URL_CONTROLSERVER, PRIVATE_KEY
from CTFd.plugins import bypass_csrf_protection
# Cấu hình các định dạng file được phép upload
ALLOWED_EXTENSIONS = {"zip"}  # Thay đổi theo nhu cầu

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@admin.route("/admin/challenge_template", methods=["GET", "POST"])
@bypass_csrf_protection
@admin_or_challenge_writer_only
def challenge_template():
    try:
        template_dir = "/var/template_challenge"
        
        # Ensure the template_challenge directory exists
        if not os.path.exists(template_dir):
            os.makedirs(template_dir)
            
        message_list = []

        # Xử lý upload file
        if request.method == "POST":
            if not is_admin():
                message_list.append("No file path")

            
            if "file" not in request.files:
                message_list.append("No file path")

            
            file = request.files["file"]

            if file.filename == "":
                message_list.append("No selected file")


            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)  # Đảm bảo tên file an toàn
                file.save(os.path.join(template_dir, filename))
                message_list.append("File uploaded successfully!")

            else:
                message_list.append("File type not allowed!. File .zip only")
    except Exception as ex:
        message_list.append("Exception when uploading file")

    # Hiển thị danh sách file
    try:
        template_files = os.listdir(template_dir)
        template_files = [file for file in template_files if os.path.isfile(os.path.join(template_dir, file))]
    except FileNotFoundError:
        template_files = []
    except Exception as ex:
        message_list.append("Exception when loading file")

    return render_template(
        "admin/challengeTemplate/list_template.html",
        template_files=template_files,
        messages = message_list
    )
    
@admin.route("/admin/challenges/download/<filename>")
@admin_or_challenge_writer_only_or_jury
def download_template(filename):
    template_dir = "/var/template_challenge"
    file_path = os.path.join(template_dir, filename)
    if not os.path.exists(file_path):
        abort(404, description=f"File '{filename}' not found.")

    return send_from_directory(template_dir, filename, as_attachment=True)


