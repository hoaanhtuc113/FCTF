import hashlib
import os
import time
import requests
import json
from flask import (
    abort,
    flash,
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
from CTFd.models import Challenges, DeployedChallenge, ChallengeVersion, Flags, Solves, Users, Tags, ChallengeBank, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class, BaseChallenge
from CTFd.schemas.tags import TagSchema
from CTFd.utils.decorators import (
    admin_or_challenge_writer_only,
    admins_only,
    admin_or_challenge_writer_only_or_jury,
    is_challenge_writer,
    is_jury
)
from CTFd.utils.dates import ctftime
from CTFd.utils.security.signing import serialize
from CTFd.utils.user import get_current_team, get_current_user, is_admin,is_jury
from CTFd.utils.uploads import upload_file
from CTFd.constants.envvars import DEPLOYMENT_SERVICE_API, PRIVATE_KEY
from CTFd.plugins import bypass_csrf_protection
from CTFd.constants import status_challenge



@admin.route("/admin/challenges")
@admin_or_challenge_writer_only_or_jury
def challenges_listing():
    q = request.args.get("q")
    field = request.args.get("field") or "name"
    category = request.args.get("category")
    type_ = request.args.get("type")
    difficulty = request.args.get("difficulty")
    state_filter = request.args.get("state")
    has_prereq = request.args.get("has_prereq")
    page = abs(request.args.get("page", 1, type=int))
    filters = []

    # Add filter based on search query
    tag_terms = []

    # Separate tags parameter (comma-separated) - this is intentionally distinct from generic `q` search
    tags_q = request.args.get("tags")
    if tags_q:
        tag_terms = [t.strip() for t in tags_q.split(",") if t.strip()]
        for term in tag_terms:
            # Require that the tag value exactly matches the term (case-insensitive)
            exists_filter = (
                db.session.query(Tags.id)
                .filter(
                    Tags.challenge_id == Challenges.id,
                    db.func.lower(Tags.value) == term.lower(),
                )
                .exists()
            )
            filters.append(exists_filter)

    if q:
        # Generic field search (name, id, category, type)
        if Challenges.__mapper__.has_property(field):
            filters.append(getattr(Challenges, field).like(f"%{q}%"))

    if category:
        filters.append(Challenges.category == category)

    if type_:
        filters.append(Challenges.type == type_)

    if difficulty:
        filters.append(Challenges.difficulty == int(difficulty))

    if state_filter:
        filters.append(Challenges.state == state_filter)

    if has_prereq == "yes":
        # requirements is a JSON column like {"prerequisites": [1, 2, ...]}
        # Filter for challenges that have non-null, non-empty requirements
        filters.append(Challenges.requirements.isnot(None))
    elif has_prereq == "no":
        filters.append(Challenges.requirements.is_(None))

    # Modify query based on user role
    if is_admin() or is_jury():
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
    elif is_challenge_writer():
        # Filter by the challenge writer associated with the current session
        writer_id = session["id"]  # Assuming the session stores the user ID
        filters.append(Challenges.user_id == writer_id)
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
    else:
        # Default fallback - show all challenges
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
        
    # Fetch the results with pagination
    challenges = query.paginate(page=page, per_page=50, error_out=False)
    raw_categories = (
        Challenges.query.with_entities(Challenges.category).distinct().all()
    )
    raw_types = Challenges.query.with_entities(Challenges.type).distinct().all()

    categories = [c[0] for c in raw_categories if c and c[0]]
    types = [t[0] for t in raw_types if t and t[0]]
    # Add creator names to challenges
    for c in challenges.items:
        user = Users.query.filter_by(id=c.user_id).first()
        if user:
            c.creator = user.name
        else:
            c.creator = "Unknown"
    
    args = dict(request.args)
    args.pop("page", 1)
        
    return render_template(
        "admin/challenges/challenges.html",
        challenges=challenges,
        prev_page=url_for(request.endpoint, page=challenges.prev_num, **args),
        next_page=url_for(request.endpoint, page=challenges.next_num, **args),
        q=q,
        field=field,
        category=category,
        type=type_,
        difficulty=difficulty,
        state_filter=state_filter,
        has_prereq=has_prereq,
        categories=categories,
        types=types,
        tag_terms=tag_terms,
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
    deploys = DeployedChallenge.query.filter_by(challenge_id=challenge.id).order_by(DeployedChallenge.id.desc()).all()
    isDeploySuccess = False
    if deploys:
        last_deploy = deploys[0]
        if last_deploy and last_deploy.deploy_status == "DEPLOY_SUCCESS":
            isDeploySuccess = True

    expose_port = ""
    image_link_name = ""
    image_link_display = ""
    if challenge.image_link:
        object_image = json.loads(challenge.image_link)
        expose_port = object_image.get("exposedPort", "")
        image_link_name = object_image.get("imageLink", "")
        if image_link_name:
            image_link_display = image_link_name

    try:
        challenge_class = get_chal_class(challenge.type)
    except KeyError:
        abort(
            500,
            f"The underlying challenge type ({challenge.type}) is not installed. This challenge cannot be loaded.",
        )

    is_detail = True   # check if this is detail page
    
    ctf_is_active = ctftime()

    update_j2 = render_template(
        challenge_class.templates["update"].lstrip("/"), 
        challenge=challenge,
        ctf_is_active=ctf_is_active
    )

    update_script = url_for(
        "views.static_html", route=challenge_class.scripts["update"].lstrip("/")
    )

    versions = (
        ChallengeVersion.query
        .filter_by(challenge_id=challenge.id)
        .order_by(ChallengeVersion.version_number.desc())
        .all()
    )

    return render_template(
        "admin/challenges/challenge.html",
        update_template=update_j2,
        update_script=update_script,
        challenge=challenge,
        expose_port=expose_port,
        image_link_name=image_link_name,
        image_link_display=image_link_display,
        challenges=challenges,
        solves=solves,
        flags=flags,
        deploys=len(deploys),
        isDeploySuccess=isDeploySuccess,
        is_detail=is_detail,
        ctf_is_active=ctf_is_active,
        versions=versions,
    )


@admin.route("/admin/challenges/preview/<int:challenge_id>")
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
    types = CHALLENGE_CLASSES.keys()
    return render_template("admin/challenges/new.html", types=types)


@admin.route("/admin/challenges/<int:challenge_id>/versions/<int:version_id>")
@admin_or_challenge_writer_only_or_jury
def challenges_version_detail(challenge_id, version_id):
    challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()
    version = ChallengeVersion.query.filter_by(
        id=version_id, challenge_id=challenge.id
    ).first_or_404()
    return render_template(
        "admin/challenges/version_detail.html",
        challenge=challenge,
        version=version,
    )



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


@admin.route("/api/challenge/start", methods=["POST"])
@admin_or_challenge_writer_only
def challenge_start():
    try:
        data = request.get_json(force=True, silent=True) or {}
        challenge_id = data.get("challenge_id")
        team_id_raw = data.get("team_id", data.get("teamId", -1))
        if not challenge_id:
            return jsonify({"success": False, "message": "challenge_id is required"}), 400
        challenge_id = int(challenge_id)
        try:
            team_id = int(team_id_raw)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "team_id must be an integer"}), 400

        private_key = PRIVATE_KEY
        if not private_key:
            return jsonify({"success": False, "message": "Server PRIVATE_KEY is not configured"}), 500

        from CTFd.utils.user import get_current_user
        current_user = get_current_user()
        user_id = current_user.id if current_user else -1

        unix_time = str(int(time.time()))
        challenge = Challenges.query.filter_by(id=challenge_id).first_or_404()

        # Use camelCase keys matching the Deployment Service API contract
        secret_key = create_secret_key(
            private_key,
            unix_time,
            {
                "challengeId": challenge_id,
                "teamId": team_id,
                "userId": user_id,
            },
        )
        payload = {
            "challengeId": challenge_id,
            "teamId": team_id,
            "userId": user_id,
            "unixTime": unix_time,
        }
        headers = {"SecretKey": secret_key}
        api_start = f"{DEPLOYMENT_SERVICE_API}/api/challenge/start"

        response = requests.post(api_start, headers=headers, json=payload, timeout=30)
        response.raise_for_status()

        res_data = response.json()
        if res_data.get("success"):
            return jsonify({
                "success": True,
                "message": res_data.get("message", "Challenge started"),
                "challenge_url": res_data.get("challenge_url"),
            }), 200
        else:
            return jsonify({
                "success": False,
                "message": res_data.get("message", "Failed to preview challenge"),
            }), 200

    except requests.exceptions.ConnectionError:
        return jsonify({"success": False, "message": f"Cannot connect to deployment service at {DEPLOYMENT_SERVICE_API}"}), 502
    except requests.exceptions.Timeout:
        return jsonify({"success": False, "message": "Control server request timed out"}), 504
    except requests.exceptions.HTTPError as e:
        return jsonify({"success": False, "message": f"Control server returned error: {e.response.status_code}"}), 502
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Internal error: {str(e)}"}), 500


