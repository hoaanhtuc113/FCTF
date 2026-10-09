import io
import unittest
from pathlib import Path
from unittest.mock import patch

from werkzeug.datastructures import FileStorage

import test_model_types as model_tests
from CTFd.cache import cache
from CTFd.models import Teams, Users, Files
from CTFd.schemas.teams import TeamSchema
from CTFd.utils import uploads
from CTFd.utils.security import login_limit
from CTFd.utils.validators.uploads import validate_upload_filename


class SecurityInputTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        cache.clear()

    def test_empty_passwords_do_not_create_or_change_users_and_teams(self):
        for password in ("", "   ", None):
            response = self.client.post("/api/v1/users", json={
                "name": "new-user", "email": "new@example.test", "password": password,
            })
            self.assertEqual(response.status_code, 400, response.get_json())
            response = self.client.patch("/api/v1/users/2", json={"password": password})
            self.assertEqual(response.status_code, 400, response.get_json())
            with self.app.test_request_context():
                with patch("CTFd.schemas.teams.is_admin", return_value=True):
                    result = TeamSchema("admin").load({"name": "new-team", "password": password})
            self.assertTrue(result.errors)
        self.assertEqual(Users.query.count(), 3)
        self.assertEqual(Teams.query.count(), 0)

    def test_username_validation_and_case_insensitive_collisions(self):
        for name in ("<script>alert(1)</script>", " \t ", "bad\x00name", "RESET-TARGET", " ADMIN ", 123):
            response = self.client.post("/api/v1/users", json={
                "name": name, "email": "new@example.test", "password": "NewPass!123",
            })
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertIn("name", response.get_json()["errors"])
        self.assertEqual(Users.query.count(), 3)
        response = self.client.post("/api/v1/users", json={
            "id": 2, "name": "RESET-TARGET", "email": "new@example.test", "password": "NewPass!123",
        })
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(self.client.patch("/api/v1/users/3", json={"name": "Reset-Target"}).status_code, 400)
        response = self.client.patch("/api/v1/users/2", json={"name": " RESET-TARGET "})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Users.query.get(2).name, "RESET-TARGET")

    def test_upload_rejects_whole_batch_before_writing(self):
        with patch.object(self.files_api.uploads, "upload_file") as upload:
            response = self.client.post("/api/v1/files", data={"file": [
                (io.BytesIO(b"safe"), "safe.txt"),
                (io.BytesIO(b"<script>alert(1)</script>"), "xss.HTML"),
            ]}, content_type="multipart/form-data")
            self.assertEqual(response.status_code, 400, response.get_json())
            upload.assert_not_called()
        self.assertEqual(Files.query.count(), 1)

    def test_upload_central_validation_cannot_be_bypassed_by_location(self):
        file = FileStorage(stream=io.BytesIO(b"test"), filename="safe.txt")
        with patch.object(uploads, "get_uploader") as uploader:
            for kwargs in ({"file": FileStorage(stream=io.BytesIO(b"test"), filename="xss.svg")},
                           {"file": file, "location": "directory/xss.html"}):
                with self.assertRaises(ValueError):
                    uploads.upload_file(**kwargs)
            uploader.assert_not_called()
        for name in ("artifact.ZIP", "source.py", "capture.pcapng", "favicon.png", "challenge.elf"):
            validate_upload_filename(name)
        self.app.config["UPLOAD_ALLOWED_EXTENSIONS"] = "txt,zip"
        with self.assertRaises(ValueError):
            validate_upload_filename("picture.png")

    def test_login_account_budget_survives_changes_in_client_ip_and_case(self):
        with self.client.session_transaction() as session:
            session.clear()
        for i in range(5):
            response = self.client.post("/login", data={"name": " RESET-TARGET ", "password": "wrong"},
                                        environ_overrides={"REMOTE_ADDR": f"192.0.2.{i+1}"})
            self.assertEqual(response.status_code, 200)
        response = self.client.post("/login", data={"name": "reset-target", "password": "wrong"},
                                    environ_overrides={"REMOTE_ADDR": "192.0.2.99"})
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response.headers["Retry-After"]), 0)
        alias = self.client.post("/login", data={"name": "target@example.test", "password": "wrong"},
                                 environ_overrides={"REMOTE_ADDR": "192.0.2.100"})
        self.assertEqual(alias.status_code, 429)
        other = self.client.post("/login", data={"name": "unaffected", "password": "wrong"})
        self.assertEqual(other.status_code, 200)
        self.assertEqual(self.client.get("/login").status_code, 200)

    def test_login_ip_budget_and_fixed_window(self):
        with patch.object(login_limit.time, "time", return_value=1000):
            self.assertEqual(login_limit.consume_login_budget("account:test"), (1, 300))
        with patch.object(login_limit.time, "time", return_value=1005):
            self.assertEqual(login_limit.consume_login_budget("account:test"), (2, 295))
        with patch.object(login_limit.time, "time", return_value=1301):
            self.assertEqual(login_limit.consume_login_budget("account:test"), (1, 300))
        for i in range(20):
            self.assertEqual(self.client.post("/login", data={"name": f"unknown-{i}", "password": "wrong"}).status_code, 200)
        self.assertEqual(self.client.post("/login", data={"name": "another", "password": "wrong"}).status_code, 429)

    def test_login_denies_on_limiter_failure(self):
        with patch.object(login_limit, "consume_login_budget", side_effect=RuntimeError("unavailable")):
            response = self.client.post("/login", data={"name": "admin", "password": self.original_password})
        self.assertEqual(response.status_code, 503)


class RedisAclTests(unittest.TestCase):
    def test_both_manifests_allow_gateway_checks_stop_and_login_scripts(self):
        root = Path(__file__).resolve().parents[2]
        for filename in ("redis-acl-file-secret.yaml", "redis-acl-users-secret.yaml"):
            text = (root / "FCTF-k3s-manifest/prod/env/secret" / filename).read_text(encoding="utf-8")
            users = {line.split()[1]: line.split()[2:] for line in text.splitlines()
                     if line.strip().startswith("user ")}
            self.assertIn("%R~deploy_challenge_*", users["svc_gateway"])
            for name in ("svc_contestant_be", "svc_deployment_center", "svc_deployment_consumer", "svc_deployment_listener"):
                self.assertIn("~fctf:gateway:revoked:*", users[name])
                self.assertIn("+eval", users[name])
            self.assertIn("+eval", users["svc_admin_mvc"])
