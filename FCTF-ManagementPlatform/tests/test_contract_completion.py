"""Complete the selected config/team/username/award API contracts."""
import csv
import importlib
import importlib.util
import io
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from werkzeug.datastructures import MultiDict

import test_model_types as model_tests
from CTFd.models import Awards, Configs, Teams, Users, db
from CTFd.utils import set_config


class ContractCompletionTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.app.register_blueprint(self.admin.admin)
        api = self.users_api.users_namespace.apis[-1]
        for name in ("config", "awards", "teams"):
            module = importlib.import_module("CTFd.api.v1." + name)
            api.add_namespace(getattr(module, "configs_namespace" if name == "config" else name + "_namespace"),
                              path="/api/v1/" + ("configs" if name == "config" else name))
            self.mocks.enter_context(patch.object(module, "log_audit"))
        self.teams_api = importlib.import_module("CTFd.api.v1.teams")
        self.mocks.enter_context(patch.object(self.teams_api, "create_kypo_user", return_value={
            "kypo_user_id": "test", "kypo_username": "team-test", "kypo_password": "test-password"}))
        self.mocks.enter_context(patch.object(self.teams_api, "encrypt_kypo_password", return_value="encrypted-test"))
        self.mocks.enter_context(patch("CTFd.utils.config.get_themes", return_value=["core-beta"]))
        set_config("score_visibility", "public")

    def assert_bad(self, method, url, data, expected=400):
        response = getattr(self.client, method)(url, json=data)
        self.assertEqual(response.status_code, expected, response.get_data(as_text=True))
        return response

    def test_config_enums_types_bytes_and_admin_form_are_validated_atomically(self):
        for data in ({"score_visibility": "invalid"}, {"score_visibility": None}, {"challenge_visibility": "hidden"},
                     {"team_disbanding": "enabled"}, {"paused": "abc"}, {"mail_ssl": []}, {"ctf_name": 123},
                     {"ctf_theme": "unknown-theme"}, {"theme_settings": "null"}, {"mail_port": 65536},
                     {"ctf_description": "é" * 32768}):
            self.assert_bad("patch", "/api/v1/configs", data)
        for data in ({"ctf_name": "bad", "score_visibility": "invalid"}, {"ctf_name": "bad", "team_size": "-5"},
                     {"ctf_name": "bad", "fake_config": "invalid"}, {"ctf_name": "bad", "ctf_description": "é" * 32768}):
            response = self.client.post("/admin/config", data=data)
            self.assertEqual(response.status_code, 400)
            self.assertIsNone(Configs.query.filter_by(key="ctf_name").first())
        valid = self.client.post("/admin/config", data=MultiDict([
            ("ctf_name", "Valid"), ("mail_ssl", "false"), ("mail_ssl", "on"), ("score_visibility", "private")]))
        self.assertEqual(valid.status_code, 302)
        self.assertEqual(Configs.query.filter_by(key="mail_ssl").one().value, "true")
        response = self.client.patch("/api/v1/configs", json={"ctf_description": "é" * 32767 + "a", "paused": False})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(len(Configs.query.filter_by(key="ctf_description").one().value.encode()), 65535)
        self.assertEqual(Configs.query.filter_by(key="paused").one().value, "false")

    def test_create_team_with_valid_captain_attaches_member_and_rejects_stealing(self):
        set_config("user_mode", "teams")
        response = self.client.post("/api/v1/teams", json={"name": "New team", "password": "Pass!123", "captain_id": 2})
        self.assertEqual(response.status_code, 200, response.get_json())
        team_id = response.get_json()["data"]["id"]
        self.assertEqual(Users.query.get(2).team_id, team_id)
        self.assertEqual(Teams.query.get(team_id).captain_id, 2)
        self.assertEqual([user.id for user in Teams.query.get(team_id).members], [2])
        for captain_id in (2, 999999):
            self.assert_bad("post", "/api/v1/teams", {"name": "Bad team", "password": "Pass!123", "captain_id": captain_id})
        self.assertEqual(Teams.query.count(), 1)
        self.assert_bad("patch", "/api/v1/teams/" + str(team_id), {"captain_id": 3})
        self.assertEqual(Teams.query.get(team_id).captain_id, 2)

    def test_award_name_required_and_patch_changes_score_without_new_award(self):
        for name in (None, "", " ", 123, "x" * 81):
            self.assert_bad("post", "/api/v1/awards", {"name": name, "user_id": 2, "value": 10})
        response = self.client.post("/api/v1/awards", json={"name": " Bonus ", "user_id": 2, "value": 10},
                                    headers={"Idempotency-Key": "event"})
        self.assertEqual(response.status_code, 200, response.get_json())
        award_id = response.get_json()["data"]["id"]
        award = Awards.query.get(award_id)
        original = (award.date, award.request_key, award.request_hash)
        self.assertEqual(Users.query.get(2).get_score(admin=True), 10)
        update = self.client.patch("/api/v1/awards/" + str(award_id), json={"name": "Penalty", "value": -5, "description": "corrected"})
        self.assertEqual(update.status_code, 200, update.get_json())
        self.assertEqual(Awards.query.count(), 1)
        self.assertEqual(db.session.query(db.func.sum(Awards.value)).scalar(), -5)
        self.assertEqual(Users.query.get(2).get_score(admin=True), -5)
        self.assertEqual((award.date, award.request_key, award.request_hash), original)
        for data in ({"name": None}, {"name": " "}, {"value": True}, {"value": 2147483648}, {"user_id": 999999},
                     {"team_id": 999999}, {"type": "invalid"}, {"date": "2099-01-01"}, {"request_key": "other"}, []):
            self.assert_bad("patch", "/api/v1/awards/" + str(award_id), data)
            self.assertEqual(Awards.query.get(award_id).value, -5)
        self.assertEqual(self.client.patch("/api/v1/awards/999999", json={"value": 1}).status_code, 404)
        replay = self.client.post("/api/v1/awards", json={"name": "Bonus", "user_id": 2, "value": 10},
                                  headers={"Idempotency-Key": "event"})
        self.assertEqual(replay.get_json()["data"]["id"], award_id)
        self.assertEqual(Awards.query.get(award_id).value, -5)
        self.login_as(2)
        self.client.patch("/api/v1/awards/" + str(award_id), json={"value": 999})
        self.assertEqual(Awards.query.get(award_id).value, -5)

    def test_award_patch_in_team_mode_infers_team_and_rejects_mismatch(self):
        db.session.add_all([Teams(id=1, name="one"), Teams(id=2, name="two")])
        db.session.flush()
        Users.query.get(2).team_id = 1
        Users.query.get(3).team_id = 2
        db.session.add(Awards(id=1, name="Bonus", user_id=2, team_id=1, value=10))
        db.session.commit()
        set_config("user_mode", "teams")
        self.assert_bad("patch", "/api/v1/awards/1", {"user_id": 3, "team_id": 1})
        response = self.client.patch("/api/v1/awards/1", json={"user_id": 3})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Awards.query.get(1).team_id, 2)

    def test_username_db_constraint_catches_bypassed_validation_and_api_race(self):
        db.session.add(Users(name=" RESET-TARGET ", email="other@test.test", password="Pass!123"))
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        self.assertEqual(Users.query.count(), 3)
        from CTFd.schemas.users import UserSchema
        def skip_name_check(schema, data):
            return None
        skip_name_check.__marshmallow_kwargs__ = UserSchema.validate_name.__marshmallow_kwargs__
        with patch.object(UserSchema, "validate_name", new=skip_name_check):
            response = self.assert_bad("post", "/api/v1/users", {"name": "RESET-TARGET", "email": "other@test.test", "password": "Pass!123"})
            self.assertIn("name", response.get_json()["errors"])
            self.assert_bad("patch", "/api/v1/users/3", {"name": "RESET-TARGET", "password": "NewPass!123"})
        self.assertEqual(Users.query.count(), 3)
        self.assertNotIn("name_key", self.client.get("/api/v1/users/2").get_json()["data"])