# ═══════════════════════════════════════════════════════════════════════════════
# CHALLENGE BANK — routes quản lý kho challenge (chỉ build image, không deploy pod)
# ═══════════════════════════════════════════════════════════════════════════════


@admin.route("/admin/challenge-bank")
@admins_only
def challenge_bank_listing():
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "")
    difficulty = request.args.get("difficulty", "")
    require_deploy = request.args.get("require_deploy", "")
    page = abs(request.args.get("page", 1, type=int))

    query = ChallengeBank.query

    if q:
        query = query.filter(
            db.or_(
                ChallengeBank.name.ilike(f"%{q}%"),
                ChallengeBank.category.ilike(f"%{q}%"),
            )
        )
    if category:
        query = query.filter(ChallengeBank.category == category)
    if difficulty:
        query = query.filter(ChallengeBank.difficulty == int(difficulty))
    if require_deploy != "":
        query = query.filter(ChallengeBank.require_deploy == (require_deploy == "1"))

    # JSON mode — dùng cho modal "Thêm từ Bank" trong contest/challenges
    if request.args.get("format") == "json":
        items = query.order_by(ChallengeBank.created.desc()).all()
        return jsonify({
            "success": True,
            "challenges": [
                {
                    "id": c.id,
                    "name": c.name,
                    "category": c.category or "",
                    "difficulty_label": c.difficulty_label(),
                    "value": c.value or 0,
                    "require_deploy": c.require_deploy,
                    "tags": c.tags_list(),
                }
                for c in items
            ],
        })

    pagination = query.order_by(ChallengeBank.created.desc()).paginate(
        page=page, per_page=50
    )

    # Lấy danh sách category để filter
    categories = [
        r[0]
        for r in db.session.query(ChallengeBank.category)
        .filter(ChallengeBank.category.isnot(None))
        .distinct()
        .order_by(ChallengeBank.category)
        .all()
    ]

    return render_template(
        "admin/challenge_bank/listing.html",
        challenges=pagination.items,
        pagination=pagination,
        categories=categories,
        q=q,
        category=category,
        difficulty=difficulty,
        require_deploy=require_deploy,
    )


