"""Password/token regression tests using an isolated in-memory database.

Run from FCTF-ManagementPlatform:
    python -m unittest discover -s tests -p test_password_token_revocation.py -v
"""

import csv
import datetime
import importlib
import io
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from flask import Flask, jsonify
from flask_restx import Api

from CTFd.cache import cache
from CTFd.exceptions import UserNotFoundException
from CTFd.models import Admins, Users, UserTokens, db, ma
from CTFd.utils.crypto import verify_password
from CTFd.utils.security.auth import (
    generate_user_token,
    lookup_user_token,
    revoke_user_tokens,
)
from CTFd.utils.security.signing import hmac, serialize


class PasswordTokenRevocationTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            SECRET_KEY="isolated-password-tests",
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            CACHE_TYPE="SimpleCache",
            TRUSTED_PROXIES=[],
        )
        db.init_app(self.app)
        ma.init_app(self.app)
        cache.init_app(self.app)
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.addCleanup(self.clean_database)
        db.create_all()

        self.auth = importlib.import_module("CTFd.auth")
        self.admin = importlib.import_module("CTFd.admin")
        self.users_api = importlib.import_module("CTFd.api.v1.users")
        self.app.register_blueprint(self.auth.auth)
        api = Api(self.app)
        api.add_namespace(self.users_api.users_namespace, path="/api/v1/users")
        self.client = self.app.test_client()

        self.mocks = ExitStack()
        self.addCleanup(self.mocks.close)
        for module, names in (
            (self.users_api, ["clear_standings", "clear_challenges", "log_audit"]),
            (self.admin, ["log_audit"]),
            (self.auth, ["log"]),
        ):
            for name in names:
                self.mocks.enter_context(patch.object(module, name))
        self.mocks.enter_context(
            patch.object(self.auth.config, "can_send_mail", return_value=True)
        )
        self.mocks.enter_context(patch.object(self.auth.email, "password_change_alert"))
        self.mocks.enter_context(
            patch.object(
                self.auth, "render_template",
                side_effect=lambda template, **kwargs: jsonify(kwargs),
            )
        )
        self.cache_clears = {}
        for module in (self.users_api, self.admin, self.auth):
            self.cache_clears[module.__name__] = self.mocks.enter_context(
                patch.object(module, "clear_auth_cache")
            )

        self.original_password = "OriginalPass!123"
        db.session.add_all([
            Admins(id=1, name="admin", email="admin@example.test",
                   password=self.original_password),
            Users(id=2, name="reset-target", email="target@example.test",
                  password=self.original_password),
            Users(id=3, name="unaffected", email="other@example.test",
                  password=self.original_password),
        ])
        db.session.commit()
        for user_id in (1, 2, 3):
            db.session.add(UserTokens(
                user_id=user_id,
                value=f"ctfd_test_{user_id}",
                expiration=datetime.datetime.utcnow() + datetime.timedelta(days=1),
            ))
        # Include a second session/token for the account being reset.
        db.session.add(UserTokens(user_id=2, value="second_session"))
        db.session.commit()

    def clean_database(self):
        db.session.remove()
        db.drop_all()

    def login_as(self, user_id):
        user = Users.query.get(user_id)
        with self.client.session_transaction() as session:
            session["id"] = user_id
            session["hash"] = hmac(user.password)

    def assert_revoked(self, user_id=2):
        self.assertEqual(UserTokens.query.filter_by(user_id=user_id).count(), 0)
        with self.assertRaises(UserNotFoundException):
            lookup_user_token(f"ctfd_test_{user_id}")
        self.assertEqual(lookup_user_token("ctfd_test_3").id, 3)

    def test_filtered_bulk_reset_revokes_only_reset_accounts(self):
        output = self.admin.dump_csv_with_passwords(field="name", q="reset-target")
        records = list(csv.DictReader(io.StringIO(output.getvalue().decode())))
        self.assertEqual(len(records), 1)
        self.assertTrue(verify_password(
            records[0]["password_plain"], Users.query.get(2).password
        ))
        self.assert_revoked()
        self.assertEqual(lookup_user_token("ctfd_test_1").id, 1)
        self.cache_clears[self.admin.__name__].assert_called_once_with(user_id=2)

    def test_bulk_reset_with_no_matches_preserves_tokens(self):
        self.admin.dump_csv_with_passwords(field="name", q="does-not-exist")
        self.assertEqual(UserTokens.query.count(), 4)
        self.cache_clears[self.admin.__name__].assert_not_called()

    def test_password_and_revocation_rollback_together(self):
        user = Users.query.get(2)
        previous_hash = user.password
        user.password = "ChangedPass!456"
        revoke_user_tokens([2])
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 0)
        db.session.rollback()
        self.assertEqual(Users.query.get(2).password, previous_hash)
        self.assertEqual(lookup_user_token("ctfd_test_2").id, 2)
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)

    def test_email_reset_revokes_all_old_tokens_and_allows_fresh_token(self):
        reset_link = serialize("target@example.test")
        response = self.client.post(
            f"/reset_password/{reset_link}", data={"password": "NewPassword!456"}
        )
        self.assertEqual(response.status_code, 302)
        self.assert_revoked()
        self.assertTrue(verify_password("NewPassword!456", Users.query.get(2).password))
        self.cache_clears[self.auth.__name__].assert_called_once_with(user_id=2)
        fresh_token = generate_user_token(Users.query.get(2))
        self.assertEqual(lookup_user_token(fresh_token.value).id, 2)

    def test_failed_email_reset_keeps_password_and_tokens(self):
        reset_link = serialize("target@example.test")
        response = self.client.post(f"/reset_password/{reset_link}", data={"password": ""})
        self.assertEqual(response.status_code, 200)
        self.assertIn("errors", response.get_json())
        self.assertTrue(verify_password(self.original_password, Users.query.get(2).password))
        self.assertEqual(lookup_user_token("ctfd_test_2").id, 2)
        self.cache_clears[self.auth.__name__].assert_not_called()

    def test_admin_password_change_revokes_tokens(self):
        self.login_as(1)
        response = self.client.patch("/api/v1/users/2", json={"password": "NewPassword!456"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assert_revoked()

    def test_admin_profile_edit_preserves_tokens(self):
        self.login_as(1)
        response = self.client.patch("/api/v1/users/2", json={"name": "renamed-target"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(lookup_user_token("ctfd_test_2").id, 2)
        self.assertEqual(UserTokens.query.filter_by(user_id=2).count(), 2)

    def test_admin_ban_still_revokes_tokens(self):
        self.login_as(1)
        response = self.client.patch("/api/v1/users/2", json={"banned": True})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assert_revoked()

    def test_invalid_admin_edit_preserves_tokens(self):
        self.login_as(1)
        response = self.client.patch("/api/v1/users/2", json={"email": "not-an-email"})
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(lookup_user_token("ctfd_test_2").id, 2)

    def test_self_password_change_revokes_tokens(self):
        self.login_as(2)
        response = self.client.patch("/api/v1/users/me", json={
            "password": "NewPassword!456", "confirm": self.original_password,
        })
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assert_revoked()
        self.cache_clears[self.users_api.__name__].assert_called_once_with(user_id=2)

    def test_wrong_current_password_preserves_tokens(self):
        self.login_as(2)
        response = self.client.patch("/api/v1/users/me", json={
            "password": "NewPassword!456", "confirm": "WrongPassword!123",
        })
        self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(lookup_user_token("ctfd_test_2").id, 2)
        self.assertTrue(verify_password(self.original_password, Users.query.get(2).password))
        self.cache_clears[self.users_api.__name__].assert_not_called()

    def test_profile_password_change_revokes_tokens(self):
        self.login_as(2)
        response = self.client.patch("/api/v1/users/profile", json={"params": {
            "password": "NewPassword!456", "confirm": self.original_password,
        }})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assert_revoked()


if __name__ == "__main__":
    unittest.main()
