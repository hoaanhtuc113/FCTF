"""Regression tests for invalid model types, with no production services."""

import importlib
import io
import json
import unittest
from unittest.mock import patch

from sqlalchemy import cast, select
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

import test_password_token_revocation as password_tests
from CTFd.models import Challenges, Files, Flags, StaticFlag, Users, UserTokens, db
from CTFd.plugins.challenges import BaseChallenge, CHALLENGE_CLASSES
from CTFd.plugins.dynamic_challenges import DynamicChallenge, DynamicValueChallenge
from CTFd.utils import uploads


class ModelTypeTests(unittest.TestCase):
    clean_database = password_tests.PasswordTokenRevocationTests.clean_database
    login_as = password_tests.PasswordTokenRevocationTests.login_as

    def setUp(self):
        password_tests.PasswordTokenRevocationTests.setUp(self)
        db.create_all()
        self.registry = patch.dict(CHALLENGE_CLASSES, {"dynamic": DynamicValueChallenge})
        self.registry.start()
        self.addCleanup(self.registry.stop)
        self.flags_api = importlib.import_module("CTFd.api.v1.flags")
        self.files_api = importlib.import_module("CTFd.api.v1.files")
        self.challenges_api = importlib.import_module("CTFd.api.v1.challenges")
        # The existing namespace's API is the one installed by the shared setup.
        api = self.users_api.users_namespace.apis[-1]
        api.add_namespace(self.flags_api.flags_namespace, path="/api/v1/flags")
        api.add_namespace(self.files_api.files_namespace, path="/api/v1/files")
        api.add_namespace(self.challenges_api.challenges_namespace, path="/api/v1/challenges")
        from CTFd.cli import _cli

        self.app.register_blueprint(_cli, cli_group=None)
        self.maintenance = importlib.import_module("CTFd.cli.model_types")
        from CTFd.utils import set_config

        set_config("user_mode", "users")
        set_config("challenge_visibility", "public")
        set_config("account_visibility", "public")
        for module in (self.flags_api, self.files_api, self.challenges_api):
            for name in ("log_audit", "clear_challenges", "clear_standings"):
                if hasattr(module, name):
                    self.mocks.enter_context(patch.object(module, name))
        db.session.add_all([
            Challenges(id=1, name="standard", category="test", value=100,
                       time_limit=-1, user_id=1),
            DynamicChallenge(id=2, name="dynamic", category="test", initial=100,
                             minimum=10, decay=50, time_limit=-1, user_id=1),
            StaticFlag(id=1, challenge_id=1, content="FLAG{test}"),
            Files(id=1, location="test/file.txt"),
        ])
        db.session.commit()
        self.login_as(1)

    def corrupt(self, model, record_id, value):
        table = model.__table__
        db.session.execute(table.update().where(table.c.id == record_id).values(type=value))
        db.session.commit()
        db.session.expunge_all()

    def raw_type(self, model, record_id):
        table = model.__table__
        return db.session.execute(select(cast(table.c.type, db.String)).where(table.c.id == record_id)).scalar()

    def test_invalid_user_create_and_patch_leave_database_unchanged(self):
        for value in ("owner", "", None, 123, [], {}):
            with self.subTest(type=value):
                response = self.client.patch("/api/v1/users/2", json={"type": value})
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertEqual(self.raw_type(Users, 2), "user")
                response = self.client.post("/api/v1/users", json={
                    "name": "new-user", "email": "new@example.test", "password": "NewPass!123", "type": value,
                })
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertEqual(Users.query.count(), 3)
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)

    def test_supported_user_roles_are_preserved(self):
        for value in ("challenge_writer", "jury", "admin", "user"):
            response = self.client.patch("/api/v1/users/2", json={"type": value})
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(self.raw_type(Users, 2), value)

    def test_self_cannot_assign_an_admin_role(self):
        self.login_as(2)
        self.client.patch("/api/v1/users/me", json={"type": "admin"})
        self.assertEqual(self.raw_type(Users, 2), "user")

    def test_invalid_flag_create_and_patch_leave_database_unchanged(self):
        for value in ("dynamic", "bad", "", None, 123, [], {}):
            with self.subTest(type=value):
                response = self.client.post("/api/v1/flags", json={"challenge_id": 1, "content": "wrong", "type": value})
                self.assertEqual(response.status_code, 400, response.get_json())
                response = self.client.patch("/api/v1/flags/1", json={"type": value})
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertEqual(self.raw_type(Flags, 1), "static")
                self.assertEqual(Flags.query.count(), 1)

    def test_flag_alias_defaults_and_valid_type_changes(self):
        for payload, expected in (({}, "static"), ({"flag_type": "regex"}, "regex"), ({"type": "regex"}, "regex")):
            response = self.client.post("/api/v1/flags", json={"challenge_id": 1, "content": "test", **payload})
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["data"]["type"], expected)
        response = self.client.patch("/api/v1/flags/1", json={"type": "regex"})
        self.assertEqual(response.status_code, 200, response.get_json())
        db.session.expunge_all()
        self.assertEqual(Flags.query.get(1).type, "regex")

    def test_conflicting_flag_alias_is_rejected(self):
        response = self.client.post("/api/v1/flags", json={"challenge_id": 1, "content": "x", "type": "static", "flag_type": "regex"})
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(Flags.query.count(), 1)

    def test_invalid_challenge_types_are_rejected_before_writes(self):
        for value in ("bad", "", None, 123, [], {}):
            with self.subTest(type=value):
                response = self.client.post("/api/v1/challenges", json={"name": "new", "category": "test", "time_limit": -1, "type": value})
                self.assertEqual(response.status_code, 400, response.get_json())
                response = self.client.patch("/api/v1/challenges/1", json={"type": value})
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertEqual(self.raw_type(Challenges, 1), "standard")
                self.assertEqual(Challenges.query.count(), 2)

    def test_challenge_create_requires_type(self):
        response = self.client.post("/api/v1/challenges", json={"name": "new", "category": "test", "time_limit": -1})
        self.assertEqual(response.status_code, 400, response.get_json())

    def test_raw_type_change_cannot_break_dynamic_child_table(self):
        response = self.client.patch("/api/v1/challenges/1", json={"type": "dynamic"})
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(self.raw_type(Challenges, 1), "standard")
        self.assertIsNone(DynamicChallenge.query.get(1))

    def test_supported_scoring_conversion_keeps_child_table_consistent(self):
        for target, expected_child in (("dynamic", True), ("standard", False)):
            response = self.client.patch("/api/v1/challenges/1", json={
                "scoring-type-radio": target, "type": target,
                "initial": 100, "minimum": 10, "decay": 50, "function": "logarithmic", "value": 100,
            })
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(self.raw_type(Challenges, 1), target)
            db.session.expunge_all()
            self.assertEqual(DynamicChallenge.query.get(1) is not None, expected_child)

    def test_ui_conversion_ignores_previous_type_in_request(self):
        response = self.client.patch("/api/v1/challenges/1", json={"scoring-type-radio": "dynamic", "type": "standard"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.raw_type(Challenges, 1), "dynamic")

    def test_invalid_scoring_type_is_rejected(self):
        response = self.client.patch("/api/v1/challenges/1", json={"scoring-type-radio": "bad"})
        self.assertEqual(response.status_code, 400, response.get_json())

    def test_invalid_upload_type_never_writes_a_file(self):
        with patch.object(uploads, "get_uploader") as uploader:
            response = self.client.post("/api/v1/files", data={"type": "bad", "file": (io.BytesIO(b"test"), "test.txt")})
            self.assertEqual(response.status_code, 400, response.get_json())
            with self.assertRaises(ValueError):
                uploads.upload_file(file=FileStorage(stream=io.BytesIO(b"test"), filename="test.txt"), type="bad")
            uploader.assert_not_called()
        self.assertEqual(Files.query.count(), 1)

    def test_normal_uploads_keep_supported_types(self):
        with patch.object(uploads, "get_uploader") as get_uploader:
            get_uploader.return_value.upload.side_effect = ["test/normal.txt", "test/challenge.txt"]
            for kwargs, expected in (({}, "standard"), ({"type": "challenge", "challenge_id": 1}, "challenge")):
                row = uploads.upload_file(file=FileStorage(stream=io.BytesIO(b"test"), filename="test.txt"), **kwargs)
                self.assertEqual(row.type, expected)

    def test_model_assignments_reject_unsupported_types(self):
        for model in (Users, Challenges, Files, Flags):
            with self.subTest(model=model):
                row = model.query.first()
                for value in ("bad", None, [], {}):
                    with self.assertRaises(ValueError):
                        model(type=value)
                    with self.assertRaises(ValueError):
                        row.type = value
                db.session.rollback()

    def test_legacy_unknown_and_null_rows_are_readable_without_rewriting(self):
        for model, record_id, url in ((Users, 2, "/api/v1/users?view=admin"), (Flags, 1, "/api/v1/flags"), (Files, 1, "/api/v1/files")):
            for value in ("bad", None):
                with self.subTest(model=model, type=value):
                    self.corrupt(model, record_id, value)
                    self.assertIsNotNone(model.query.get(record_id))
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 200, response.get_json())
                    self.assertEqual(self.raw_type(model, record_id), value)

    def test_legacy_user_can_be_repaired_through_admin_api(self):
        self.corrupt(Users, 2, "bad")
        response = self.client.patch("/api/v1/users/2", json={"type": "user"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.raw_type(Users, 2), "user")

    def test_legacy_flag_is_inspectable_and_repairable(self):
        for value in ("bad", None, "dynamic"):
            self.corrupt(Flags, 1, value)
            response = self.client.get("/api/v1/flags/1")
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["data"]["templates"], {})
            response = self.client.patch("/api/v1/flags/1", json={"type": "static"})
            self.assertEqual(response.status_code, 200, response.get_json())

    def test_corrupt_file_can_be_deleted_but_cannot_be_downloaded_publicly(self):
        from CTFd.views import files

        for value in ("bad", None):
            self.corrupt(Files, 1, value)
            with self.app.test_request_context("/files/test/file.txt"):
                with self.assertRaises(NotFound):
                    files("test/file.txt")
        with patch.object(uploads, "get_uploader") as uploader:
            response = self.client.delete("/api/v1/files/1")
            self.assertEqual(response.status_code, 200, response.get_json())
            uploader.return_value.delete.assert_called_once_with(filename="test/file.txt")
        self.assertIsNone(Files.query.get(1))

    def test_legacy_flag_does_not_crash_attempt_or_award_a_solve(self):
        for value in ("bad", None, "dynamic"):
            self.corrupt(Flags, 1, value)
            with self.app.test_request_context(json={"submission": "FLAG{test}"}):
                from flask import request

                correct, message = BaseChallenge.attempt(Challenges.query.get(1), request)
                self.assertFalse(correct)
                self.assertIn("unavailable", message)

    def test_missing_flag_type_template_is_404(self):
        response = self.client.get("/api/v1/flags/types/bad")
        self.assertEqual(response.status_code, 404)

    def test_corrupt_challenge_read_update_and_preview_return_controlled_errors(self):
        for value in ("bad", None):
            self.corrupt(Challenges, 1, value)
            for method, url, kwargs in (("get", "/api/v1/challenges/1", {}), ("patch", "/api/v1/challenges/1", {"json": {"name": "test"}}), ("delete", "/api/v1/challenges/1", {}), ("post", "/api/v1/challenges/attempt?preview=true", {"json": {"challenge_id": 1, "submission": "x"}, "headers": {"Authorization": "Bearer ctfd_test_1"}})):
                response = getattr(self.client, method)(url, **kwargs)
                self.assertEqual(response.status_code, 400, response.get_json())

    def test_audit_and_dry_run_do_not_change_data(self):
        self.corrupt(Users, 2, "bad")
        self.corrupt(Files, 1, None)
        runner = self.app.test_cli_runner()
        result = runner.invoke(args=["audit-types"])
        self.assertEqual(result.exit_code, 0, result.output)
        rows = json.loads(result.output)
        self.assertIn({"kind": "users", "id": 2, "type": "bad"}, rows)
        self.assertIn({"kind": "files", "id": 1, "type": None}, rows)
        result = runner.invoke(args=["repair-type", "users", "2", "user"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertFalse(json.loads(result.output)["applied"])
        self.assertEqual(self.raw_type(Users, 2), "bad")
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)
        result = runner.invoke(args=["repair-type", "files", "1", "standard"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIsNone(json.loads(result.output)["from"])
        self.assertIsNone(self.raw_type(Files, 1))

    def test_cli_repairs_all_four_kinds_and_revokes_repaired_user_tokens(self):
        for kind, model, record_id, target in (("users", Users, 2, "user"), ("challenges", Challenges, 1, "standard"), ("flags", Flags, 1, "static"), ("files", Files, 1, "standard")):
            self.corrupt(model, record_id, "bad")
            result = self.app.test_cli_runner().invoke(args=["repair-type", kind, str(record_id), target, "--apply"])
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(self.raw_type(model, record_id), target)
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 0)
        self.assertEqual(self.maintenance.invalid_types(), [])

    def test_cli_rejects_invalid_targets_and_missing_child_data(self):
        self.corrupt(Challenges, 1, "bad")
        self.corrupt(Files, 1, "bad")
        for kind, target in (("challenges", "bad"), ("challenges", "dynamic"), ("files", "challenge")):
            result = self.app.test_cli_runner().invoke(args=["repair-type", kind, "1", target, "--apply"])
            self.assertNotEqual(result.exit_code, 0)
            self.assertEqual(self.raw_type(self.maintenance.MODELS[kind], 1), "bad")

    def test_cli_can_restore_dynamic_type_with_existing_child_data(self):
        self.corrupt(Challenges, 2, "bad")
        self.maintenance.repair_type("challenges", 2, "dynamic", apply=True)
        db.session.expunge_all()
        self.assertEqual(DynamicChallenge.query.get(2).initial, 100)

    def test_missing_dynamic_child_is_reported_and_can_be_repaired(self):
        table = DynamicChallenge.__table__
        db.session.execute(table.delete().where(table.c.id == 2))
        db.session.commit()
        db.session.expunge_all()
        response = self.client.get("/api/v1/challenges/2")
        self.assertEqual(response.status_code, 400, response.get_json())
        response = self.client.patch("/api/v1/challenges/2", json={"name": "test"})
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertIn({"kind": "challenges", "id": 2, "type": "dynamic", "reason": "missing_type_data"}, self.maintenance.invalid_types())
        self.maintenance.repair_type("challenges", 2, "standard", apply=True)
        self.assertEqual(self.raw_type(Challenges, 2), "standard")
        self.assertEqual(self.maintenance.invalid_types(), [])

    def test_cli_failure_rolls_back_type_and_token_changes(self):
        self.corrupt(Users, 2, "bad")
        with patch.object(db.session, "commit", side_effect=RuntimeError("simulated failure")):
            with self.assertRaises(RuntimeError):
                self.maintenance.repair_type("users", 2, "user", apply=True)
        self.assertEqual(self.raw_type(Users, 2), "bad")
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)

    def test_registered_plugin_types_pass_validation(self):
        from CTFd.plugins.flags import FLAG_CLASSES, CTFdStaticFlag
        from CTFd.utils.validators.model_types import require_supported_type

        with patch.dict(FLAG_CLASSES, {"custom": CTFdStaticFlag}):
            self.assertEqual(require_supported_type("flags", "custom"), "custom")
            response = self.client.post("/api/v1/flags", json={"challenge_id": 1, "content": "x", "type": "custom"})
            self.assertEqual(response.status_code, 200, response.get_json())
        with patch.dict(CHALLENGE_CLASSES, {"custom": BaseChallenge}):
            self.assertEqual(require_supported_type("challenges", "custom"), "custom")


if __name__ == "__main__":
    unittest.main()
