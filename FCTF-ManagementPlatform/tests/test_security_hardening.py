import io
import json
import unittest
from unittest.mock import patch

from flask import Flask, render_template_string
from sqlalchemy.exc import IntegrityError

import test_model_types as model_tests
from CTFd.models import ActionLogs, Flags, Users, UserTokens
from CTFd.utils.security.responses import init_response_security
from CTFd.utils.crypto import verify_password


class ManagementSecurityTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.app.register_blueprint(self.admin.admin)
        self.app.config["CORS_ALLOWED_ORIGINS"] = ["https://trusted.example"]
        init_response_security(self.app)
        with self.client.session_transaction() as session:
            session["nonce"] = "test-nonce"

    def test_get_cannot_reset_passwords(self):
        with patch.object(self.admin, "dump_csv_with_passwords") as reset:
            response = self.client.get("/admin/export/csv/user?include_passwords=1")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.client.get("/admin/users/reset-passwords").status_code, 405)
            reset.assert_not_called()
        self.assertTrue(verify_password(self.original_password, Users.query.get(2).password))
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)

    def test_reset_post_requires_csrf_and_admin(self):
        for nonce in (None, "wrong"):
            with patch.object(self.admin, "dump_csv_with_passwords") as reset:
                response = self.client.post("/admin/users/reset-passwords", json={},
                                            headers={"CSRF-Token": nonce} if nonce else {})
                self.assertEqual(response.status_code, 403)
                reset.assert_not_called()
        self.login_as(2)
        with patch.object(self.admin, "dump_csv_with_passwords") as reset:
            response = self.client.post("/admin/users/reset-passwords", json={}, headers={"CSRF-Token":"test-nonce"})
            self.assertEqual(response.status_code, 403)
            reset.assert_not_called()

    def test_reset_post_honors_filter_and_revokes_only_target(self):
        response = self.client.post("/admin/users/reset-passwords", json={"field":"name", "q":"reset-target"},
                                    headers={"CSRF-Token":"test-nonce"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIn("password_plain", response.get_data(as_text=True))
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 0)
        self.assertEqual(UserTokens.query.filter_by(user_id=3).count(), 1)
        self.assertFalse(verify_password(self.original_password, Users.query.get(2).password))
        self.assertTrue(verify_password(self.original_password, Users.query.get(3).password))
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_bad_reset_filter_cannot_fall_back_to_all_users(self):
        for payload in (None, [], {"q":"target"}, {"field":"bad", "q":"target"}, {"field":"name", "q":12}):
            with patch.object(self.admin, "dump_csv_with_passwords") as reset:
                response = self.client.post("/admin/users/reset-passwords", data=json.dumps(payload),
                                            content_type="application/json", headers={"CSRF-Token":"test-nonce"})
                self.assertEqual(response.status_code, 400)
                reset.assert_not_called()

    def test_flag_foreign_key_errors_do_not_expose_sql(self):
        response = self.client.post("/api/v1/flags", json={"type":"static", "content":"test", "challenge_id":999999})
        self.assertEqual(response.status_code, 400)
        response = self.client.patch("/api/v1/flags/1", json={"challenge_id":999999})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Flags.query.get(1).challenge_id, 1)
        self.assertNotIn("INSERT", response.get_data(as_text=True))

    def test_driver_errors_are_logged_but_not_returned(self):
        error = IntegrityError("INSERT INTO ctfd.flags SECRET_SQL", {}, Exception("SECRET_DRIVER"))
        for method, path, payload in (("post", "/api/v1/flags", {"type":"static", "content":"test", "challenge_id":1}),
                                      ("patch", "/api/v1/flags/1", {"content":"updated"})):
            with patch("CTFd.api.v1.flags.db.session.commit", side_effect=error), patch.object(self.app.logger, "exception") as logged:
                response = getattr(self.client, method)(path, json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("SECRET", response.get_data(as_text=True))
                logged.assert_called_once()
        self.assertEqual(Flags.query.get(1).content, "FLAG{test}")

    def test_client_cannot_create_activity_logs(self):
        import CTFd.api.v1.action_logs as action_api
        api = self.users_api.users_namespace.apis[-1]
        api.add_namespace(action_api.action_logs_namespace, path="/api/v1/action_logs")
        self.login_as(2)
        response = self.client.post("/api/v1/action_logs", json={
            "actionType":99999, "actionDetail":"fake", "challenge_id":1,
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(ActionLogs.query.count(), 0)

    def test_cors_allows_only_explicit_origin_even_preflight(self):
        for method in ("get", "options"):
            for origin, expected in (("https://trusted.example", True), ("https://evil.example", False),
                                      ("https://trusted.example.evil", False), ("null", False)):
                response = getattr(self.client, method)("/api/v1/flags", headers={"Origin":origin})
                self.assertEqual("Access-Control-Allow-Origin" in response.headers, expected)
                self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
                if expected:
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)

    def test_security_headers_cover_admin_and_api_errors(self):
        for path in ("/admin/export/csv/user?include_passwords=1", "/api/v1/flags/999999"):
            response = self.client.get(path)
            for name in ("Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options",
                         "Referrer-Policy", "Permissions-Policy"):
                self.assertIn(name, response.headers)
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertIn("private", response.headers["Cache-Control"])
            self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
            self.assertIn("frame-ancestors 'self'", response.headers["Content-Security-Policy"])

    def test_ajax_nonce_requires_session_csrf_and_is_not_read_from_url(self):
        supplied = "a" * 32
        for csrf in (None, "wrong", "test-nonce"):
            headers = {"CSP-Nonce": supplied}
            if csrf:
                headers["CSRF-Token"] = csrf
            response = self.client.get("/api/v1/flags", headers=headers)
            policy = response.headers["Content-Security-Policy"]
            self.assertEqual("'nonce-" + supplied + "'" in policy, csrf == "test-nonce")
        response = self.client.get("/api/v1/flags?CSP-Nonce=" + supplied,
                                    headers={"CSRF-Token":"test-nonce"})
        self.assertNotIn("'nonce-" + supplied + "'", response.headers["Content-Security-Policy"])

    def test_csp_nonces_trusted_template_scripts_only(self):
        @self.app.get("/nonce-test")
        def page():
            return render_template_string('<script>window.test=1;</script>{{ untrusted|safe }}',
                                          untrusted='<script>window.evil=1;</script>')
        responses = [self.client.get("/nonce-test") for _ in range(2)]
        nonces = []
        for response in responses:
            policy = response.headers["Content-Security-Policy"]
            nonce = policy.split("'nonce-")[1].split("'")[0]
            nonces.append(nonce)
            html = response.get_data(as_text=True)
            self.assertIn('<script nonce="' + nonce + '">window.test=1;', html)
            self.assertIn('<script>window.evil=1;', html)
        self.assertNotEqual(*nonces)


if __name__ == "__main__":
    unittest.main()
