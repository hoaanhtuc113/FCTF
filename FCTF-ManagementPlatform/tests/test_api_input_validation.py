"""Invalid inputs must fail before writes; use an isolated SQLite database."""
import importlib
import io
import unittest
from unittest.mock import patch

import test_model_types as model_tests
from CTFd.models import Comments, Fields, Hints, Tags, Teams, Configs, Users, db
from CTFd.utils import uploads, set_config


class ApiInputValidationTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.app.config["HTML_SANITIZATION"] = True
        api = self.users_api.users_namespace.apis[-1]
        for name in ("tags", "hints", "comments", "config", "teams", "tokens", "awards", "submissions"):
            module = importlib.import_module("CTFd.api.v1." + name)
            namespace = getattr(module, "configs_namespace" if name == "config" else name + "_namespace")
            api.add_namespace(namespace, path="/api/v1/" + ("configs" if name == "config" else name))
            if hasattr(module, "log_audit"):
                self.mocks.enter_context(patch.object(module, "log_audit"))
        set_config("theme_settings", "{}")
        db.session.add_all([Tags(id=1, challenge_id=1, value="tag"),
                            Hints(id=1, challenge_id=1, content="hint", cost=0),
                            Teams(id=1, name="team", password="Pass!123"),
                            Comments(content="comment", author_id=1),
                            Fields(name="field", field_type="text")])
        db.session.commit()

    def assert_bad(self, method, url, payload, expected=400):
        response = getattr(self.client, method)(url, json=payload)
        self.assertEqual(response.status_code, expected, response.get_data(as_text=True))
        return response

    def test_user_bracket_and_team_references(self):
        for key in ("bracket_id", "team_id"):
            for value in (999999, "abc", True):
                with self.subTest(key=key, value=value):
                    self.assert_bad("patch", "/api/v1/users/2", {key: value})
        for key in ("team_id", "bracket_id"):
            self.assert_bad("post", "/api/v1/users", {"name": "new", "email": "new@test.test", "password": "Pass!123", key: 999999})
        self.assertEqual(Users.query.count(), 3)
        self.assertIsNone(Users.query.get(2).team_id)
        self.assertIsNone(Users.query.get(2).bracket_id)

    def test_related_resources_validate_references_before_writes(self):
        for resource, body in (("tags", {"value": "new"}), ("hints", {"content": "new", "cost": 0}), ("flags", {"content": "new", "type": "static"})):
            with self.subTest(resource=resource):
                self.assert_bad("post", "/api/v1/" + resource, {**body, "challenge_id": 999999})
                self.assert_bad("patch", "/api/v1/" + resource + "/1", {"challenge_id": 999999})
        for key in ("challenge_id", "user_id", "team_id"):
            with self.subTest(comment_target=key):
                self.assert_bad("post", "/api/v1/comments", {"content": "new", key: 999999})
        self.assertEqual(Tags.query.count(), 1)
        self.assertEqual(Hints.query.count(), 1)
        self.assertEqual(Comments.query.count(), 1)
        self.assertEqual(Tags.query.get(1).challenge_id, 1)
        self.assertEqual(Hints.query.get(1).challenge_id, 1)

    def test_user_fields_and_email_types(self):
        for value in ("bad", {}, ["bad"]):
            self.assert_bad("patch", "/api/v1/users/2", {"fields": value})
        self.assert_bad("post", "/api/v1/users/2/email", {"text": None})

    def test_team_captain_and_member_required(self):
        set_config("user_mode", "teams")
        self.assert_bad("post", "/api/v1/teams", {"name": "new-team", "password": "Pass!123", "captain_id": 999999})
        self.assert_bad("delete", "/api/v1/teams/1/members", {})

    def test_challenge_author_and_required_names(self):
        self.assert_bad("post", "/api/v1/challenges", {"name": "new", "category": "test", "type": "standard", "time_limit": -1, "user_id": 999999})
        self.assert_bad("patch", "/api/v1/challenges/1", {"name": None})
        self.assert_bad("post", "/api/v1/challenges", {"name": "new", "category": None, "type": "standard", "time_limit": -1})

    def test_hint_cost_and_required_body(self):
        for value in ("ten", None, [], True):
            self.assert_bad("patch", "/api/v1/hints/1", {"cost": value})
        self.assert_bad("post", "/api/v1/hints", {})
        self.assert_bad("post", "/api/v1/awards", {})

    def test_config_shape_types_and_atomicity(self):
        self.assert_bad("patch", "/api/v1/configs", [])
        self.assert_bad("patch", "/api/v1/configs/theme_settings", {"value": []})
        self.assert_bad("patch", "/api/v1/configs/theme_settings", {"value": {}})
        for value in (-1, "abc"):
            self.assert_bad("patch", "/api/v1/configs", {"team_size": value})
        self.assert_bad("patch", "/api/v1/configs", {"ctf_name": "changed", "team_size": -1})
        self.assertIsNone(Configs.query.filter_by(key="ctf_name").first())
        self.assert_bad("patch", "/api/v1/configs", {"fake_config_xyz_123": "value"})

    def test_list_endpoints_require_filters_and_unknown_flag_type(self):
        for resource in ("comments", "configs/fields"):
            response = self.client.get("/api/v1/" + resource)
            self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        for path in ("comments?type=challenge&challenge_id=1", "configs/fields?type=user", "configs/fields?type=team"):
            response = self.client.get("/api/v1/" + path)
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.client.get("/api/v1/flags/types/invalid").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/challenges/999999/deploy-duration").status_code, 404)

    def test_token_expiration_rejects_malformed_and_accepts_iso(self):
        for value in ("bad", "", [], True):
            self.assert_bad("post", "/api/v1/tokens", {"expiration": value})
        response = self.client.post("/api/v1/tokens", json={"expiration": "2099-01-01T00:00:00Z"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_invalid_upload_does_not_write_storage(self):
        with patch.object(uploads, "get_uploader") as uploader:
            response = self.client.post("/api/v1/files", data={"type": "challenge", "challenge_id": "999999", "file": (io.BytesIO(b"test"), "test.txt")})
            self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            uploader.assert_not_called()

    def test_invalid_submissions_and_awards(self):
        for resource, payload in (("submissions", {"user_id": 999999, "challenge_id": 1, "type": "correct"}), ("awards", {"user_id": 999999, "value": 10}), ("awards", {"user_id": 2, "team_id": 999999, "value": 10})):
            self.assert_bad("post", "/api/v1/" + resource, payload)
        self.assert_bad("post", "/api/v1/submissions", {"user_id": 2, "challenge_id": 1, "type": "unknown"})
        self.assert_bad("post", "/api/v1/submissions", [])
        self.assert_bad("post", "/api/v1/submissions", {"user_id": 2, "challenge_id": 999999, "type": "correct"}, expected=404)
        set_config("user_mode", "teams")
        self.assert_bad("post", "/api/v1/submissions", {"user_id": 2, "team_id": 999999, "challenge_id": 1, "type": "correct"})

    def test_invalid_json_shapes_return_controlled_errors(self):
        for resource in ("users", "tags", "hints", "comments", "configs/fields", "tokens"):
            self.assert_bad("post", "/api/v1/" + resource, [])
        for resource, record_id in (("users", 2), ("tags", 1), ("hints", 1), ("challenges", 1)):
            self.assert_bad("patch", "/api/v1/" + resource + "/" + str(record_id), [])

    def test_valid_resource_writes_still_work(self):
        for resource, payload in (("tags", {"challenge_id": 1, "value": "new"}),
                                  ("hints", {"challenge_id": 1, "content": "new", "cost": 0}),
                                  ("comments", {"type": "challenge", "challenge_id": 1, "content": "new"}),
                                  ("configs/fields", {"type": "user", "name": "School", "field_type": "text"})):
            with self.subTest(resource=resource):
                response = self.client.post("/api/v1/" + resource, json=payload)
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        for resource, payload in (("tags", {"value": "updated"}), ("hints", {"content": "updated", "cost": 10})):
            response = self.client.patch("/api/v1/" + resource + "/1", json=payload)
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        response = self.client.patch("/api/v1/configs", json={"team_size": "5", "ctf_name": "Competition", "contestant_registration_enabled": True, "nonce": "form-csrf-metadata"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(Configs.query.filter_by(key="team_size").first().value, "5")
        self.assertIsNone(Configs.query.filter_by(key="nonce").first())

    def test_comments_null_content_and_unsupported_field_types(self):
        self.assert_bad("post", "/api/v1/comments", {"content": None})
        self.assert_bad("post", "/api/v1/configs/fields", {"type": "ghost", "field_type": "text", "name": "bad"})
        self.assertEqual(self.client.get("/api/v1/configs/fields?type=ghost").status_code, 400)

    def test_admin_submission_filter_ids(self):
        from CTFd.admin.submissions import submissions_listing
        for key in ("user_id", "team_id", "challenge_id"):
            with self.app.test_request_context("/admin/submissions?" + key + "=abc"):
                from flask import session
                from CTFd.utils.security.signing import hmac
                from CTFd.models import Users
                session["id"] = 1
                session["hash"] = hmac(Users.query.get(1).password)
                result, status = submissions_listing(None)
                self.assertEqual(status, 400)
                self.assertFalse(result.get_json()["success"])


if __name__ == "__main__":
    unittest.main()
