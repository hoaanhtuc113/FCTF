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


@admin.route("/admin/challenges")
@admin_or_challenge_writer_only_or_jury
def challenges_listing():
    q = request.args.get("q")
    field = request.args.get("field")
    filters = []

    # Add filter based on search query
    if q:
        # Check if the field exists as an exposed column
        if Challenges.__mapper__.has_property(field):
            filters.append(getattr(Challenges, field).like(f"%{q}%"))

    # Modify query based on user role
    if is_admin() or is_jury():
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
    elif is_challenge_writer():
        # Filter by the challenge writer associated with the current session
        writer_id = session["id"]  # Assuming the session stores the user ID
        filters.append(Challenges.user_id == writer_id)
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())

    # Fetch the results
    challenges = query.all()
    total = query.count()

    return render_template(
        "admin/challenges/challenges.html",
        challenges=challenges,
        total=total,
        q=q,
        field=field,
    )




@admin.route("/admin/challenges/<int:challenge_id>")
@admin_or_challenge_writer_only_or_jury
def challenges_detail(challenge_id):
    challenges = db.session.query(
        Challenges.id, Challenges.name, Challenges.description
    ).all()

    challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
    solves = (
        Solves.query.filter_by(challenge_id=challenge.id)
        .order_by(Solves.date.asc())
        .all()
    )
    flags = Flags.query.filter_by(challenge_id=challenge.id).all()
    deploys = DeployedChallenge.query.filter_by(challenge_id=challenge.id).all()

    try:
        challenge_class = get_chal_class(challenge.type)
    except KeyError:
        abort(
            500,
            f"The underlying challenge type ({challenge.type}) is not installed. This challenge cannot be loaded.",
        )

    update_j2 = render_template(
        challenge_class.templates["update"].lstrip("/"), challenge=challenge
    )

    update_script = url_for(
        "views.static_html", route=challenge_class.scripts["update"].lstrip("/")
    )

    is_detail = True   # check if this is detail page

    return render_template(
        "admin/challenges/challenge.html",
        update_template=update_j2,
        update_script=update_script,
        challenge=challenge,
        challenges=challenges,
        solves=solves,
        flags=flags,
        deploys=len(deploys),
        is_detail=is_detail
    )


@admin.route("/api/challenges/preview/<int:challenge_id>")
@admin_or_challenge_writer_only_or_jury
def challenges_preview(challenge_id):
    challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
    chal_class = get_chal_class(challenge.type)
    user = get_current_user()
    team = get_current_team()

    files = []
    for f in challenge.files:
        token = {
            "user_id": user.id,
            "team_id": team.id if team else None,
            "file_id": f.id,
        }
        files.append(url_for("views.files", path=f.location, token=serialize(token)))

    tags = [
        tag["value"] for tag in TagSchema("user", many=True).dump(challenge.tags).data
    ]

    content = render_template(
        chal_class.templates["view"].lstrip("/"),
        solves=None,
        solved_by_me=False,
        files=files,
        tags=tags,
        hints=challenge.hints,
        max_attempts=challenge.max_attempts,
        attempts=0,
        challenge=challenge,
    )
    return render_template(
        "admin/challenges/preview.html", content=content, challenge=challenge
    )


@admin.route("/admin/challenges/new")
@admin_or_challenge_writer_only
def challenges_new():
    template_dir = os.path.join(current_app.root_path, "template_challenge")
    try:
        template_files = os.listdir(template_dir) 
        template_files = [file for file in template_files if os.path.isfile(os.path.join(template_dir, file))]
    except FileNotFoundError:
        template_files = []
    types = CHALLENGE_CLASSES.keys()

    return render_template("admin/challenges/new.html", types=types, template_files=template_files)

@admin.route("/admin/challenges/update")
@admin_or_challenge_writer_only
def challenges_teamplate():
    template_dir = os.path.join(current_app.root_path, "template_challenge")
    try:
        print("đã vao day")
        template_files = os.listdir(template_dir) 
        template_files = [file for file in template_files if os.path.isfile(os.path.join(template_dir, file))]
    except FileNotFoundError:
        template_files = []
    types = CHALLENGE_CLASSES.keys()

    return render_template("admin/deploy.html", types=types, template_files=template_files)



@admin.route("/admin/challenges/<int:challenge_id>/upload", methods=["POST"])
@admin_or_challenge_writer_only
def submit_upload_file(challenge_id):
    challenge = Challenges.query.get(challenge_id)

    require_deploy = request.form.get("require_deploy") == "true"
    challenge.require_deploy = require_deploy

    if require_deploy:
        files = request.files.getlist("file")
        for file in files:
            try:
                control_server_url = "http://127.0.0.1:5103/api/Challenge/upload"
                file_data = {"file": (file.filename, file.stream, file.content_type)}
                response = requests.post(control_server_url, files=file_data)
                if response.status_code != 200:
                    flash("Failed to deploy challenge.", "danger")
                    return redirect(
                        url_for("admin.challenges_detail", challenge_id=challenge.id)
                    )
            except Exception as e:
                flash("Error during file upload.", "danger")
                return redirect(
                    url_for("admin.challenges_detail", challenge_id=challenge.id)
                )

    else:
        for file in files:
            try:
                upload_file(file=file, challenge_id=challenge.id, type="challenge")
            except Exception as e:
                flash("Error saving file.", "danger")
                return redirect(
                    url_for("admin.challenges_detail", challenge_id=challenge.id)
                )
    db.session.commit()
    flash("Challenge deployment updated successfully!", "success")
    return redirect(url_for("admin.challenges_detail", challenge_id=challenge.id))


def create_secret_key(
    private_key: str, unix_time: int, data: dict, default_value: str = "1"
) -> str:
    sorted_key = sorted(data.keys())
    combine_string = str(unix_time) + private_key
    for key in sorted_key:
        combine_string += str(data.get(key, default_value))
    return hashlib.md5(combine_string.encode()).hexdigest()


@admin.route("/api/challenge/preview/<int:challenge_id>")
@bypass_csrf_protection
@admin_or_challenge_writer_only
def challenge_preview(challenge_id):
    unix_time = str(int(time.time()))
    private_key = PRIVATE_KEY
    challenge = Challenges.query.filter_by(
        id=challenge_id
    ).first_or_404()  # Corrected here
    secret_key = create_secret_key(
        private_key,
        unix_time,
        {
            "ChallengeId": challenge_id,
            "TeamId": -1,
            "ImageLink": challenge.image_link,
        },  # Corrected here
    )
    print(secret_key)
    payload = {
        "ChallengeId": challenge_id,
        "UnixTime": unix_time,
        "TeamId": -1,
        "ImageLink": challenge.image_link,  # Corrected here
    }
    headers = {"Secretkey": secret_key}
    api_start = f"{API_URL_CONTROLSERVER}/api/challenge/start"

    try:
        response = requests.post(api_start, data=payload, headers=headers)
        print(response)
        response.raise_for_status()

        res_data = response.json()
        if res_data.get("success"):
            return (
                jsonify(
                    {"success": True, "challenge_url": res_data.get("challenge_url")}
                ),
                200,
            )
        else:
            return (
                jsonify({"Message": "Failed to preview challenge"}),
                500,
            )  # Fixed typo in message

    except requests.exceptions.RequestException:
        return jsonify({"Message": "Connection failed"}), 500
