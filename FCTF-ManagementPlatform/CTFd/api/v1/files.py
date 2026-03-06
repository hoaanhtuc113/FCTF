from typing import List

from flask import request
from flask_restx import Namespace, Resource
from pathlib import Path
from PIL import Image
import io
from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.constants import RawEnum
from CTFd.models import Files, db, Challenges
from CTFd.schemas.files import FileSchema
from CTFd.utils import uploads
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury, admins_only
from CTFd.utils.helpers.models import build_model_filters
from CTFd.utils.logging.audit_logger import log_audit
import CTFd.plugins.upload_zip_files.routes as upload_helper
from werkzeug.utils import secure_filename
import os
import json
import re
from CTFd.utils.uploads import delete_folder

files_namespace = Namespace("files", description="Endpoint to retrieve Files")

FileModel = sqlalchemy_to_pydantic(Files)


class FileDetailedSuccessResponse(APIDetailedSuccessResponse):
    data: FileModel


class FileListSuccessResponse(APIListSuccessResponse):
    data: List[FileModel]


files_namespace.schema_model(
    "FileDetailedSuccessResponse", FileDetailedSuccessResponse.apidoc()
)

files_namespace.schema_model(
    "FileListSuccessResponse", FileListSuccessResponse.apidoc()
)


@files_namespace.route("")
class FilesList(Resource):
    @admin_or_challenge_writer_only_or_jury
    @files_namespace.doc(
        description="Endpoint to get file objects in bulk",
        responses={
            200: ("Success", "FileListSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    @validate_args(
        {
            "type": (str, None),
            "location": (str, None),
            "q": (str, None),
            "field": (
                RawEnum("FileFields", {"type": "type", "location": "location"}),
                None,
            ),
        },
        location="query",
    )
    def get(self, query_args):
        q = query_args.pop("q", None)
        field = str(query_args.pop("field", None))
        filters = build_model_filters(model=Files, query=q, field=field)

        files = Files.query.filter_by(**query_args).filter(*filters).all()
        schema = FileSchema(many=True)
        response = schema.dump(files)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data}

    @admin_or_challenge_writer_only_or_jury
    @files_namespace.doc(
        description="Endpoint to get file objects in bulk",
        responses={
            200: ("Success", "FileDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def post(self):
        files = request.files.getlist("file")
        upload_type = request.form.get("upload_type")

        if upload_type == "small_icon" and files:
            f = files[0]
            data = f.read()
            f.seek(0)
            if f.mimetype not in ("image/png",) and not f.filename.lower().endswith(".png"):
                return {"success": False, "errors": "Only PNG files are accepted for the favicon."}, 400
            try:
                img = Image.open(io.BytesIO(data))
                if img.format != "PNG":
                    return {"success": False, "errors": "Only PNG files are accepted for the favicon."}, 400
                if img.size != (32, 32):
                    return {
                        "success": False,
                        "errors": f"Favicon must be exactly 32x32px. Got {img.size[0]}x{img.size[1]}px.",
                    }, 400
            except Exception:
                return {"success": False, "errors": "Could not read the image file."}, 400

        deploy_file = request.files.get("deploy_file")
        require_deploy = request.form.get("require_deploy") in ["on", "true", "True", "1"]
        expose_port = request.form.get("expose_port")
        challenge_id = request.form.to_dict().get("challenge_id")
        temp_file_path = ""
        objs = []

        if expose_port and not re.fullmatch(r"^[1-9]\d*$", expose_port) and require_deploy:
            return {"success": False, "errors": "Expose port must be a positive integer"}, 400

        if expose_port and require_deploy:
            expose_port = str(expose_port)

        print("require_deploy", require_deploy)

        # Only clear deployment info if this is from the Deploy tab (deploy_file field exists in request)
        is_deploy_operation = "deploy_file" in request.files
        
        if is_deploy_operation and not require_deploy:
            print("require_deploy is false - clearing deployment info")
            challenge = Challenges.query.filter_by(id=challenge_id).first()
            if not challenge:
                return {"success": False, "errors": "Challenge not found"}, 404

            delete_folder(challenge.deploy_file)
            
            challenge.image_link = None
            challenge.deploy_status = "CREATED"
            challenge.require_deploy = False
            challenge.deploy_file = None
            db.session.commit()
            
            if not files or len(files) == 0:
                return {"success": True, "data": []}

        # Handle situation where users attempt to upload multiple files with a single location
        if len(files) > 1 and request.form.get("location"):
            return {
                "success": False,
                "errors": {
                    "location": ["Location cannot be specified with multiple files"]
                },
            }, 400

        if deploy_file and require_deploy:
            # Lưu tệp tạm thời vào đĩa trước khi xử lý nó
            filename = secure_filename(deploy_file.filename)
            temp_file_path = os.path.join("/tmp", filename)
            deploy_file.save(temp_file_path)
            print(temp_file_path)
            print("save successfully")
            return upload_helper.upload_file(challenge_id, temp_file_path, expose_port)

        for f in files:
            print("upload file to local")
            # uploads.upload_file(file=f, chalid=req.get('challenge'))
            try:
                obj = uploads.upload_file(file=f, **request.form.to_dict())
                # os.remove(temp_file_path)
            except ValueError as e:
                return {
                    "success": False,
                    "errors": {"location": [str(e)]},
                }, 400
            objs.append(obj)

        schema = FileSchema(many=True)
        response = schema.dump(objs)
        print("response file:  ", response)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        for item in response.data:
            # Resolve challenge name for audit context
            _challenge_name = None
            _cid = item.get("challenge_id")
            if _cid:
                _ch = Challenges.query.filter_by(id=_cid).first()
                if _ch:
                    _challenge_name = _ch.name
            log_audit(
                action="file_create",
                data={
                    "file_id": item.get("id"),
                    "type": item.get("type"),
                    "location": item.get("location"),
                    "sha1sum": item.get("sha1sum"),
                    "challenge_id": _cid,
                    "challenge_name": _challenge_name,
                },
            )

        return {"success": True, "data": response.data}


@files_namespace.route("/<file_id>")
class FilesDetail(Resource):
    @admin_or_challenge_writer_only_or_jury
    @files_namespace.doc(
        description="Endpoint to get a specific file object",
        responses={
            200: ("Success", "FileDetailedSuccessResponse"),
            400: (
                "An error occured processing the provided or stored data",
                "APISimpleErrorResponse",
            ),
        },
    )
    def get(self, file_id):
        f = Files.query.filter_by(id=file_id).first_or_404()
        schema = FileSchema()
        response = schema.dump(f)

        if response.errors:
            return {"success": False, "errors": response.errors}, 400

        return {"success": True, "data": response.data}

    @admin_or_challenge_writer_only_or_jury
    @files_namespace.doc(
        description="Endpoint to delete a file object",
        responses={200: ("Success", "APISimpleSuccessResponse")},
    )
    def delete(self, file_id):
        f = Files.query.filter_by(id=file_id).first_or_404()

        # Resolve challenge name for audit context
        _challenge_name = None
        _cid = f.challenge_id if hasattr(f, 'challenge_id') else None
        if _cid:
            _ch = Challenges.query.filter_by(id=_cid).first()
            if _ch:
                _challenge_name = _ch.name

        file_info = {
            "file_id": f.id,
            "type": f.type,
            "location": f.location,
            "sha1sum": f.sha1sum if hasattr(f, 'sha1sum') else None,
            "challenge_id": _cid,
            "challenge_name": _challenge_name,
        }

        uploads.delete_file(file_id=f.id)
        db.session.delete(f)
        db.session.commit()
        db.session.close()

        log_audit(
            action="file_delete",
            before=file_info,
            data={"file_id": int(file_id)},
        )

        return {"success": True}
