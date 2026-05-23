"""
CTFd/api/v1/kypo.py

API endpoints quản lý KYPO resources (Sandbox Definition, Pool).
Chỉ admin mới dùng được.

Endpoints:
  GET  /api/v1/kypo/sandbox-definitions          — danh sách từ KYPO
  GET  /api/v1/kypo/sandbox-definitions/<id>     — chi tiết 1 definition
  POST /api/v1/kypo/sandbox-definitions          — tạo mới trên KYPO

  GET  /api/v1/kypo/contests/<id>/pools          — pools của contest (từ FCTF DB)
  POST /api/v1/kypo/contests/<id>/pools          — tạo pool trên KYPO + lưu DB
  GET  /api/v1/kypo/contests/<id>/pools/<kypo_id> — chi tiết pool từ KYPO API
"""

from flask import request, Response
from flask_restx import Namespace, Resource

from CTFd.models import db, Contests
from CTFd.models import Pool, SandboxDefinition
from CTFd.utils.decorators import admins_only
from CTFd.utils.kypo_service import kypo_service

kypo_namespace = Namespace("kypo", description="KYPO Resource Management")


# ════════════════════════════════════════════════════════════════
# Sandbox Definitions — lấy từ KYPO API, không lưu DB
# ════════════════════════════════════════════════════════════════