@admin.route("/admin/challenge-bank/new", methods=["GET", "POST"])
@admins_only
def challenge_bank_new():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Tên challenge không được trống.", "danger")
            return redirect(url_for("admin.challenge_bank_new"))

        from CTFd.utils.user import get_current_user
        owner = get_current_user()

        bc = ChallengeBank(
            name=name,
            description=request.form.get("description", "").strip() or None,
            category=request.form.get("category", "").strip() or None,
            difficulty=request.form.get("difficulty", type=int) or None,
            value=request.form.get("value", 100, type=int),
            time_limit=request.form.get("time_limit", 30, type=int),
            max_attempts=request.form.get("max_attempts", 0, type=int),
            cooldown=request.form.get("cooldown", 0, type=int),
            flag=request.form.get("flag", "").strip() or None,
            flag_data=request.form.get("flag_data", "").strip() or "",
            require_deploy=request.form.get("require_deploy") == "1",
            expose_port=request.form.get("expose_port", "").strip() or None,
            connection_protocol=request.form.get("connection_protocol", "http"),
            cpu_limit=request.form.get("cpu_limit", type=int) or None,
            cpu_request=request.form.get("cpu_request", type=int) or None,
            memory_limit=request.form.get("memory_limit", type=int) or None,
            memory_request=request.form.get("memory_request", type=int) or None,
            use_gvisor=request.form.get("use_gvisor") == "1",
            harden_container=request.form.get("harden_container") == "1",
            shared_instant=request.form.get("shared_instant") == "1",
            max_deploy_count=request.form.get("max_deploy_count", 0, type=int),
            tags=request.form.get("tags", "").strip() or None,
            created_by=owner.id if owner else None,
        )

        # Upload deploy file (docker-compose / yaml)
        deploy_file = request.files.get("deploy_file")
        if deploy_file and deploy_file.filename:
            from CTFd.utils.uploads import upload_file as _upload
            result = _upload(file=deploy_file, location="challenge_bank")
            if result:
                bc.deploy_file = result

        db.session.add(bc)
        db.session.commit()
        flash(f"Đã tạo challenge '{bc.name}' vào bank.", "success")
        return redirect(url_for("admin.challenge_bank_listing"))

    return render_template("admin/challenge_bank/new.html")


