"""
CTFd/api/v1/kypo.py

API endpoints for managing KYPO resources (Sandbox Definition, Pool).
Admin access only.

Endpoints:
  GET  /api/v1/kypo/sandbox-definitions          — list from KYPO
  GET  /api/v1/kypo/sandbox-definitions/<id>     — detail of a single definition
  POST /api/v1/kypo/sandbox-definitions          — create new on KYPO

  GET  /api/v1/kypo/contests/<id>/pools          — pools of a contest (from FCTF DB)
  POST /api/v1/kypo/contests/<id>/pools          — create pool on KYPO + save to DB
  GET  /api/v1/kypo/contests/<id>/pools/<kypo_id> — pool detail from KYPO API
"""

from flask import request, Response
from flask_restx import Namespace, Resource

from CTFd.models import db, Contests
from CTFd.models import Pool, SandboxDefinition
from CTFd.utils.decorators import admins_only
from CTFd.utils.kypo_service import kypo_service

kypo_namespace = Namespace("kypo", description="KYPO Resource Management")


# ════════════════════════════════════════════════════════════════
# Sandbox Definitions — fetched from KYPO API, not stored in DB
# ════════════════════════════════════════════════════════════════

@kypo_namespace.route("/sandbox-definitions")
class SandboxDefinitionList(Resource):
    method_decorators = [admins_only]

    def get(self):
        """Fetch the list of sandbox definitions from KYPO, always returns a flat list."""
        try:
            raw = kypo_service.list_sandbox_definitions()
            # KYPO may return a Spring-paginated object {content:[...]} or a plain list
            if isinstance(raw, list):
                items = raw
            elif isinstance(raw, dict):
                items = (
                    raw.get("content")
                    or raw.get("results")
                    or raw.get("data")
                    or []
                )
                if not isinstance(items, list):
                    items = []
            else:
                items = []
            return {"success": True, "data": items}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502

    def post(self):
        """Create a new sandbox definition on KYPO from a Git repository."""
        body = request.get_json() or {}
        git_url  = (body.get("git_url") or "").strip()
        revision = (body.get("git_revision") or "main").strip() or "main"

        if not git_url:
            return {"success": False, "errors": {"git_url": "Required"}}, 400

        try:
            result = kypo_service.create_sandbox_definition(git_url, revision)
            return {"success": True, "data": result}, 201
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/sandbox-definitions/<int:definition_id>")
class SandboxDefinitionDetail(Resource):
    method_decorators = [admins_only]

    def get(self, definition_id):
        """Fetch detail of a single sandbox definition from KYPO."""
        try:
            data = kypo_service.get_sandbox_definition(definition_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502

    def delete(self, definition_id):
        """Delete a sandbox definition from KYPO."""
        try:
            kypo_service.delete_sandbox_definition(definition_id)
            return {"success": True}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/sandbox-definitions/<int:definition_id>/topology")
class SandboxDefinitionTopology(Resource):
    method_decorators = [admins_only]

    def get(self, definition_id):
        """Fetch topology data of a sandbox definition from KYPO."""
        try:
            data = kypo_service.get_definition_topology(definition_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


# ════════════════════════════════════════════════════════════════
# Pools — mapping stored in FCTF DB, details fetched from KYPO API
# ════════════════════════════════════════════════════════════════

@kypo_namespace.route("/contests/<int:contest_id>/pools")
class PoolList(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        """
        Fetch the list of pools for a contest from FCTF DB.
        Returns KYPO pool_id so the frontend can call the KYPO API for details if needed.
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
        Create a new pool on KYPO then save the mapping to FCTF DB.

        Body:
          - kypo_definition_id: int  (sandbox definition ID on KYPO)
          - max_size: int            (maximum number of sandboxes)
          - comment: str             (pool name/note, optional)
          - allocate: bool           (auto-allocate after creation, default true)
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
                "errors": {"kypo_definition_id": "Required"},
            }, 400

        # 1. Create pool on KYPO
        try:
            pool_result = kypo_service.create_pool(
                definition_id=kypo_def_id,
                max_size=max_size,
                comment=comment,
            )
        except Exception as e:
            return {"success": False, "error": f"Failed to create KYPO pool: {e}"}, 502

        kypo_pool_id = pool_result["id"]

        # 2. Allocate sandboxes immediately after pool creation (if requested)
        allocation_result = None
        if allocate:
            try:
                allocation_result = kypo_service.allocate_sandboxes(
                    pool_id=kypo_pool_id,
                    count=max_size,
                )
            except Exception as e:
                # Do not fail hard — pool is already created, just log the error
                allocation_result = {"error": str(e)}

        # 3. Save mapping to FCTF DB
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
        """Fetch pool detail from KYPO API."""
        pool = self._get_pool_or_404(contest_id, kypo_pool_id)
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404
        try:
            data = kypo_service.get_pool(kypo_pool_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502

    def delete(self, contest_id, kypo_pool_id):
        """Delete pool from KYPO and FCTF DB."""
        pool = self._get_pool_or_404(contest_id, kypo_pool_id)
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404
        try:
            kypo_service.delete_pool(kypo_pool_id)
        except Exception as e:
            return {"success": False, "error": str(e)}, 502
        db.session.delete(pool)
        db.session.commit()
        return {"success": True}, 200


@kypo_namespace.route("/contests/<int:contest_id>/sandboxes")
class ContestSandboxList(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id):
        """
        Aggregate all sandbox allocation units across every pool of this contest.
        Each item includes the pool_id it belongs to.
        """
        Contests.query.filter_by(id=contest_id).first_or_404()
        pools = Pool.query.filter_by(contest_id=contest_id).all()

        all_sandboxes = []
        for pool in pools:
            try:
                raw = kypo_service.get_pool_allocation_units(pool.pool_id)
                # KYPO may return a paginated object or a plain list
                if isinstance(raw, list):
                    units = raw
                elif isinstance(raw, dict):
                    units = (
                        raw.get("content")
                        or raw.get("data")
                        or raw.get("items")
                        or []
                    )
                else:
                    units = []
                for unit in units:
                    unit["kypo_pool_id"] = pool.pool_id
                    all_sandboxes.append(unit)
            except Exception:
                pass

        return {"success": True, "data": all_sandboxes}, 200


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/status")
class PoolStatus(Resource):
    method_decorators = [admins_only]

    def get(self, contest_id, kypo_pool_id):
        """Fetch the allocation unit status of a pool from KYPO."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404
        try:
            data = kypo_service.get_pool_allocation_units(kypo_pool_id)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502


@kypo_namespace.route("/contests/<int:contest_id>/pools/<int:kypo_pool_id>/allocate")
class PoolAllocate(Resource):
    method_decorators = [admins_only]

    def post(self, contest_id, kypo_pool_id):
        """Allocate additional sandboxes for a pool."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404

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
        """Update the comment of a pool on KYPO."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404

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
        Download the SSH config ZIP for a pool.
        Returns a ZIP file for the admin to download and SSH into sandboxes.
        """
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404

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
        """Toggle the resource limit (lock/unlock) of a pool."""
        pool = Pool.query.filter_by(
            pool_id=kypo_pool_id,
            contest_id=contest_id,
        ).first()
        if not pool:
            return {"success": False, "error": "Pool does not belong to this contest"}, 404
        try:
            # Fetch current state then toggle
            pool_data = kypo_service.get_pool(kypo_pool_id)
            is_locked = pool_data.get("lock_state") == "LOCKED"
            data = kypo_service.toggle_pool_lock(kypo_pool_id, lock=not is_locked)
            return {"success": True, "data": data}, 200
        except Exception as e:
            return {"success": False, "error": str(e)}, 502