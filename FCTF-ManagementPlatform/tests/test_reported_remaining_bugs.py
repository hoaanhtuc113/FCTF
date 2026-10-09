"""Regression coverage for BE-005/042/075/012/013/056/081/109/115."""
import csv
import importlib
import io
import unittest
from unittest.mock import Mock, patch

import requests
import test_model_types as model_tests

from CTFd.models import (Brackets, Challenges, Configs, Fields, KypoChallengeConfig,
                         Teams, UserFields, UserFieldEntries, TeamFields, TeamFieldEntries, Users, db)
from CTFd.plugins.challenges import CHALLENGE_CLASSES
from CTFd.plugins.sandbox_challenges import SandboxChallengeClass


class ReportedRemainingBugsTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.app.register_blueprint(self.admin.admin)
        api = self.users_api.users_namespace.apis[-1]
        for name in ("config", "brackets"):
            module = importlib.import_module("CTFd.api.v1." + name)
            namespace = getattr(module, "configs_namespace" if name == "config" else "brackets_namespace")
            api.add_namespace(namespace, path="/api/v1/" + ("configs" if name == "config" else name))
            self.mocks.enter_context(patch.object(module, "log_audit"))
        self.mocks.enter_context(patch.dict(CHALLENGE_CLASSES, {"sandbox": SandboxChallengeClass}))
        db.create_all()
        self.mocks.enter_context(patch("CTFd.plugins.sandbox_challenges.validation.get_kypo_base_url", return_value="https://kypo.test"))
        self.mocks.enter_context(patch("CTFd.plugins.sandbox_challenges.routes._get_kypo_token", return_value="test-token"))
        self.mocks.enter_context(patch("CTFd.plugins.sandbox_challenges.routes._service_base", return_value="https://kypo.test/training/api/v1"))
        self.kypo_get = self.mocks.enter_context(patch("CTFd.plugins.sandbox_challenges.validation.requests.get"))
        self.kypo_get.return_value = Mock(status_code=200, json=Mock(return_value={"id": 10}))

    def sandbox_payload(self, **overrides):
        return {"name": "sandbox", "category": "test", "type": "sandbox", "value": 100,
                "user_id": 1, "kypo_instance_id": 10, **overrides}

    def assert_bad(self, method, url, data, status=400):
        response = getattr(self.client, method)(url, json=data)
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        return response

    def test_field_create_patch_validation_and_legacy_delete(self):
        for key, values in (("type", ("invalid", None, [])), ("field_type", ("invalid", None, [])), ("name", ("", " ", None))):
            for value in values:
                self.assert_bad("post", "/api/v1/configs/fields", {"type": "user", "field_type": "text", "name": "School", key: value})
        response = self.client.post("/api/v1/configs/fields", json={"type": "user", "field_type": "text", "name": "School"})
        self.assertEqual(response.status_code, 200, response.get_json())
        field_id = response.get_json()["data"]["id"]
        for key, value in (("type", "team"), ("field_type", "invalid"), ("name", " ")):
            self.assert_bad("patch", "/api/v1/configs/fields/" + str(field_id), {key: value})
        self.assertEqual(self.client.patch("/api/v1/configs/fields/" + str(field_id), json={"description": "updated"}).status_code, 200)
        # Old discriminators must be inspectable/deletable without becoming user/team fields.
        for record_id, value in ((90, "invalid"), (91, None)):
            db.session.execute(Fields.__table__.insert().values(id=record_id, name="legacy", type="standard", field_type="invalid"))
            db.session.execute(db.text("UPDATE fields SET type=:value WHERE id=:id"), {"id": record_id, "value": value})
        db.session.commit()
        self.assertEqual(Fields.query.count(), 3)
        self.assertEqual(UserFields.query.count(), 1)
        for record_id in (90, 91):
            self.assertEqual(self.client.get("/api/v1/configs/fields/" + str(record_id)).status_code, 200)
            self.assertEqual(self.client.delete("/api/v1/configs/fields/" + str(record_id)).status_code, 200)
        self.assertEqual(Fields.query.count(), 1)

    def test_csv_exports_with_field_entries_and_corrupt_related_field(self):
        db.session.add_all([Teams(id=1, name="team", password="Pass!123"),
                            UserFields(id=10, name="School", field_type="text"),
                            TeamFields(id=11, name="Organization", field_type="text")])
        db.session.flush()
        db.session.add_all([UserFieldEntries(user_id=2, field_id=10, value="School A"),
                            TeamFieldEntries(team_id=1, field_id=11, value="Org A")])
        db.session.commit()
        def export(name):
            response = self.client.get("/admin/export/csv", query_string={"table": name})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertIn("attachment", response.headers["Content-Disposition"])
            return list(csv.DictReader(io.StringIO(response.get_data(as_text=True))))
        rows = export("users+fields")
        self.assertEqual(next(row for row in rows if row["id"] == "2")["School"], "School A")
        self.assertEqual(export("teams+fields")[0]["Organization"], "Org A")
        db.session.execute(db.text("UPDATE fields SET type='invalid' WHERE id=10"))
        db.session.commit()
        db.session.expunge_all()
        for name in ("users", "users+fields", "teams+fields", "files"):
            export(name)
        self.assertEqual(export("files")[0]["location"], "test/file.txt")
        self.assertEqual(db.session.execute(db.text("SELECT type FROM fields WHERE id=10")).scalar(), "invalid")
        # Even an unreadable joined entry must not block the raw users export.
        db.session.execute(db.text("UPDATE field_entries SET type='invalid' WHERE field_id=10"))
        db.session.execute(db.text("UPDATE users SET type=NULL WHERE id=3"))
        db.session.commit()
        self.assertEqual(next(row for row in export("users") if row["id"] == "3")["type"], "")

    def test_prerequisites_reject_invalid_ids_and_preserve_row(self):
        for value in ([999999], [None], [True], [1, 1], "1", {"id": 1}, ["abc"]):
            self.assert_bad("patch", "/api/v1/challenges/1", {"name": "bad", "requirements": {"prerequisites": value}})
            self.assertEqual(Challenges.query.get(1).name, "standard")
            self.assertIsNone(Challenges.query.get(1).requirements)
        response = self.client.patch("/api/v1/challenges/1", json={"requirements": {"prerequisites": [2], "anonymize": True}})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Challenges.query.get(1).requirements, {"prerequisites": [2], "anonymize": True})
        self.assert_bad("post", "/api/v1/challenges", {"name": "new", "category": "test", "type": "standard", "time_limit": -1,
                                                       "requirements": {"prerequisites": [999999]}})
        self.assertEqual(Challenges.query.count(), 2)

    def test_sandbox_invalid_references_and_outages_do_not_create(self):
        for value in (None, 999999, "abc", True, 0):
            self.kypo_get.return_value.status_code = 404
            response = self.assert_bad("post", "/api/v1/challenges", self.sandbox_payload(kypo_instance_id=value))
            self.assertIn("kypo_instance_id", response.get_json()["errors"])
            self.assertEqual(Challenges.query.count(), 2)
            self.assertEqual(KypoChallengeConfig.query.count(), 0)
        data = self.sandbox_payload(); del data["kypo_instance_id"]
        self.assert_bad("post", "/api/v1/challenges", data)
        self.kypo_get.reset_mock()
        for overrides in ({"kypo_instance_type": "invalid"}, {"kypo_base_url": "https://other.test"}):
            self.assert_bad("post", "/api/v1/challenges", self.sandbox_payload(**overrides))
        self.kypo_get.assert_not_called()
        self.kypo_get.side_effect = requests.Timeout()
        self.assert_bad("post", "/api/v1/challenges", self.sandbox_payload(), 503)
        self.assertEqual(Challenges.query.count(), 2)
        self.assertEqual(KypoChallengeConfig.query.count(), 0)

    def test_sandbox_valid_create_and_atomic_update(self):
        response = self.client.post("/api/v1/challenges", json=self.sandbox_payload())
        self.assertEqual(response.status_code, 200, response.get_json())
        challenge_id = response.get_json()["data"]["id"]
        config = KypoChallengeConfig.query.filter_by(challenge_id=challenge_id).one()
        self.assertEqual(config.kypo_instance_id, 10)
        self.assertEqual(config.kypo_base_url, "https://kypo.test")
        self.assertEqual(Challenges.query.get(challenge_id).time_limit, 60)
        self.kypo_get.return_value.status_code = 404
        self.assert_bad("patch", "/api/v1/challenges/" + str(challenge_id), {"name": "bad", "kypo_instance_id": 999999})
        self.assertEqual(Challenges.query.get(challenge_id).name, "sandbox")
        self.assertEqual(KypoChallengeConfig.query.filter_by(challenge_id=challenge_id).one().kypo_instance_id, 10)
        self.assert_bad("patch", "/api/v1/challenges/" + str(challenge_id), {"kypo_instance_id": None})
        self.kypo_get.side_effect = requests.ConnectionError()
        self.assert_bad("patch", "/api/v1/challenges/" + str(challenge_id), {"name": "bad", "kypo_instance_id": 11}, 503)
        self.kypo_get.reset_mock()
        self.assertEqual(self.client.patch("/api/v1/challenges/" + str(challenge_id), json={"description": "updated"}).status_code, 200)
        self.kypo_get.assert_not_called()

    def test_bracket_validation_and_public_legacy_filter(self):
        for data in ({"name": "", "type": "teams"}, {"name": None, "type": "teams"}, {"name": " ", "type": "teams"},
                     {"name": "valid", "type": "invalid"}, {"name": "valid"}, [], {"name": "x" * 256, "type": "teams"}):
            self.assert_bad("post", "/api/v1/brackets", data)
        response = self.client.post("/api/v1/brackets", json={"name": " Teams ", "type": "teams"})
        self.assertEqual(response.status_code, 200, response.get_json())
        record_id = response.get_json()["data"]["id"]
        self.assertEqual(Brackets.query.get(record_id).name, "Teams")
        for data in ({"name": None}, {"name": ""}, {"type": "invalid"}, []):
            self.assert_bad("patch", "/api/v1/brackets/" + str(record_id), data)
        self.assertEqual(self.client.patch("/api/v1/brackets/" + str(record_id), json={"description": "updated"}).status_code, 200)
        db.session.add_all([Brackets(id=90, name=None, type="teams"), Brackets(id=91, name="", type="teams"),
                            Brackets(id=92, name=" ", type="teams"), Brackets(id=93, name="Bad", type="invalid")])
        db.session.commit()
        self.assertEqual(len(self.client.get("/api/v1/brackets").get_json()["data"]), 5)
        self.login_as(2)
        self.assertEqual([row["id"] for row in self.client.get("/api/v1/brackets").get_json()["data"]], [record_id])
        self.assertEqual(Brackets.query.count(), 5)

    def test_challenge_state_and_type_errors_preserve_data(self):
        for key in ("state", "type"):
            for value in ("unsupported_type_xyz", "", None, [], 123):
                self.assert_bad("post", "/api/v1/challenges", {"name": "new", "category": "test", "type": "standard", "time_limit": -1, key: value})
                self.assert_bad("patch", "/api/v1/challenges/1", {"name": "bad", key: value})
        self.assertEqual(Challenges.query.count(), 2)
        self.assertEqual(Challenges.query.get(1).name, "standard")
        for value in ("hidden", "locked", "visible"):
            self.assertEqual(self.client.patch("/api/v1/challenges/1", json={"state": value}).status_code, 200)

    def test_config_whitelist_numeric_validation_and_atomicity(self):
        for data in ([], {"team_size": -5}, {"team_size": "abc"}, {"fake_config_xyz_123": "value"},
                     {"ctf_name": "bad", "team_size": -5}):
            self.assert_bad("patch", "/api/v1/configs", data)
        self.assertIsNone(Configs.query.filter_by(key="ctf_name").first())
        self.assertEqual(self.client.patch("/api/v1/configs", json={"team_size": 5, "ctf_name": "valid"}).status_code, 200)

    def test_case_insensitive_names_for_create_update_and_csv_import(self):
        self.assert_bad("post", "/api/v1/users", {"name": "RESET-TARGET", "email": "new@test.test", "password": "Pass!123"})
        self.assert_bad("patch", "/api/v1/users/3", {"name": "Reset-Target"})
        from CTFd.utils.csv import load_users_csv
        with self.app.test_request_context():
            from flask import session
            session["id"] = 1
            errors = load_users_csv(csv.DictReader(io.StringIO("name,email,password\nRESET-TARGET,new@test.test,Pass!123\n")))
        self.assertIsInstance(errors, list)
        self.assertEqual(Users.query.count(), 3)


if __name__ == "__main__":
    unittest.main()
