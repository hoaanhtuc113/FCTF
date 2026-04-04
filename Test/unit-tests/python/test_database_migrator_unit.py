import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import sessionmaker


DB_MIGRATION_DIR = Path(__file__).resolve().parents[3] / "database-migration"
MIGRATOR_PATH = DB_MIGRATION_DIR / "migrator.py"
spec = importlib.util.spec_from_file_location("fctf_migrator", MIGRATOR_PATH)
if spec is None or spec.loader is None:
    raise ImportError(f"Cannot load migrator module from {MIGRATOR_PATH}")
migrator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrator)


class _DummyConfig:
    pass


class RetryOnConnectionErrorTests(unittest.TestCase):
    def test_retries_when_error_is_connection_related(self):
        attempts = {"count": 0}

        @migrator.retry_on_connection_error(max_retries=3, delay=1)
        def flaky_call():
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise OperationalError("SELECT 1", {}, Exception("timeout while connecting"))
            return "ok"

        with mock.patch.object(migrator.time, "sleep") as mocked_sleep:
            result = flaky_call()

        self.assertEqual(result, "ok")
        self.assertEqual(attempts["count"], 3)
        self.assertEqual(mocked_sleep.call_count, 2)

    def test_does_not_retry_non_connection_operational_error(self):
        attempts = {"count": 0}

        @migrator.retry_on_connection_error(max_retries=3, delay=1)
        def bad_query():
            attempts["count"] += 1
            raise OperationalError("SELECT", {}, Exception("syntax error near FROM"))

        with self.assertRaises(OperationalError):
            bad_query()

        self.assertEqual(attempts["count"], 1)

    def test_raises_after_max_retries_for_connection_errors(self):
        attempts = {"count": 0}

        @migrator.retry_on_connection_error(max_retries=3, delay=1)
        def always_fail():
            attempts["count"] += 1
            raise DBAPIError("SELECT", {}, Exception("connection refused"))

        with mock.patch.object(migrator.time, "sleep") as mocked_sleep:
            with self.assertRaises(DBAPIError):
                always_fail()

        self.assertEqual(attempts["count"], 3)
        self.assertEqual(mocked_sleep.call_count, 2)


class DataMigratorBatchTests(unittest.TestCase):
    def setUp(self):
        self.data_migrator = migrator.DataMigrator(_DummyConfig())
        self.engine = create_engine("sqlite:///:memory:")
        self.metadata = MetaData()
        self.target_table = Table(
            "items",
            self.metadata,
            Column("id", Integer, primary_key=True),
            Column("value", String(100), nullable=False),
        )
        self.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_execute_batch_insert_inserts_all_rows(self):
        batch_data = [{"id": 1, "value": "one"}, {"id": 2, "value": "two"}]

        result = self.data_migrator._execute_batch(
            self.session,
            self.target_table,
            batch_data,
            "insert",
            {"target": {"pk": ["id"]}},
        )
        self.session.commit()

        self.assertEqual(result, {"inserted": 2, "updated": 0, "unchanged": 0})

        rows = self.session.execute(select(self.target_table).order_by(self.target_table.c.id)).fetchall()
        self.assertEqual([(row.id, row.value) for row in rows], [(1, "one"), (2, "two")])

    def test_execute_batch_upsert_inserts_updates_and_counts_unchanged(self):
        self.session.execute(self.target_table.insert(), [{"id": 1, "value": "a"}, {"id": 2, "value": "b"}])
        self.session.commit()

        batch_data = [
            {"id": 1, "value": "a"},
            {"id": 2, "value": "updated"},
            {"id": 3, "value": "new"},
        ]

        result = self.data_migrator._execute_batch(
            self.session,
            self.target_table,
            batch_data,
            "upsert",
            {"target": {"pk": ["id"]}},
        )
        self.session.commit()

        self.assertEqual(result, {"inserted": 1, "updated": 1, "unchanged": 1})

        rows = self.session.execute(select(self.target_table).order_by(self.target_table.c.id)).fetchall()
        self.assertEqual([(row.id, row.value) for row in rows], [(1, "a"), (2, "updated"), (3, "new")])

    def test_execute_batch_logs_error_and_returns_zero_counts_on_failure(self):
        class BadSession:
            def execute(self, *_args, **_kwargs):
                raise RuntimeError("write failed")

        result = self.data_migrator._execute_batch(
            BadSession(),
            self.target_table,
            [{"id": 9, "value": "x"}],
            "insert",
            {"target": {"pk": ["id"]}},
        )

        self.assertEqual(result, {"inserted": 0, "updated": 0, "unchanged": 0})
        self.assertTrue(any("Batch operation error" in err for err in self.data_migrator.stats["errors"]))


class DataMigratorHelperMethodTests(unittest.TestCase):
    def setUp(self):
        self.data_migrator = migrator.DataMigrator(_DummyConfig())

    def test_map_rows_for_target_applies_from_and_const_and_skips_unknown_target_columns(self):
        metadata = MetaData()
        target_table = Table(
            "target",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("name", String(100)),
            Column("state", String(100)),
        )

        rows = [
            SimpleNamespace(source_id=10, source_name="alpha"),
            SimpleNamespace(source_id=20, source_name="beta"),
        ]
        columns_mapping = {
            "id": {"from": "source_id"},
            "name": {"from": "source_name"},
            "state": {"const": "active"},
            "not_in_table": {"const": "ignored"},
        }

        mapped = self.data_migrator._map_rows_for_target(rows, columns_mapping, target_table)

        self.assertEqual(
            mapped,
            [
                {"id": 10, "name": "alpha", "state": "active"},
                {"id": 20, "name": "beta", "state": "active"},
            ],
        )

    def test_is_fk_violation_error_detects_by_message_and_error_code(self):
        self.assertTrue(
            migrator.DataMigrator._is_fk_violation_error(
                Exception("Cannot add or update a child row: a foreign key constraint fails")
            )
        )

        class FakeDbError(Exception):
            def __init__(self):
                self.args = ()
                self.orig = SimpleNamespace(args=(1452,))

            def __str__(self):
                return "db error"

        self.assertTrue(migrator.DataMigrator._is_fk_violation_error(FakeDbError()))
        self.assertFalse(migrator.DataMigrator._is_fk_violation_error(Exception("other error")))

    def test_is_missing_tablespace_error_detects_by_message_and_error_code(self):
        self.assertTrue(migrator.DataMigrator._is_missing_tablespace_error(Exception("tablespace is missing")))

        class FakeDbError(Exception):
            def __init__(self):
                self.args = ()
                self.orig = SimpleNamespace(args=(194,))

            def __str__(self):
                return "db error"

        self.assertTrue(migrator.DataMigrator._is_missing_tablespace_error(FakeDbError()))
        self.assertFalse(migrator.DataMigrator._is_missing_tablespace_error(Exception("unrelated")))

    def test_is_table_missing_error_detects_by_message_and_error_code(self):
        self.assertTrue(migrator.DataMigrator._is_table_missing_error(Exception("Unknown table 'x'")))
        self.assertTrue(migrator.DataMigrator._is_table_missing_error(Exception("Table 'db.t' doesn't exist")))

        class FakeDbError(Exception):
            def __init__(self):
                self.args = ()
                self.orig = SimpleNamespace(args=(1146,))

            def __str__(self):
                return "db error"

        self.assertTrue(migrator.DataMigrator._is_table_missing_error(FakeDbError()))
        self.assertFalse(migrator.DataMigrator._is_table_missing_error(Exception("random")))


if __name__ == "__main__":
    unittest.main()
