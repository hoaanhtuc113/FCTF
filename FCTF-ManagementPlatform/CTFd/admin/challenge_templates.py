import json

from flask import flash, redirect, render_template, request, url_for

from CTFd.admin import admin
from CTFd.models import Challenges, ChallengeVersion, DeployedChallenge, Users, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.utils.decorators import admin_or_challenge_writer_only, admin_or_challenge_writer_only_or_jury
from CTFd.utils.uploads import upload_file
from CTFd.utils.user import is_admin, is_challenge_writer, is_jury
from flask import session


@admin.route("/admin/challenge-templates")
@admin_or_challenge_writer_only_or_jury
def challenge_templates_listing():
    q = request.args.get("q")
    field = request.args.get("field") or "name"
    category = request.args.get("category")
    type_ = request.args.get("type")
    difficulty = request.args.get("difficulty")
    page = abs(request.args.get("page", 1, type=int))
    filters = []

    if q and Challenges.__mapper__.has_property(field):
        filters.append(getattr(Challenges, field).like(f"%{q}%"))
    if category:
        filters.append(Challenges.category == category)
    if type_:
        filters.append(Challenges.type == type_)
    if difficulty:
        try:
            filters.append(Challenges.difficulty == int(difficulty))
        except (TypeError, ValueError):
            pass

    if is_admin() or is_jury():
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
    elif is_challenge_writer():
        writer_id = session["id"]
        filters.append(Challenges.created_by == writer_id)
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())
    else:
        query = Challenges.query.filter(*filters).order_by(Challenges.id.asc())

    templates = query.paginate(page=page, per_page=50, error_out=False)

    raw_categories = Challenges.query.with_entities(Challenges.category).distinct().all()
    raw_types = Challenges.query.with_entities(Challenges.type).distinct().all()
    categories = [c[0] for c in raw_categories if c and c[0]]
    types = [t[0] for t in raw_types if t and t[0]]

    for c in templates.items:
        u = Users.query.filter_by(id=c.created_by).first() if c.created_by else None
        c.creator = u.name if u else "Unknown"

    args = dict(request.args)
    args.pop("page", None)

    return render_template(
        "admin/challenge_templates/challenge_templates.html",
        templates=templates,
        prev_page=url_for(request.endpoint, page=templates.prev_num, **args),
        next_page=url_for(request.endpoint, page=templates.next_num, **args),
        q=q,
        field=field,
        category=category,
        type=type_,
        difficulty=difficulty,
        categories=categories,
        types=types,
    )


@admin.route("/admin/challenge-templates/new")
@admin_or_challenge_writer_only
def challenge_templates_new():
    types = CHALLENGE_CLASSES.keys()
    return render_template("admin/challenge_templates/new.html", types=types)


@admin.route("/admin/challenge-templates/<int:template_id>")
@admin_or_challenge_writer_only_or_jury
def challenge_templates_detail(template_id):
    challenge = Challenges.query.filter_by(id=template_id).first_or_404()

    deploys = (
        DeployedChallenge.query.filter_by(challenge_template_id=template_id)
        .order_by(DeployedChallenge.id.desc())
        .all()
    )
    is_deploy_success = bool(
        deploys and deploys[0].deploy_status == "DEPLOY_SUCCESS"
    )

    expose_port = ""
    image_link_name = ""
    if challenge.image_link:
        try:
            obj = json.loads(challenge.image_link)
            expose_port = obj.get("exposedPort", "")
            image_link_name = obj.get("imageLink", "")
        except (json.JSONDecodeError, AttributeError):
            pass

    try:
        challenge_class = get_chal_class(challenge.type)
    except KeyError:
        from flask import abort
        abort(500, f"Challenge type '{challenge.type}' is not installed.")

    update_j2 = render_template(
        challenge_class.templates["update"].lstrip("/"),
        challenge=challenge,
        ctf_is_active=False,
    )
    update_script = url_for(
        "views.static_html", route=challenge_class.scripts["update"].lstrip("/")
    )

    versions = (
        ChallengeVersion.query.filter_by(challenge_template_id=template_id)
        .order_by(ChallengeVersion.version_number.desc())
        .all()
    )

    return render_template(
        "admin/challenge_templates/challenge_template.html",
        challenge=challenge,
        update_template=update_j2,
        update_script=update_script,
        expose_port=expose_port,
        image_link_name=image_link_name,
        deploys=len(deploys),
        is_deploy_success=is_deploy_success,
        versions=versions,
    )


@admin.route("/admin/challenge-templates/<int:template_id>/versions/<int:version_id>")
@admin_or_challenge_writer_only_or_jury
def challenge_templates_version_detail(template_id, version_id):
    challenge = Challenges.query.filter_by(id=template_id).first_or_404()
    version = ChallengeVersion.query.filter_by(
        id=version_id, challenge_template_id=template_id
    ).first_or_404()
    return render_template(
        "admin/challenge_templates/version_detail.html",
        challenge=challenge,
        version=version,
    )


@admin.route("/admin/challenge-templates/<int:template_id>/upload", methods=["POST"])
@admin_or_challenge_writer_only
def challenge_templates_upload(template_id):
    """Handle challenge template file upload (deploy zip or regular files)."""
    challenge = Challenges.query.filter_by(id=template_id).first_or_404()
    require_deploy = request.form.get("require_deploy") == "true"
    challenge.require_deploy = require_deploy

    if require_deploy:
        expose_port = request.form.get("expose_port")
        files = request.files.getlist("file")
        for f in files:
            try:
                import tempfile, os
                from CTFd.utils.connector.multiservice_connector import handle_challenge_upload

                suffix = os.path.splitext(f.filename)[1]
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    f.save(tmp.name)
                    result, status_code = handle_challenge_upload(challenge, tmp.name, expose_port)
                os.unlink(tmp.name)

                if not result.get("success"):
                    flash(result.get("error", "Upload failed"), "danger")
                    return redirect(
                        url_for("admin.challenge_templates_detail", template_id=template_id)
                    )
            except Exception as e:
                flash(f"Error during file upload: {e}", "danger")
                return redirect(
                    url_for("admin.challenge_templates_detail", template_id=template_id)
                )
    else:
        files = request.files.getlist("file")
        for f in files:
            try:
                upload_file(file=f, challenge_id=template_id, type="challenge")
            except Exception as e:
                flash(f"Error saving file: {e}", "danger")
                return redirect(
                    url_for("admin.challenge_templates_detail", template_id=template_id)
                )
        db.session.commit()

    flash("Template updated successfully!", "success")
    return redirect(url_for("admin.challenge_templates_detail", template_id=template_id))
