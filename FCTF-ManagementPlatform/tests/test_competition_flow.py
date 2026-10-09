"""Creation and flag submission regressions using isolated persistence."""
import unittest
from unittest.mock import patch

import test_model_types as model_tests
from CTFd.models import Challenges, Fails, Flags, RegexFlag, Solves, db
from CTFd.plugins.challenges import CHALLENGE_CLASSES
from CTFd.plugins.multiple_choice import MultipleChoiceChallengeClass
from CTFd.plugins.sandbox_challenges import SandboxChallengeClass


class CompetitionFlowTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        db.create_all()
        self.mocks.enter_context(patch.dict(CHALLENGE_CLASSES, {
            "multiple_choice": MultipleChoiceChallengeClass,
            "sandbox": SandboxChallengeClass,
        }))
        self.mocks.enter_context(patch.object(self.challenges_api, "log"))
        # A sandbox now requires a real KYPO reference; this suite isolates
        # time-limit/flag behavior from the dedicated KYPO validation tests.
        self.mocks.enter_context(patch("CTFd.plugins.sandbox_challenges.validate_config", return_value={
            "kypo_instance_id": 10, "kypo_instance_type": "linear",
            "kypo_access_token": "", "kypo_base_url": "https://kypo.test",
        }))
        self.redis = self.mocks.enter_context(patch.object(self.challenges_api, "redis_client"))
        self.redis.exists.return_value = False
        self.mocks.enter_context(patch.object(self.challenges_api.current_user,
                                            "get_wrong_submissions_per_minute", return_value=0))

    def create_payload(self, kind):
        payload = dict(name="new-challenge", category="test", value=100, type=kind, user_id=1)
        if kind == "dynamic":
            payload.update(initial=100, minimum=10, decay=50)
        return payload

    def attempt(self, data, preview=False):
        return self.client.post("/api/v1/challenges/attempt" + ("?preview=true" if preview else ""),
                                json=data, headers={"Authorization": "Bearer ctfd_test_1"})

    def legacy_flag(self, content, flag_type="regex", record_id=1):
        db.session.execute(Flags.__table__.update().where(Flags.id == record_id)
                           .values(type=flag_type, content=content))
        db.session.commit()
        db.session.expunge_all()

    def test_missing_required_time_limit_is_400_without_creation(self):
        for kind in ("standard", "dynamic", "multiple_choice"):
            with self.subTest(type=kind):
                response = self.client.post("/api/v1/challenges", json=self.create_payload(kind))
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertIn("time_limit", response.get_json()["errors"])
                self.assertEqual(Challenges.query.count(), 2)

    def test_invalid_time_limits_are_rejected_for_every_type(self):
        for kind in ("standard", "dynamic", "multiple_choice", "sandbox"):
            for value in (-10, None, True, 1.5, "abc", [], 2147483648):
                with self.subTest(type=kind, time_limit=value):
                    response = self.client.post("/api/v1/challenges", json={
                        **self.create_payload(kind), "time_limit": value,
                    })
                    self.assertEqual(response.status_code, 400, response.get_json())
                    self.assertEqual(Challenges.query.count(), 2)

    def test_valid_time_limits_create_every_type(self):
        for kind in ("standard", "dynamic", "multiple_choice", "sandbox"):
            for value in (-1, 0, 30):
                with self.subTest(type=kind, time_limit=value):
                    response = self.client.post("/api/v1/challenges", json={
                        **self.create_payload(kind), "time_limit": value,
                    })
                    self.assertEqual(response.status_code, 200, response.get_json())
                    challenge = Challenges.query.get(response.get_json()["data"]["id"])
                    self.assertEqual(challenge.time_limit, value)
                    self.assertEqual(challenge.type, kind)

    def test_sandbox_default_is_persisted_as_60(self):
        response = self.client.post("/api/v1/challenges", json=self.create_payload("sandbox"))
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Challenges.query.get(response.get_json()["data"]["id"]).time_limit, 60)

    def test_admin_form_accepts_integer_strings_and_rejects_missing_time(self):
        payload = {**self.create_payload("standard"), "time_limit": "30", "value": "100"}
        response = self.client.post("/api/v1/challenges", data=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Challenges.query.get(response.get_json()["data"]["id"]).time_limit, 30)
        del payload["time_limit"]
        response = self.client.post("/api/v1/challenges", data=payload)
        self.assertEqual(response.status_code, 400, response.get_json())

    def test_form_submission_still_works(self):
        response = self.client.post("/api/v1/challenges/attempt?preview=true",
                                    data={"challenge_id": "1", "submission": " FLAG{test} "},
                                    headers={"Authorization": "Bearer ctfd_test_1"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["data"]["status"], "correct")

    def test_partial_update_keeps_time_and_invalid_update_changes_nothing(self):
        response = self.client.patch("/api/v1/challenges/1", json={"name": "renamed"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(Challenges.query.get(1).time_limit, -1)
        for value in (-10, None, True, 1.5):
            response = self.client.patch("/api/v1/challenges/1", json={"time_limit": value, "name": "bad"})
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertEqual(Challenges.query.get(1).time_limit, -1)
            self.assertEqual(Challenges.query.get(1).name, "renamed")

    def test_null_name_or_category_returns_400(self):
        for field in ("name", "category"):
            response = self.client.post("/api/v1/challenges", json={
                **self.create_payload("standard"), "time_limit": 30, field: None,
            })
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertEqual(Challenges.query.count(), 2)

    def test_valid_regex_creation_and_full_match(self):
        response = self.client.post("/api/v1/flags", json={
            "challenge_id": 1, "type": "regex", "content": "[a-z]{3}", "data": "case_insensitive",
        })
        self.assertEqual(response.status_code, 200, response.get_json())
        flag_id = response.get_json()["data"]["id"]
        db.session.expunge_all()
        self.assertIsInstance(Flags.query.get(flag_id), RegexFlag)
        for submission, expected in (("ABC", "correct"), ("abcd", "incorrect")):
            result = self.attempt({"challengeId": 1, "submission": submission}, preview=True)
            self.assertEqual(result.status_code, 200, result.get_json())
            self.assertEqual(result.get_json()["data"]["status"], expected)

    def test_invalid_regex_create_and_patch_do_not_persist(self):
        for content in ("[", "(", "[a-z(broken_regex", None, "", 12):
            response = self.client.post("/api/v1/flags", json={
                "challenge_id": 1, "type": "regex", "content": content,
            })
            self.assertEqual(response.status_code, 400, response.get_json())
            response = self.client.patch("/api/v1/flags/1", json={"type": "regex", "content": content})
            self.assertEqual(response.status_code, 400, response.get_json())
            db.session.expire_all()
            self.assertEqual(Flags.query.count(), 1)
            self.assertEqual(Flags.query.get(1).content, "FLAG{test}")
            self.assertEqual(Flags.query.get(1).type, "static")

    def test_switching_type_validates_final_content(self):
        self.legacy_flag("[", flag_type="static")
        response = self.client.patch("/api/v1/flags/1", json={"type": "regex", "content": "[a-z]+"})
        self.assertEqual(response.status_code, 200, response.get_json())
        response = self.client.patch("/api/v1/flags/1", json={"type": "static", "content": "["})
        self.assertEqual(response.status_code, 200, response.get_json())
        db.session.expunge_all()
        self.assertEqual(Flags.query.get(1).type, "static")
        self.assertEqual(Flags.query.get(1).content, "[")

    def test_direct_orm_invalid_regex_cannot_be_committed(self):
        flag = RegexFlag(challenge_id=1, content="[")
        db.session.add(flag)
        with self.assertRaisesRegex(ValueError, "Invalid regular expression"):
            db.session.commit()
        db.session.rollback()
        self.assertEqual(Flags.query.count(), 1)

    def test_invalid_attempt_input_does_not_write_or_touch_redis(self):
        payloads = [None, [], {}, {"challengeId": 1},
                    *({"challengeId": value, "submission": "FLAG{test}"} for value in (None, 0, -1, True, 1.5, "abc")),
                    *({"challengeId": 1, "submission": value} for value in (None, 12, [], "", "  ", "x" * 1001)),
                    {"challengeId": 1, "challenge_id": 2, "submission": "FLAG{test}"}]
        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.attempt(payload, preview=True)
                self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(Fails.query.count(), 0)
        self.assertEqual(Solves.query.count(), 0)
        self.assertEqual(self.redis.mock_calls, [])

    def test_legacy_invalid_configuration_is_not_counted_as_wrong(self):
        for content, kind in (("[", "regex"), (None, "static"), ("FLAG{test}", "invalid")):
            with self.subTest(type=kind):
                self.legacy_flag(content, kind)
                response = self.attempt({"challengeId": 1, "submission": "wrong"})
                self.assertEqual(response.status_code, 400, response.get_json())
                self.assertEqual(response.get_json()["data"]["status"], "error")
                self.assertEqual(Fails.query.count(), 0)
                self.assertEqual(Solves.query.count(), 0)

    def test_valid_alternative_flag_still_solves_with_broken_flag_first(self):
        self.legacy_flag("[", "regex")
        db.session.execute(Flags.__table__.insert().values(
            id=2, challenge_id=1, type="static", content="FLAG{valid}", data=""))
        db.session.commit()
        response = self.attempt({"challenge_id": 1, "submission": "FLAG{valid}"}, preview=True)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["data"]["status"], "correct")

    def test_normal_wrong_attempt_counts_once(self):
        response = self.attempt({"challengeId": 1, "submission": "wrong"})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["data"]["status"], "incorrect")
        self.assertEqual(Fails.query.count(), 1)
        self.assertEqual(Solves.query.count(), 0)

    def test_normal_correct_attempt_persists_one_solve_and_replay_is_safe(self):
        for expected in ("correct", "already_solved"):
            response = self.attempt({"challengeId": 1, "submission": "FLAG{test}"})
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["data"]["status"], expected)
            self.assertEqual(Solves.query.count(), 1)
            self.assertEqual(Fails.query.count(), 0)


if __name__ == "__main__":
    unittest.main()