@kypo_namespace.route("/sandbox-definitions")
class SandboxDefinitionList(Resource):
    method_decorators = [admins_only]

    def get(self):
        """Lấy danh sách sandbox definitions từ KYPO."""
        try:
            data = kypo_service.list_sandbox_definitions()
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502

    def post(self):
        """Tạo sandbox definition mới trên KYPO từ Git repo."""
        body = request.get_json() or {}
        git_url  = (body.get("git_url") or "").strip()
        revision = (body.get("git_revision") or "main").strip() or "main"

        if not git_url:
            return {"success": False, "errors": {"git_url": "Bắt buộc"}}, 400

        try:
            result = kypo_service.create_sandbox_definition(git_url, revision)
            return {"success": True, "data": result}, 201
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/sandbox-definitions/<int:definition_id>")
class SandboxDefinitionDetail(Resource):
    method_decorators = [admins_only]

    def get(self, definition_id):
        """Lấy chi tiết 1 sandbox definition từ KYPO."""
        try:
            data = kypo_service.get_sandbox_definition(definition_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


# ════════════════════════════════════════════════════════════════
# Pools — lưu mapping trong FCTF DB, chi tiết lấy từ KYPO API
# ════════════════════════════════════════════════════════════════

@kypo_namespace.route("/contests/<int:contest_id>/pools")
class PoolList(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        """
        Lấy danh sách pools của contest từ FCTF DB.
        Trả về KYPO pool_id để frontend gọi KYPO API lấy chi tiết nếu cần.
        """
        Contests.query.filter_by(id=contest_id).first_or_404()

        pools = Pool.query.filter_by(contest_id=contest_id).all()
        return {
            "success": True,
            "data": [
                {
                    "id": p.id,
                    "kypo_pool_id": p.pool_id,
                    "contest_id": p.contest_id,
                }
                for p in pools
            ],
        }, 200

    def post(self, contest_id):
        """
        Tạo pool mới trên KYPO rồi lưu mapping vào FCTF DB.

        Body:
          - kypo_definition_id: int  (ID sandbox definition bên KYPO)
          - max_size: int            (số sandbox tối đa)
          - comment: str             (tên/ghi chú cho pool, optional)
          - allocate: bool           (tự allocate sau khi tạo, default true)
        """
        Contests.query.filter_by(id=contest_id).first_or_404()

        body = request.get_json() or {}
        kypo_def_id = body.get("kypo_definition_id")
        max_size    = body.get("max_size", 1)
        comment     = body.get("comment", "")
        allocate    = body.get("allocate", True)

        if not kypo_def_id:
            return {
                "success": False,
                "errors": {"kypo_definition_id": "Bắt buộc"},
            }, 400

        # 1. Tạo pool trên KYPO
        try:
            pool_result = kypo_service.create_pool(
                definition_id=kypo_def_id,
                max_size=max_size,
                comment=comment,
            )
        except Exception as e:
            return {"success": False, "error": f"Tạo pool KYPO thất bại: {e}"}, 502

        kypo_pool_id = pool_result["id"]

        # 2. Allocate sandboxes ngay sau khi tạo pool (nếu yêu cầu)
        allocation_result = None
        if allocate:
            try:
                allocation_result = kypo_service.allocate_sandboxes(
                    pool_id=kypo_pool_id,
                    count=max_size,
                )
            except Exception as e:
                # Không fail hard — pool đã tạo rồi, chỉ log lại
                allocation_result = {"error": str(e)}

        # 3. Lưu mapping vào FCTF DB
        pool = Pool(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        )
        db.session.add(pool)
        db.session.commit()

        return {
            "success": True,
            "data": {
                "id": pool.id,
                "kypo_pool_id": kypo_pool_id,
                "contest_id": contest_id,
                "kypo_response": pool_result,
                "allocation": allocation_result,
            },
        }, 201


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>")
class PoolDetail(Resource):
    method_decorators = [admins_only]

    def _get_pool_or_404(self, contest_id, kypo_pool_id):
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        return pool

    def get(self, contest_id, kypo_pool_id):
        """Lấy chi tiết pool từ KYPO API."""
        pool = self._get_pool_or_404(contest_id, kypo_pool_id)
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404
        try:
            data = kypo_service.get_pool(kypo_pool_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502

    def delete(self, contest_id, kypo_pool_id):
        """Xóa pool khỏi KYPO và FCTF DB."""
        pool = self._get_pool_or_404(contest_id, kypo_pool_id)
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404
        try:
            kypo_service.delete_pool(kypo_pool_id)
        except Exception as e:
            return {"success": False, "error": str(e)}, 502
        db.session.delete(pool)
        db.session.commit()
        return {"success": True}, 200


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/status")
class PoolStatus(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id, kypo_pool_id):
        """Lấy trạng thái allocation units của pool từ KYPO."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404
        try:
            data = kypo_service.get_pool_allocation_units(kypo_pool_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/allocate")
class PoolAllocate(Resource):
    method_decorators = [admins_only]

    def post(self, contest_id, kypo_pool_id):
        """Allocate thêm sandbox cho pool."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404

        body = request.get_json() or {}
        count = body.get("count", 1)
        try:
            data = kypo_service.allocate_sandboxes(kypo_pool_id, count)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/edit")
class PoolEdit(Resource):
    method_decorators = [admins_only]

    def patch(self, contest_id, kypo_pool_id):
        """Cập nhật comment của pool trên KYPO."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404

        body = request.get_json() or {}
        try:
            data = kypo_service.edit_pool(kypo_pool_id, comment=body.get("comment", ""))
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/ssh-config")
class PoolSSHConfig(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id, kypo_pool_id):
        """
        Download SSH config ZIP của pool.
        Trả về file ZIP để admin download và SSH vào sandbox.
        """
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404

        try:
            zip_bytes = kypo_service.download_pool_ssh_config(kypo_pool_id)
            return Response(
                zip_bytes,
                mimetype="application/zip",
                headers={
                    "Content-Disposition": f"attachment; filename=pool-{kypo_pool_id}-ssh-config.zip"
                },
            )
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/lock")
class PoolLock(Resource):
    method_decorators = [admins_only]

    def post(self, contest_id, kypo_pool_id):
        """Toggle resource limit (lock/unlock) của pool."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool không thuộc contest này"}, 404
        try:
            # Lấy trạng thái hiện tại rồi toggle
            pool_data = kypo_service.get_pool(kypo_pool_id)
            is_locked = pool_data.get("lock_state") == "LOCKED"
            data = kypo_service.toggle_pool_lock(kypo_pool_id, lock=not is_locked)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502