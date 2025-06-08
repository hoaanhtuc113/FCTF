from typing import List

from flask import request
from flask_restx import Namespace, Resource
from pathlib import Path
from CTFd.api.v1.helpers.request import validate_args
from CTFd.api.v1.helpers.schemas import sqlalchemy_to_pydantic
from CTFd.api.v1.schemas import APIDetailedSuccessResponse, APIListSuccessResponse
from CTFd.constants import RawEnum
from CTFd.models import Files, db, Challenges
from CTFd.schemas.files import FileSchema
from CTFd.utils import uploads
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury, admins_only
from CTFd.utils.helpers.models import build_model_filters
import CTFd.plugins.upload_zip_files.routes as upload_helper
from werkzeug.utils import secure_filename
import os
import json
from flask import jsonify

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
        deploy_file = request.files.get("deploy_file")
        temp_file_path = ""
        objs = []
        # challenge_id
        # page_id

        # Handle situation where users attempt to upload multiple files with a single location
        if len(files) > 1 and request.form.get("location"):
            return {
                "success": False,
                "errors": {
                    "location": ["Location cannot be specified with multiple files"]
                },
            }, 400

        if deploy_file:
            # Lưu tệp tạm thời vào đĩa trước khi xử lý nó
            filename = secure_filename(deploy_file.filename)
            temp_file_path = os.path.join("/tmp", filename)
            deploy_file.save(temp_file_path)
            print(temp_file_path)
            print("save successfully")
            challenge_id = request.form.to_dict().get("challenge_id")
            return upload_helper.upload_file(challenge_id, temp_file_path)

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
        print(response)
        if response.errors:
            return {"success": False, "errors": response.errors}, 400

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

        uploads.delete_file(file_id=f.id)
        db.session.delete(f)
        db.session.commit()
        db.session.close()

        return {"success": True}