@admin.route("/admin/challenge-bank/<int:bank_id>", methods=["GET"])
@admins_only
def challenge_bank_detail(bank_id):
    bc = ChallengeBank.query.get_or_404(bank_id)
    return render_template("admin/challenge_bank/detail.html", challenge=bc)


@admin.route("/admin/challenge-bank/<int:bank_id>/edit", methods=["GET", "POST"])
@admins_only
def challenge_bank_edit(bank_id):
    bc = ChallengeBank.query.get_or_404(bank_id)

    if request.method == "POST":
        bc.name = request.form.get("name", bc.name).strip()
        bc.description = request.form.get("description", "").strip() or None
        bc.category = request.form.get("category", "").strip() or None
        bc.difficulty = request.form.get("difficulty", type=int) or None
        bc.value = request.form.get("value", bc.value, type=int)
        bc.time_limit = request.form.get("time_limit", bc.time_limit, type=int)
        bc.max_attempts = request.form.get("max_attempts", bc.max_attempts, type=int)
        bc.cooldown = request.form.get("cooldown", bc.cooldown, type=int)
        bc.flag = request.form.get("flag", "").strip() or None
        bc.flag_data = request.form.get("flag_data", "").strip() or ""
        bc.require_deploy = request.form.get("require_deploy") == "1"
        bc.expose_port = request.form.get("expose_port", "").strip() or None
        bc.connection_protocol = request.form.get("connection_protocol", "http")
        bc.cpu_limit = request.form.get("cpu_limit", type=int) or None
        bc.cpu_request = request.form.get("cpu_request", type=int) or None
        bc.memory_limit = request.form.get("memory_limit", type=int) or None
        bc.memory_request = request.form.get("memory_request", type=int) or None
        bc.use_gvisor = request.form.get("use_gvisor") == "1"
        bc.harden_container = request.form.get("harden_container") == "1"
        bc.shared_instant = request.form.get("shared_instant") == "1"
        bc.max_deploy_count = request.form.get("max_deploy_count", bc.max_deploy_count, type=int)
        bc.tags = request.form.get("tags", "").strip() or None

        deploy_file = request.files.get("deploy_file")
        if deploy_file and deploy_file.filename:
            from CTFd.utils.uploads import upload_file as _upload
            result = _upload(file=deploy_file, location="challenge_bank")
            if result:
                bc.deploy_file = result

        db.session.commit()
        flash(f"Đã cập nhật challenge '{bc.name}'.", "success")
        return redirect(url_for("admin.challenge_bank_listing"))

    return render_template("admin/challenge_bank/edit.html", challenge=bc)


@admin.route("/admin/challenge-bank/<int:bank_id>/delete", methods=["POST"])
@admins_only
def challenge_bank_delete(bank_id):
    bc = ChallengeBank.query.get_or_404(bank_id)
    name = bc.name
    db.session.delete(bc)
    db.session.commit()
    flash(f"Đã xoá challenge '{name}' khỏi bank.", "success")
    return redirect(url_for("admin.challenge_bank_listing"))