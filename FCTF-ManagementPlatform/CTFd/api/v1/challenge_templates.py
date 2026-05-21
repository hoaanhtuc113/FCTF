import json
from datetime import datetime
from flask import request, session
from flask_restx import Namespace, Resource

from CTFd.models import (
    ChallengeFiles as ChallengeFilesModel,
    ChallengeVersion,
    Challenges,
    ChallengeTopics as ChallengeTopicsModel,
    DeployedChallenge,
    Flags,
    Hints,
    Tags,
    Users,
    db,
)
from CTFd.plugins.challenges import CHALLENGE_CLASSES, get_chal_class
from CTFd.schemas.challenge_templates import ChallengeTemplateSchema
from CTFd.schemas.flags import FlagSchema
from CTFd.schemas.hints import HintSchema
from CTFd.schemas.tags import TagSchema
from CTFd.utils.decorators import admin_or_challenge_writer_only, admin_or_challenge_writer_only_or_jury
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.uploads import delete_folder
from CTFd.utils.connector.multiservice_connector import delete_cached_files


challenge_templates_namespace = Namespace(
    "challenge_templates",
    description="Endpoints to manage Challenge Templates (the shared challenge bank)",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEMPLATE_FIELDS = frozenset({
    "name", "description", "category", "type", "difficulty",
    "require_deploy", "connection_info", "connection_protocol",
    "cpu_limit", "cpu_request", "memory_limit", "memory_request",
    "use_gvisor", "harden_container", "shared_instant",
})


def _coerce_template_data(data: dict) -> dict:
    """Normalise raw request data to types expected by the model."""
    out = {}
    for k, v in data.items():
        if k not in _TEMPLATE_FIELDS:
            continue
        out[k] = v

    for int_field in ("cpu_limit", "cpu_request", "memory_limit", "memory_request"):
        if int_field in out and out[int_field] is not None:
            try:
                out[int_field] = int(out[int_field])
            except (TypeError, ValueError):
                out[int_field] = None

    for bool_field in ("use_gvisor", "harden_container", "shared_instant", "require_deploy"):
        if bool_field in out:
            val = out[bool_field]
            if isinstance(val, str):
                out[bool_field] = val.lower() in ("true", "1", "yes", "on")
            elif val is None:
                out[bool_field] = False

    if "difficulty" in out:
        dv = out["difficulty"]
        if dv is None or (isinstance(dv, str) and dv.strip() == ""):
            out["difficulty"] = None
        else:
            try:
                out["difficulty"] = int(dv)
            except (TypeError, ValueError):
                out["difficulty"] = None

    return out


def _read_template(challenge) -> dict:
    """Return a serialisable dict for a challenge_template record."""
    expose_port = ""
    image_link_name = ""
    if challenge.image_link:
        try:
            obj = json.loads(challenge.image_link)
            expose_port = obj.get("exposedPort", "")
            image_link_name = obj.get("imageLink", "")
        except (json.JSONDecodeError, AttributeError):
            pass

    data = {
        "id": challenge.id,
        "name": challenge.name,
        "description": challenge.description,
        "category": challenge.category,
        "type": challenge.type,
        "difficulty": challenge.difficulty,
        "require_deploy": challenge.require_deploy,
        "deploy_status": challenge.deploy_status,
        "image_link": challenge.image_link,
        "expose_port": expose_port,
        "image_link_name": image_link_name,
        "connection_info": challenge.connection_info,
        "connection_protocol": challenge.connection_protocol,
        "cpu_limit": challenge.cpu_limit,
        "cpu_request": challenge.cpu_request,
        "memory_limit": challenge.memory_limit,
        "memory_request": challenge.memory_request,
        "use_gvisor": challenge.use_gvisor,
        "harden_container": challenge.harden_container,
        "shared_instant": challenge.shared_instant,
        "created_by": challenge.created_by,
        "type_data": {},
    }

    try:
        chal_class = get_chal_class(challenge.type)
        data["type_data"] = {
            "id": chal_class.id,
            "name": chal_class.name,
            "templates": chal_class.templates,
            "scripts": chal_class.scripts,
        }
    except KeyError:
        pass

    # Dynamic-type extra fields
    if challenge.type == "dynamic":
        try:
            from CTFd.plugins.dynamic_challenges import DynamicChallenge
            dc = DynamicChallenge.query.filter_by(id=challenge.id).first()
            if dc:
                data["initial"] = dc.initial
                data["minimum"] = dc.minimum
                data["decay"] = dc.decay
                data["function"] = dc.function
        except Exception:
            pass

    return data


# ---------------------------------------------------------------------------
# Resource classes
# ---------------------------------------------------------------------------

@challenge_templates_namespace.route("")
class ChallengeTemplateList(Resource):

    @admin_or_challenge_writer_only_or_jury
    def get(self):
        """List all challenge templates with optional filters."""
        q = request.args.get("q")
        field = request.args.get("field", "name")
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

        challenges = (
            Challenges.query.filter(*filters)
            .order_by(Challenges.id.asc())
            .paginate(page=page, per_page=50, error_out=False)
        )

        response = []
        for c in challenges.items:
            creator_name = "Unknown"
            if c.created_by:
                u = Users.query.filter_by(id=c.created_by).first()
                if u:
                    creator_name = u.name
            entry = {
                "id": c.id,
                "name": c.name,
                "category": c.category,
                "type": c.type,
                "difficulty": c.difficulty,
                "require_deploy": c.require_deploy,
                "deploy_status": c.deploy_status,
                "created_by": c.created_by,
                "creator_name": creator_name,
            }
            response.append(entry)

        return {
            "success": True,
            "data": response,
            "meta": {
                "page": challenges.page,
                "per_page": challenges.per_page,
                "total": challenges.total,
                "pages": challenges.pages,
                "has_next": challenges.has_next,
                "has_prev": challenges.has_prev,
            },
        }

    @admin_or_challenge_writer_only
    def post(self):
        """Create a new challenge template."""
        data = request.form.to_dict() if request.form else (request.get_json() or {})

        # Basic required-field validation
        name = (data.get("name") or "").strip()
        category = (data.get("category") or "").strip()
        if not name:
            return {"success": False, "errors": {"name": ["Name cannot be empty"]}}, 400
        if not category:
            return {"success": False, "errors": {"category": ["Category cannot be empty"]}}, 400
        if len(category) > 20:
            return {"success": False, "errors": {"category": ["Category must be 20 characters or less"]}}, 400

        data["name"] = name
        data["category"] = category

        schema = ChallengeTemplateSchema()
        result = schema.load(data)
        if result.errors:
            return {"success": False, "errors": result.errors}, 400

        challenge_type = data.get("type", "standard")
        creator_id = session.get("id")
        template_data = _coerce_template_data(data)
        template_data["created_by"] = creator_id

        if challenge_type == "dynamic":
            try:
                from CTFd.plugins.dynamic_challenges import DynamicChallenge
                challenge = DynamicChallenge(**template_data)
                challenge.initial = int(data.get("initial", 100))
                challenge.minimum = int(data.get("minimum", 10))
                challenge.decay = int(data.get("decay", 50))
                challenge.function = data.get("function", "logarithmic")
            except Exception as e:
                return {"success": False, "errors": {"type": [str(e)]}}, 400
        else:
            challenge = Challenges(**template_data)

        challenge.last_update = datetime.utcnow()
        db.session.add(challenge)
        db.session.commit()

        log_audit(
            action="challenge_template_create",
            data={
                "challenge_template_id": challenge.id,
                "name": challenge.name,
                "category": challenge.category,
                "type": challenge.type,
                "difficulty": challenge.difficulty,
                "require_deploy": challenge.require_deploy,
                "created_by": challenge.created_by,
            },
        )

        return {"success": True, "data": _read_template(challenge)}


@challenge_templates_namespace.route("/types")
class ChallengeTemplateTypes(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        from flask import render_template
        response = {}
        for class_id in CHALLENGE_CLASSES:
            chal_class = CHALLENGE_CLASSES[class_id]
            response[chal_class.id] = {
                "id": chal_class.id,
                "name": chal_class.name,
                "templates": chal_class.templates,
                "scripts": chal_class.scripts,
                "create": render_template(chal_class.templates["create"].lstrip("/")),
            }
        return {"success": True, "data": response}


@challenge_templates_namespace.route("/<int:template_id>")
class ChallengeTemplate(Resource):

    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        challenge = Challenges.query.filter_by(id=template_id).first_or_404()
        return {"success": True, "data": _read_template(challenge)}

    @admin_or_challenge_writer_only
    def patch(self, template_id):
        """Update a challenge template."""
        challenge = Challenges.query.filter_by(id=template_id).first_or_404()

        data = request.get_json() or {}

        # Trim name / category
        if "name" in data:
            data["name"] = (data["name"] or "").strip()
        if "category" in data:
            data["category"] = (data["category"] or "").strip()
            if len(data["category"]) > 20:
                return {"success": False, "errors": {"category": ["Category must be 20 characters or less"]}}, 400

        schema = ChallengeTemplateSchema()
        result = schema.load(data)
        if result.errors:
            return {"success": False, "errors": result.errors}, 400

        before = _read_template(challenge)
        coerced = _coerce_template_data(data)

        # Handle expose_port → update image_link JSON
        if "expose_port" in data and data["expose_port"] is not None:
            try:
                expose_port_str = str(data["expose_port"])
                image_obj = {}
                if challenge.image_link:
                    try:
                        parsed = json.loads(challenge.image_link)
                        if isinstance(parsed, dict):
                            image_obj = parsed
                    except (json.JSONDecodeError, TypeError):
                        pass
                image_obj["exposedPort"] = expose_port_str
                challenge.image_link = json.dumps(image_obj)
            except (TypeError, ValueError):
                pass

        for attr, value in coerced.items():
            setattr(challenge, attr, value)

        # Dynamic scoring params
        if challenge.type == "dynamic" and any(k in data for k in ("initial", "minimum", "decay", "function")):
            try:
                from CTFd.plugins.dynamic_challenges import DynamicChallenge
                dc = DynamicChallenge.query.filter_by(id=challenge.id).first()
                if dc:
                    if "initial" in data:
                        dc.initial = int(data["initial"])
                    if "minimum" in data:
                        dc.minimum = int(data["minimum"])
                    if "decay" in data:
                        dc.decay = int(data["decay"])
                    if "function" in data:
                        dc.function = data["function"]
            except Exception:
                pass

        challenge.last_update = datetime.utcnow()
        db.session.commit()

        log_audit(
            action="challenge_template_update",
            before=before,
            after=_read_template(challenge),
            data={"challenge_template_id": template_id, "name": challenge.name},
        )

        return {"success": True, "data": _read_template(challenge)}

    @admin_or_challenge_writer_only
    def delete(self, template_id):
        """Delete a challenge template and all associated resources."""
        challenge = Challenges.query.filter_by(id=template_id).first_or_404()
        challenge_info = _read_template(challenge)

        DeployedChallenge.query.filter_by(challenge_template_id=template_id).delete()

        if challenge.require_deploy:
            active_version = ChallengeVersion.query.filter_by(
                challenge_template_id=template_id, is_active=True
            ).first()
            if active_version and active_version.deploy_file:
                delete_folder(active_version.deploy_file)
            delete_cached_files(challenge.id)

        # Remove all related records before deleting the challenge itself
        from CTFd.models import ContestChallenge
        ChallengeVersion.query.filter_by(challenge_template_id=template_id).delete()

        db.session.delete(challenge)
        db.session.commit()

        log_audit(
            action="challenge_template_delete",
            before=challenge_info,
            data={"challenge_template_id": template_id, "name": challenge_info["name"]},
        )

        return {"success": True}


# ---------------------------------------------------------------------------
# Sub-resources
# ---------------------------------------------------------------------------

@challenge_templates_namespace.route("/<int:template_id>/flags")
class ChallengeTemplateFlags(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        flags = Flags.query.filter_by(challenge_template_id=template_id).all()
        schema = FlagSchema(many=True)
        result = schema.dump(flags)
        if result.errors:
            return {"success": False, "errors": result.errors}, 400
        return {"success": True, "data": result.data}


@challenge_templates_namespace.route("/<int:template_id>/files")
class ChallengeTemplateFiles(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        files = ChallengeFilesModel.query.filter_by(challenge_template_id=template_id).all()
        return {
            "success": True,
            "data": [{"id": f.id, "type": f.type, "location": f.location} for f in files],
        }


@challenge_templates_namespace.route("/<int:template_id>/tags")
class ChallengeTemplateTags(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        tags = Tags.query.filter_by(challenge_template_id=template_id).all()
        return {
            "success": True,
            "data": [
                {"id": t.id, "challenge_id": t.challenge_template_id, "value": t.value}
                for t in tags
            ],
        }


@challenge_templates_namespace.route("/<int:template_id>/hints")
class ChallengeTemplateHints(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        hints = Hints.query.filter_by(challenge_template_id=template_id).all()
        schema = HintSchema(many=True)
        result = schema.dump(hints)
        if result.errors:
            return {"success": False, "errors": result.errors}, 400
        return {"success": True, "data": result.data}


@challenge_templates_namespace.route("/<int:template_id>/topics")
class ChallengeTemplateTopics(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        topics = ChallengeTopicsModel.query.filter_by(challenge_template_id=template_id).all()
        return {
            "success": True,
            "data": [
                {
                    "id": t.id,
                    "challenge_id": t.challenge_template_id,
                    "topic_id": t.topic_id,
                    "value": t.topic.value,
                }
                for t in topics
            ],
        }


@challenge_templates_namespace.route("/<int:template_id>/versions")
class ChallengeTemplateVersionList(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        Challenges.query.filter_by(id=template_id).first_or_404()
        versions = (
            ChallengeVersion.query.filter_by(challenge_template_id=template_id)
            .order_by(ChallengeVersion.version_number.desc())
            .all()
        )
        data = []
        for v in versions:
            data.append({
                "id": v.id,
                "challenge_template_id": v.challenge_template_id,
                "version_number": v.version_number,
                "image_tag": v.image_tag,
                "expose_port": v.expose_port,
                "deploy_file": v.deploy_file,
                "cpu_limit": v.cpu_limit,
                "cpu_request": v.cpu_request,
                "memory_limit": v.memory_limit,
                "memory_request": v.memory_request,
                "use_gvisor": v.use_gvisor,
                "harden_container": v.harden_container,
                "is_active": v.is_active,
                "created_by": v.creator.name if v.creator else "Unknown",
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "notes": v.notes,
            })
        return {"success": True, "data": data}


@challenge_templates_namespace.route("/<int:template_id>/versions/<int:version_id>")
class ChallengeTemplateVersionDetail(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id, version_id):
        Challenges.query.filter_by(id=template_id).first_or_404()
        version = ChallengeVersion.query.filter_by(
            id=version_id, challenge_template_id=template_id
        ).first_or_404()
        return {
            "success": True,
            "data": {
                "id": version.id,
                "challenge_template_id": version.challenge_template_id,
                "version_number": version.version_number,
                "image_link": version.image_link,
                "image_tag": version.image_tag,
                "expose_port": version.expose_port,
                "deploy_file": version.deploy_file,
                "cpu_limit": version.cpu_limit,
                "cpu_request": version.cpu_request,
                "memory_limit": version.memory_limit,
                "memory_request": version.memory_request,
                "use_gvisor": version.use_gvisor,
                "harden_container": version.harden_container,
                "is_active": version.is_active,
                "created_by": version.creator.name if version.creator else "Unknown",
                "created_at": version.created_at.isoformat() if version.created_at else None,
                "notes": version.notes,
            },
        }


@challenge_templates_namespace.route("/<int:template_id>/versions/<int:version_id>/rollback")
class ChallengeTemplateVersionRollback(Resource):
    @admin_or_challenge_writer_only
    def post(self, template_id, version_id):
        challenge = Challenges.query.filter_by(id=template_id).first_or_404()
        version = ChallengeVersion.query.filter_by(
            id=version_id, challenge_template_id=template_id
        ).first_or_404()

        if version.is_active:
            return {"success": False, "message": "This version is already active"}, 400
        if not version.image_link:
            return {"success": False, "message": "This version has no image to rollback to"}, 400

        try:
            ChallengeVersion.query.filter_by(challenge_template_id=template_id).update({"is_active": False})
            version.is_active = True

            challenge.image_link = version.image_link
            for attr in ("deploy_file", "cpu_limit", "cpu_request", "memory_limit",
                         "memory_request", "use_gvisor", "harden_container"):
                val = getattr(version, attr, None)
                if val is not None:
                    setattr(challenge, attr, val)

            challenge.deploy_status = "DEPLOY_SUCCESS"
            challenge.last_update = datetime.utcnow()
            db.session.commit()

            return {
                "success": True,
                "message": f"Rolled back to version {version.version_number}",
                "data": {"version_number": version.version_number},
            }
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Rollback failed: {str(e)}"}, 500


@challenge_templates_namespace.route("/<int:template_id>/deploy-duration")
class ChallengeTemplateDeployDuration(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, template_id):
        from datetime import timezone
        from CTFd.utils.connector.multiservice_connector import get_workflow_name, get_workflow_status

        challenge = Challenges.query.filter_by(id=template_id).first_or_404()
        if not challenge.require_deploy:
            return {"success": False, "error": "Challenge template does not require deployment"}, 400

        workflow_name = get_workflow_name(challenge.id)
        if not workflow_name:
            return {"success": False, "error": "Workflow name not found"}, 404

        workflow_phase, started_at_iso, estimated_duration = get_workflow_status(workflow_name)
        if workflow_phase is None:
            return {"success": False, "error": "Could not retrieve workflow status"}, 500

        remaining_time = None
        if estimated_duration and started_at_iso:
            from datetime import datetime as dt
            started_at_dt = dt.fromisoformat(started_at_iso.replace("Z", "+00:00"))
            now_utc = dt.now(timezone.utc)
            elapsed = max(0.0, (now_utc - started_at_dt).total_seconds())
            remaining_time = max(0.0, float(estimated_duration) - elapsed)

        if workflow_phase == "Succeeded":
            challenge.deploy_status = "DEPLOY_SUCCESS"
            db.session.commit()
        elif workflow_phase in ("Failed", "Error"):
            challenge.deploy_status = "DEPLOY_FAILED"
            db.session.commit()

        return {
            "success": True,
            "data": {
                "phase": workflow_phase,
                "estimated_duration": float(estimated_duration),
                "started_at": started_at_iso,
                "remaining_time": remaining_time,
            },
        }
