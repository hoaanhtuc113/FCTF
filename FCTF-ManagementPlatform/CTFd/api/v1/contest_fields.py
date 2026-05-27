"""
Global Custom Fields CRUD API.

Routes
------
GET  /api/v1/contest_fields[?field_for=user|team]
POST /api/v1/contest_fields
PATCH /api/v1/contest_fields/<field_id>
DELETE /api/v1/contest_fields/<field_id>
"""

from flask import request
from flask_restx import Namespace, Resource

from CTFd.models import Fields, UserFields, TeamFields, db
from CTFd.utils.decorators import admins_only

contest_fields_namespace = Namespace(
    "contest_fields", description="Global custom fields"
)

VALID_FIELD_TYPES = {"text", "boolean"}
VALID_FOR = {"user", "team"}


def _field_to_dict(f: Fields) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "field_for": f.type,          # "user" | "team"
        "field_type": f.field_type,   # "text" | "number" | "boolean"
        "description": f.description,
        "required": bool(f.required),
        "public": bool(f.public),
        "editable": bool(f.editable),
    }


@contest_fields_namespace.route("")
class ContestFieldList(Resource):
    method_decorators = [admins_only]

    def get(self):
        """List all custom fields (optionally filtered by field_for)."""
        field_for = request.args.get("field_for", "").strip() or None

        q = Fields.query.filter(Fields.type.in_(["user", "team"]))
        if field_for in VALID_FOR:
            q = q.filter(Fields.type == field_for)
        fields = q.order_by(Fields.id.asc()).all()
        return {"success": True, "data": [_field_to_dict(f) for f in fields]}

    def post(self):
        """Create a custom field."""
        data = request.get_json(force=True, silent=True) or {}

        field_for  = (data.get("field_for") or "").strip()
        name       = (data.get("name") or "").strip()
        field_type = (data.get("field_type") or "text").strip()
        description = (data.get("description") or "").strip() or None
        required   = bool(data.get("required", False))
        public     = bool(data.get("public", False))
        editable   = bool(data.get("editable", True))

        errors = {}
        if field_for not in VALID_FOR:
            errors["field_for"] = [f"Must be one of: {', '.join(VALID_FOR)}."]
        if not name:
            errors["name"] = ["Name is required."]
        if field_type not in VALID_FIELD_TYPES:
            errors["field_type"] = [f"Must be one of: {', '.join(VALID_FIELD_TYPES)}."]
        if errors:
            return {"success": False, "errors": errors}, 400

        cls = UserFields if field_for == "user" else TeamFields
        field = cls(
            name=name,
            field_type=field_type,
            description=description,
            required=required,
            public=public,
            editable=editable,
        )
        db.session.add(field)
        db.session.commit()
        return {"success": True, "data": _field_to_dict(field)}, 201


@contest_fields_namespace.route("/<int:field_id>")
class ContestField(Resource):
    method_decorators = [admins_only]

    def get(self, field_id):
        """Get a single custom field."""
        field = Fields.query.filter_by(id=field_id).first_or_404()
        return {"success": True, "data": _field_to_dict(field)}

    def patch(self, field_id):
        """Update a custom field."""
        field = Fields.query.filter_by(id=field_id).first_or_404()
        data  = request.get_json(force=True, silent=True) or {}

        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return {"success": False, "errors": {"name": ["Name is required."]}}, 400
            field.name = name
        if "field_type" in data:
            ft = (data["field_type"] or "").strip()
            if ft not in VALID_FIELD_TYPES:
                return {"success": False, "errors": {"field_type": [f"Must be one of: {', '.join(VALID_FIELD_TYPES)}."]}}, 400
            field.field_type = ft
        if "description" in data:
            field.description = (data["description"] or "").strip() or None
        if "required" in data:
            field.required = bool(data["required"])
        if "public" in data:
            field.public = bool(data["public"])
        if "editable" in data:
            field.editable = bool(data["editable"])

        db.session.commit()
        return {"success": True, "data": _field_to_dict(field)}

    def delete(self, field_id):
        """Delete a custom field (also cascades field entries)."""
        field = Fields.query.filter_by(id=field_id).first_or_404()
        db.session.delete(field)
        db.session.commit()
        return {"success": True}
