import datetime
import importlib
import unittest
from unittest.mock import patch

from flask import jsonify
from sqlalchemy import select

import test_model_types as model_tests
from CTFd.models import ActionLogs, Awards, Submissions, Solves, Topics, db


class AdminApiOperationsTests(unittest.TestCase):
    clean_database = model_tests.ModelTypeTests.clean_database
    login_as = model_tests.ModelTypeTests.login_as

    def setUp(self):
        model_tests.ModelTypeTests.setUp(self)
        self.app.register_blueprint(self.admin.admin)
        api = self.users_api.users_namespace.apis[-1]
        for name in ("topics", "awards", "submissions", "action_logs"):
            module = importlib.import_module("CTFd.api.v1." + name)
            api.add_namespace(getattr(module, name + "_namespace"), path="/api/v1/" + name)

    def test_csv_rejects_missing_unknown_and_sql_like_tables(self):
        for suffix in ("", "?table=", "?table=nonexistent", "?table=users;SELECT%201"):
            response = self.client.get("/admin/export/csv" + suffix)
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertIn("table", response.get_json()["errors"])
        with patch.object(self.admin.ctf_config, "ctf_name", return_value="test"):
            response = self.client.get("/admin/export/csv?table=users")
            self.assertEqual(response.status_code, 200)
            self.assertIn("attachment", response.headers["Content-Disposition"])

    def test_legacy_submission_types_remain_readable_without_becoming_solves(self):
        for i, value in enumerate(("invalid_array", None, "incorrect"), 10):
            db.session.execute(Submissions.__table__.insert().values(
                id=i, challenge_id=1, user_id=2, type=value, provided="test"))
        db.session.commit()
        admin_submissions = importlib.import_module("CTFd.admin.submissions")
        def render(template, **kwargs):
            return jsonify(types=[x.type for x in kwargs["submissions"].items])
        with patch.object(admin_submissions, "render_template", side_effect=render):
            response = self.client.get("/admin/submissions")
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertIn("invalid_array", response.get_json()["types"])
            for category in ("correct", "incorrect"):
                self.assertEqual(self.client.get("/admin/submissions/" + category).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/submissions").status_code, 200)
        self.assertEqual(Solves.query.count(), 0)
        raw = db.session.execute(select(Submissions.__table__.c.type).where(Submissions.__table__.c.id == 11)).scalar()
        # The type adapter exposes a sentinel on read; underlying NULL remains unchanged.
        self.assertEqual(raw, "__invalid__")
        self.assertEqual(db.session.execute(db.text("SELECT type FROM submissions WHERE id=11")).scalar(), None)

    def test_topics_legacy_route_works_with_expected_shape_and_access(self):
        db.session.add(Topics(id=1, value="Web"))
        db.session.commit()
        response = self.client.get("/api/v1/topics/api/get-listtopic")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [{"id": 1, "name": "Web"}])
        self.assertEqual(self.client.get("/api/v1/topics/1").status_code, 200)
        self.login_as(2)
        denied = self.client.get("/api/v1/topics/api/get-listtopic")
        self.assertEqual(denied.status_code, 302)
        self.assertIn("/login", denied.headers["Location"])

    def test_logs_paginate_with_stable_order_and_empty_success(self):
        date = datetime.datetime(2026, 1, 1)
        for i in range(5):
            db.session.add(ActionLogs(userId=2, actionType=2, actionDetail="Start", actionDate=date))
        db.session.commit()
        pages = [self.client.get(f"/api/v1/action_logs?page={page}&per_page=2").get_json()
                 for page in (1, 2, 3, 4)]
        self.assertEqual([len(p["data"]) for p in pages], [2, 2, 1, 0])
        self.assertEqual([r["actionId"] for p in pages for r in p["data"]], [5, 4, 3, 2, 1])
        self.assertEqual(pages[0]["meta"]["pagination"]["total"], 5)
        self.assertTrue(pages[-1]["success"])
        for suffix in ("page=0", "page=abc", "per_page=-1"):
            self.assertEqual(self.client.get("/api/v1/action_logs?" + suffix).status_code, 400)

    def test_awards_pagination_preserves_names_and_filters(self):
        for i in range(5):
            db.session.add(Awards(user_id=2, value=i, name="Award " + str(i)))
        db.session.add(Awards(user_id=3, value=100, name="other"))
        db.session.commit()
        pages = [self.client.get(f"/api/v1/awards?user_id=2&page={page}&per_page=2").get_json()
                 for page in (1, 2, 3, 4)]
        self.assertEqual([len(p["data"]) for p in pages], [2, 2, 1, 0])
        self.assertEqual(pages[0]["meta"]["pagination"]["total"], 5)
        self.assertEqual(pages[0]["data"][0]["name"], "Award 4")
        self.assertTrue(pages[-1]["success"])
        self.assertEqual(self.client.get("/api/v1/awards?per_page=0").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/awards?per_page=1000").get_json()["meta"]["pagination"]["per_page"], 100)
