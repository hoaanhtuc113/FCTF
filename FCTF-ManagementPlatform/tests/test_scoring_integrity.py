"""Score mutations on an isolated relational database; no production services."""

import importlib
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import request
from sqlalchemy.exc import IntegrityError

import test_model_types as model_tests
from CTFd.models import Awards, Challenges, Fails, Solves, Submissions, Teams, Users, db
from CTFd.plugins.challenges import BaseChallenge
from CTFd.plugins.dynamic_challenges import DynamicChallenge, DynamicValueChallenge
from CTFd.plugins.dynamic_challenges import decay
from CTFd.utils import set_config
from CTFd.utils.validators.scoring import ScoringValidationError


class ScoringIntegrityTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.awards_api = importlib.import_module("CTFd.api.v1.awards")
        self.submissions_api = importlib.import_module("CTFd.api.v1.submissions")
        api = self.users_api.users_namespace.apis[-1]
        api.add_namespace(self.awards_api.awards_namespace, path="/api/v1/awards")
        api.add_namespace(self.submissions_api.submissions_namespace, path="/api/v1/submissions")
        for module in (self.awards_api, self.submissions_api):
            for name in ("log_audit", "clear_standings", "clear_challenges", "redis_client"):
                if hasattr(module, name):
                    self.mocks.enter_context(patch.object(module, name))
        dynamic = DynamicChallenge.query.get(2)
        dynamic.function = "linear"
        dynamic.decay = 10
        db.session.commit()

    def submit(self, user_id, challenge_id=2, submission_type="correct", **extra):
        return self.client.post("/api/v1/submissions", json={
            "user_id": user_id, "challenge_id": challenge_id, "type": submission_type,
            "provided": "FLAG{test}", **extra,
        })

    def value(self):
        db.session.expire_all()
        return Challenges.query.get(2).value

    def test_challenge_scores_reject_negative_fractional_null_boolean_and_overflow(self):
        for value in (-1, 1.5, True, None, "1.5", 2147483648):
            with self.subTest(value=value):
                r = self.client.patch("/api/v1/challenges/1", json={"value": value})
                self.assertEqual(r.status_code, 400, r.get_json())
                self.assertEqual(Challenges.query.get(1).value, 100)
                r = self.client.post("/api/v1/challenges", json={
                    "name": "bad", "category": "test", "type": "standard", "value": value,
                    "time_limit": -1,
                })
                self.assertEqual(r.status_code, 400, r.get_json())
        r = self.client.patch("/api/v1/challenges/1", json={"value": 0})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(Challenges.query.get(1).value, 0)

    def test_invalid_dynamic_create_partial_update_and_conversion_are_atomic(self):
        for fields in ({"minimum": 101}, {"initial": 9}, {"decay": 0}, {"decay": -1},
                       {"initial": 3.5}, {"minimum": None}, {"function": "unknown"}):
            with self.subTest(fields=fields):
                r = self.client.patch("/api/v1/challenges/2", json=fields)
                self.assertEqual(r.status_code, 400, r.get_json())
                self.assertEqual(self.value(), 100)
                r = self.client.patch("/api/v1/challenges/1", json={
                    "scoring-type-radio": "dynamic", "initial": 100, "minimum": 10, "decay": 10,
                    **fields,
                })
                self.assertEqual(r.status_code, 400, r.get_json())
                self.assertEqual(Challenges.query.get(1).type, "standard")
                self.assertIsNone(DynamicChallenge.query.get(1))
                r = self.client.post("/api/v1/challenges", json={
                    "name": "bad", "category": "test", "type": "dynamic", "time_limit": -1,
                    "initial": 100, "minimum": 10, "decay": 10, **fields,
                })
                self.assertEqual(r.status_code, 400, r.get_json())
        self.assertEqual(Challenges.query.count(), 2)

    def test_model_and_plugin_guards_cover_non_api_writers(self):
        with self.assertRaises(ScoringValidationError):
            Challenges(name="bad", value=-1)
        with self.assertRaises(ScoringValidationError):
            DynamicChallenge(initial=100, minimum=200, decay=1)
        with self.app.test_request_context(json={"type": "standard", "value": -1, "time_limit": -1}):
            with self.assertRaises(ScoringValidationError):
                BaseChallenge.create(request)
        self.assertEqual(Challenges.query.count(), 2)

    def test_csv_import_validates_scores_and_preserves_type(self):
        from CTFd.utils.csv import load_challenges_csv
        import csv
        errors = load_challenges_csv(csv.DictReader(io.StringIO(
            "name,category,type,value,time_limit,user_id\nbad,test,standard,-10,-1,1\nok,test,standard,0,-1,1\n"
        )))
        self.assertEqual(len(errors), 1)
        self.assertIsNotNone(Challenges.query.filter_by(name="ok", value=0).first())
        self.assertIsNone(Challenges.query.filter_by(name="bad").first())

    def test_award_replay_adds_score_once(self):
        payload = {"user_id": 2, "name": "bonus", "value": 100}
        first = self.client.post("/api/v1/awards", json=payload)
        second = self.client.post("/api/v1/awards", json=payload)
        self.assertEqual(first.status_code, 200, first.get_json())
        self.assertEqual(second.get_json()["data"]["id"], first.get_json()["data"]["id"])
        self.assertEqual(Awards.query.count(), 1)
        self.assertEqual(db.session.query(db.func.sum(Awards.value)).scalar(), 100)
        self.assertNotIn("request_key", first.get_json()["data"])

    def test_award_keys_distinguish_events_and_reject_conflicting_payloads(self):
        payload = {"user_id": 2, "name": "bonus", "value": 100}
        for key in ("event-1", "event-2"):
            first = self.client.post("/api/v1/awards", json=payload, headers={"Idempotency-Key": key})
            replay = self.client.post("/api/v1/awards", json=payload, headers={"Idempotency-Key": key})
            self.assertEqual(first.status_code, 200, first.get_json())
            self.assertEqual(first.get_json()["data"]["id"], replay.get_json()["data"]["id"])
        conflict = self.client.post("/api/v1/awards", json={**payload, "value": 999},
                                    headers={"Idempotency-Key": "event-1"})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(Awards.query.count(), 2)
        self.assertEqual(db.session.query(db.func.sum(Awards.value)).scalar(), 200)

    def test_award_database_constraint_handles_competing_inserts(self):
        db.session.add(Awards(user_id=2, name="bonus", value=100, request_key="same"))
        db.session.commit()
        db.session.add(Awards(user_id=2, name="bonus", value=100, request_key="same"))
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        self.assertEqual(Awards.query.count(), 1)

    def test_award_losing_insert_returns_the_winning_award(self):
        from flask_sqlalchemy import BaseQuery

        payload = {"user_id": 2, "name": "bonus", "value": 100}
        first = self.client.post("/api/v1/awards", json=payload,
                                 headers={"Idempotency-Key": "race-event"})
        real_first = BaseQuery.first
        missed = []

        def stale_lookup(query):
            if query.column_descriptions[0].get("entity") is Awards and not missed:
                missed.append(True)
                return None
            return real_first(query)

        # Miss the pre-check as a losing concurrent request would. The real
        # unique index rejects its insert; rollback then fetches the winner.
        with patch.object(BaseQuery, "first", stale_lookup):
            loser = self.client.post("/api/v1/awards", json=payload,
                                     headers={"Idempotency-Key": "race-event"})
        self.assertEqual(loser.status_code, 200, loser.get_json())
        self.assertEqual(loser.get_json()["data"]["id"], first.get_json()["data"]["id"])
        self.assertEqual(Awards.query.count(), 1)

    def test_negative_awards_remain_valid_and_fractional_awards_are_rejected(self):
        r = self.client.post("/api/v1/awards", json={"user_id": 2, "name": "hint", "value": -10})
        self.assertEqual(r.status_code, 200, r.get_json())
        r = self.client.post("/api/v1/awards", json={"user_id": 2, "name": "bad", "value": 0.5})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Awards.query.count(), 1)

    def test_admin_duplicate_solve_and_repeat_correct_patch_do_not_double_score(self):
        first = self.submit(2)
        self.assertEqual(first.status_code, 200, first.get_json())
        duplicate = self.submit(2)
        self.assertEqual(duplicate.status_code, 409, duplicate.get_json())
        sid = first.get_json()["data"]["id"]
        for _ in range(2):
            r = self.client.patch(f"/api/v1/submissions/{sid}", json={"type": "correct"})
            self.assertEqual(r.status_code, 200, r.get_json())
            self.assertEqual(r.get_json()["data"]["id"], sid)
        self.assertEqual(Solves.query.count(), 1)
        self.assertEqual(self.value(), 100)

    def test_dynamic_score_recalculates_on_admin_create_retype_and_delete(self):
        first = self.submit(2).get_json()["data"]["id"]
        second = self.submit(3).get_json()["data"]["id"]
        self.assertEqual(self.value(), 90)
        r = self.client.patch(f"/api/v1/submissions/{second}", json={"type": "incorrect"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["data"]["id"], second)
        self.assertEqual(self.value(), 100)
        r = self.client.patch(f"/api/v1/submissions/{second}", json={"type": "correct"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.value(), 90)
        r = self.client.delete(f"/api/v1/submissions/{first}")
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.value(), 100)

    def test_failed_recalculation_rolls_back_solve_creation_retype_and_delete(self):
        first = self.submit(2).get_json()["data"]["id"]
        wrong = self.submit(3, submission_type="incorrect").get_json()["data"]["id"]
        with patch.object(DynamicValueChallenge, "calculate_value", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                self.submit(3)
            with self.assertRaises(RuntimeError):
                self.client.patch(f"/api/v1/submissions/{wrong}", json={"type": "correct"})
            with self.assertRaises(RuntimeError):
                self.client.delete(f"/api/v1/submissions/{first}")
        self.assertEqual(Solves.query.count(), 1)
        self.assertEqual(Submissions.query.get(wrong).type, "incorrect")
        self.assertIsNotNone(Solves.query.get(first))
        self.assertEqual(self.value(), 100)

    def test_plugin_duplicate_and_recalculation_failure_are_atomic(self):
        user = Users.query.get(2)
        with self.app.test_request_context(json={"submission": "FLAG{test}"},
                                          environ_base={"REMOTE_ADDR": "127.0.0.1"}):
            challenge = Challenges.query.get(2)
            self.assertTrue(DynamicValueChallenge.solve(user, None, challenge, request))
            self.assertFalse(DynamicValueChallenge.solve(user, None, challenge, request))
            with patch.object(DynamicValueChallenge, "calculate_value", side_effect=RuntimeError("failed")):
                with self.assertRaises(RuntimeError):
                    DynamicValueChallenge.solve(Users.query.get(3), None, challenge, request)
        self.assertEqual(Solves.query.count(), 1)
        self.assertEqual(self.value(), 100)

    def test_team_mode_requires_owner_and_counts_team_visibility(self):
        set_config("user_mode", "teams")
        db.session.add_all([Teams(id=1, name="visible"), Teams(id=2, name="hidden", hidden=True)])
        Users.query.get(2).team_id = 1
        Users.query.get(2).hidden = True
        Users.query.get(3).team_id = 2
        db.session.commit()
        r = self.submit(1)
        self.assertEqual(r.status_code, 400, r.get_json())
        r = self.submit(2, team_id=2)
        self.assertEqual(r.status_code, 400, r.get_json())
        self.assertEqual(self.submit(2).status_code, 200)
        self.assertEqual(self.submit(3).status_code, 200)
        self.assertEqual(self.value(), 100)

    def test_dynamic_formula_stays_between_minimum_and_initial(self):
        challenge = SimpleNamespace(initial=100, minimum=10, decay=10)
        for count in (0, 1, 2, 1000000, 2147483647):
            with patch.object(decay, "get_solve_count", return_value=count):
                for function in (decay.linear, decay.logarithmic):
                    self.assertTrue(10 <= function(challenge) <= 100)
        with patch.object(decay, "get_solve_count", return_value=2):
            self.assertEqual(decay.linear(challenge), 90)
            self.assertEqual(decay.logarithmic(challenge), 100)

    def test_valid_partial_dynamic_update_recalculates_existing_solves(self):
        self.submit(2)
        self.submit(3)
        r = self.client.patch("/api/v1/challenges/2", json={"decay": "20", "minimum": "5"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.value(), 80)
        self.assertEqual(DynamicChallenge.query.get(2).minimum, 5)

    def test_standard_form_ignores_hidden_empty_dynamic_fields(self):
        r = self.client.patch("/api/v1/challenges/1", json={
            "type": "standard", "scoring-type-radio": "standard", "value": "100",
            "initial": "", "minimum": "", "decay": "", "function": "linear",
        })
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(Challenges.query.get(1).value, 100)

    def test_failed_update_rolls_back_scoring_conversion(self):
        with patch.object(DynamicValueChallenge, "update", side_effect=RuntimeError("failed")):
            with self.assertRaises(RuntimeError):
                self.client.patch("/api/v1/challenges/1", json={
                    "scoring-type-radio": "dynamic", "initial": 100, "minimum": 10, "decay": 10,
                })
        self.assertEqual(Challenges.query.get(1).type, "standard")
        self.assertIsNone(DynamicChallenge.query.get(1))
        self.assertEqual(Challenges.query.get(1).value, 100)

    def test_duplicate_retype_preserves_original_incorrect_submission(self):
        self.submit(2)
        wrong = self.submit(2, submission_type="incorrect").get_json()["data"]["id"]
        r = self.client.patch(f"/api/v1/submissions/{wrong}", json={"type": "correct"})
        self.assertEqual(r.status_code, 409, r.get_json())
        self.assertEqual(Submissions.query.get(wrong).type, "incorrect")
        self.assertEqual(Solves.query.count(), 1)
        self.assertEqual(Submissions.query.count(), 2)

    def test_parent_lock_refreshes_dynamic_child_configuration(self):
        self.submit(2)
        self.submit(3)
        challenge = DynamicChallenge.query.get(2)
        self.assertEqual(challenge.decay, 10)
        # Simulate a newer stored config while the ORM still holds the old one.
        db.session.execute(DynamicChallenge.__table__.update().where(
            DynamicChallenge.__table__.c.id == 2).values(decay=20))
        db.session.commit()
        from CTFd.utils.scoring import lock_challenge, recalculate
        challenge = lock_challenge(2)
        self.assertEqual(challenge.decay, 20)
        recalculate(challenge)
        db.session.commit()
        self.assertEqual(self.value(), 80)

    def test_mysql_migration_and_lock_statements_compile(self):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy.dialects import mysql
        from CTFd.utils.scoring import lock_challenge
        from pathlib import Path
        import runpy

        output = io.StringIO()
        context = MigrationContext.configure(dialect_name="mysql", opts={"as_sql": True, "output_buffer": output})
        migration = runpy.run_path(str(Path(__file__).resolve().parents[1] /
            "migrations/versions/f5a6b7c8d9e0_award_request_keys.py"))
        with Operations.context(context):
            migration["upgrade"]()
            migration["downgrade"]()
        sql = output.getvalue()
        self.assertIn("UNIQUE (request_key)", sql)
        self.assertIn("DROP INDEX uq_awards_request_key", sql)
        challenge = lock_challenge(2)
        query = DynamicChallenge.query.filter_by(id=challenge.id).with_for_update()
        self.assertIn("FOR UPDATE", str(query.statement.compile(dialect=mysql.dialect())))