class ContractMigrationTests(unittest.TestCase):
    def load_migration(self):
        path = Path(__file__).parents[1] / "migrations/versions/a6b7c8d9e0f1_user_names_award_names.py"
        spec = importlib.util.spec_from_file_location("contract_migration", path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def prepare(self, connection, duplicate=False, unnamed=False):
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(128))"))
        connection.execute(text("CREATE TABLE awards (id INTEGER PRIMARY KEY, name VARCHAR(80))"))
        connection.execute(text("INSERT INTO users VALUES (1, 'Alice'), (2, :name)"), {"name": " ALICE " if duplicate else "Bob"})
        connection.execute(text("INSERT INTO awards VALUES (1, :name)"), {"name": None if unnamed else "Bonus"})

    def test_migration_preserves_rows_and_enforces_constraints(self):
        engine = create_engine("sqlite://")
        with engine.begin() as connection:
            self.prepare(connection)
            module = self.load_migration()
            with patch.object(module, "op", Operations(MigrationContext.configure(connection))):
                module.upgrade()
                self.assertEqual(connection.execute(text("SELECT name_key FROM users ORDER BY id")).scalars().all(), ["alice", "bob"])
                with self.assertRaises(IntegrityError):
                    connection.execute(text("INSERT INTO users(id, name) VALUES (3, 'alice')"))
                with self.assertRaises(IntegrityError):
                    connection.execute(text("INSERT INTO awards VALUES (2, NULL)"))
                self.assertEqual(connection.execute(text("SELECT name FROM awards")).scalar(), "Bonus")
                module.downgrade()
                self.assertNotIn("name_key", [item["name"] for item in inspect(connection).get_columns("users")])
        engine.dispose()

    def test_migration_preflight_stops_before_schema_changes(self):
        for duplicate, unnamed in ((True, False), (False, True)):
            engine = create_engine("sqlite://")
            with engine.begin() as connection:
                self.prepare(connection, duplicate, unnamed)
                module = self.load_migration()
                with patch.object(module, "op", Operations(MigrationContext.configure(connection))):
                    with self.assertRaisesRegex(RuntimeError, "Repair legacy rows"):
                        module.upgrade()
                self.assertNotIn("name_key", [item["name"] for item in inspect(connection).get_columns("users")])
                self.assertTrue(inspect(connection).get_columns("awards")[1]["nullable"])
            engine.dispose()

    def test_concurrent_username_inserts_after_same_empty_precheck(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine("sqlite:///" + str(Path(directory) / "race.sqlite"))
            with engine.begin() as connection:
                self.prepare(connection)
                module = self.load_migration()
                with patch.object(module, "op", Operations(MigrationContext.configure(connection))):
                    module.upgrade()
            barrier = threading.Barrier(2)
            def create(name):
                with engine.connect() as connection:
                    count = connection.execute(text("SELECT COUNT(*) FROM users WHERE name_key='race'")).scalar()
                    self.assertEqual(count, 0)
                    barrier.wait(timeout=10)
                    try:
                        connection.execute(text("INSERT INTO users(name) VALUES (:name)"), {"name": name})
                        return "created"
                    except IntegrityError:
                        return "duplicate"
            with ThreadPoolExecutor(max_workers=2) as workers:
                results = list(workers.map(create, ("Race", " RACE ")))
            self.assertCountEqual(results, ["created", "duplicate"])
            with engine.connect() as connection:
                self.assertEqual(connection.execute(text("SELECT COUNT(*) FROM users WHERE name_key='race'")).scalar(), 1)
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
