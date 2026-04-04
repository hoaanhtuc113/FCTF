import importlib.util
import sys
import types
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


FCTF_ROOT = Path(__file__).resolve().parents[3]
MANAGEMENT_PLATFORM_DIR = FCTF_ROOT / "FCTF-ManagementPlatform"
REWARD_TEMPLATES_PATH = MANAGEMENT_PLATFORM_DIR / "CTFd" / "utils" / "rewards" / "reward_templates.py"
QUERY_ENGINE_PATH = MANAGEMENT_PLATFORM_DIR / "CTFd" / "utils" / "rewards" / "query_engine.py"
MULTI_CRITERIA_PATH = MANAGEMENT_PLATFORM_DIR / "CTFd" / "utils" / "rewards" / "multi_criteria.py"


def _load_module_from_path(module_path: Path, stubs: dict[str, types.ModuleType] | None = None):
    spec = importlib.util.spec_from_file_location(f"fctf_test_{module_path.stem}_{uuid.uuid4().hex}", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    stub_modules = stubs or {}
    with mock.patch.dict(sys.modules, stub_modules, clear=False):
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module


def _build_query_engine_stub_modules():
    ctfd_module = types.ModuleType("CTFd")
    ctfd_module.__path__ = []

    models_module = types.ModuleType("CTFd.models")
    models_module.db = SimpleNamespace(
        engine=SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
        session=SimpleNamespace(execute=lambda *_args, **_kwargs: []),
    )

    ctfd_module.models = models_module

    return {
        "CTFd": ctfd_module,
        "CTFd.models": models_module,
    }


def _build_multi_criteria_stub_modules():
    ctfd_module = types.ModuleType("CTFd")
    ctfd_module.__path__ = []

    utils_module = types.ModuleType("CTFd.utils")
    utils_module.__path__ = []

    rewards_module = types.ModuleType("CTFd.utils.rewards")
    rewards_module.__path__ = []

    query_engine_module = types.ModuleType("CTFd.utils.rewards.query_engine")
    query_engine_module.validate_query_spec = lambda query: query
    query_engine_module.execute_query = lambda _spec: {"result": []}

    reward_templates_module = types.ModuleType("CTFd.utils.rewards.reward_templates")
    reward_templates_module.build_query_from_template = (
        lambda template_id, _params: {
            "rule": template_id,
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "filters": [],
            "limit": 50,
            "order": {"field": "metric_value", "direction": "desc"},
        }
    )

    ctfd_module.utils = utils_module
    utils_module.rewards = rewards_module
    rewards_module.query_engine = query_engine_module
    rewards_module.reward_templates = reward_templates_module

    return {
        "CTFd": ctfd_module,
        "CTFd.utils": utils_module,
        "CTFd.utils.rewards": rewards_module,
        "CTFd.utils.rewards.query_engine": query_engine_module,
        "CTFd.utils.rewards.reward_templates": reward_templates_module,
    }


class RewardTemplateBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reward_templates = _load_module_from_path(REWARD_TEMPLATES_PATH)

    def test_get_template_categories_filters_none_entries(self):
        categories = self.reward_templates.get_template_categories()

        self.assertEqual(categories, ["achievement", "ranking", "special"])

    def test_list_templates_can_filter_by_category(self):
        all_templates = self.reward_templates.list_templates()
        ranking_templates = self.reward_templates.list_templates("ranking")

        self.assertGreater(len(all_templates), len(ranking_templates))
        self.assertTrue(all(t.category == "ranking" for t in ranking_templates))

    def test_build_query_from_template_applies_common_filters(self):
        query = self.reward_templates.build_query_from_template(
            "top_teams_by_score",
            {
                "limit": 3,
                "min_score": 200,
                "max_score": 500,
                "min_rank": 1,
                "max_rank": 10,
                "categories": ["web", "pwn"],
            },
        )

        self.assertIsNotNone(query)
        self.assertEqual(query["rule"], "top_teams_by_score")
        self.assertEqual(query["limit"], 3)
        self.assertEqual(query["metric"], "TEAM_TOTAL_SCORE")

        self.assertIn({"field": "total_score", "operator": ">=", "value": 200}, query["filters"])
        self.assertIn({"field": "total_score", "operator": "<=", "value": 500}, query["filters"])
        self.assertIn({"field": "rank", "operator": ">=", "value": 1}, query["filters"])
        self.assertIn({"field": "rank", "operator": "<=", "value": 10}, query["filters"])
        self.assertIn({"field": "category", "operator": "IN", "value": ["web", "pwn"]}, query["filters"])

    def test_build_query_from_template_handles_special_template_flags(self):
        query = self.reward_templates.build_query_from_template(
            "first_clear_each_category",
            {
                "limit": 5,
                "category": "crypto",
            },
        )

        self.assertIsNotNone(query)
        self.assertEqual(query["order"], {"field": "last_solve_date", "direction": "asc"})
        self.assertIn(
            {"field": "first_clear_each_category", "operator": "=", "value": True},
            query["filters"],
        )
        self.assertIn({"field": "category", "operator": "=", "value": "crypto"}, query["filters"])

    def test_build_query_from_template_applies_no_hint_and_count_filters(self):
        query = self.reward_templates.build_query_from_template(
            "no_hints_solvers",
            {
                "min_solves": 4,
                "min_attempts": 1,
                "max_attempts": 10,
            },
        )

        self.assertIsNotNone(query)
        self.assertIn({"field": "hint_used", "operator": "=", "value": False}, query["filters"])
        self.assertIn({"field": "solved_count", "operator": ">=", "value": 4}, query["filters"])
        self.assertIn({"field": "wrong_count", "operator": ">=", "value": 1}, query["filters"])
        self.assertIn({"field": "wrong_count", "operator": "<=", "value": 10}, query["filters"])

    def test_build_query_from_template_returns_none_for_unknown_template(self):
        query = self.reward_templates.build_query_from_template("not_exists", {"limit": 3})

        self.assertIsNone(query)


class QueryEngineValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.query_engine = _load_module_from_path(QUERY_ENGINE_PATH, _build_query_engine_stub_modules())

    def test_validate_query_spec_returns_typed_spec_for_valid_payload(self):
        payload = {
            "rule": "r1",
            "entity": "team",
            "metric": "TEAM_SOLVED_COUNT",
            "filters": [
                {"field": "category", "operator": "IN", "value": ["crypto", "web"]},
                {"field": "solved_count", "operator": ">=", "value": 3},
            ],
            "limit": 100,
            "order": {"field": "metric_value", "direction": "desc"},
        }

        spec = self.query_engine.validate_query_spec(payload)

        self.assertEqual(spec.rule, "r1")
        self.assertEqual(spec.entity, "team")
        self.assertEqual(spec.metric, "TEAM_SOLVED_COUNT")
        self.assertEqual(spec.limit, 100)
        self.assertEqual(spec.order["field"], "metric_value")
        self.assertEqual(len(spec.filters), 2)
        self.assertEqual(spec.filters[0].field, "category")
        self.assertEqual(spec.filters[0].operator, "IN")
        self.assertEqual(spec.filters[0].value, ["crypto", "web"])

    def test_validate_query_spec_rejects_invalid_entity_metric_and_limit(self):
        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "invalid",
                    "metric": "TEAM_TOTAL_SCORE",
                    "filters": [],
                }
            )

        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "team",
                    "metric": "INVALID_METRIC",
                    "filters": [],
                }
            )

        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "team",
                    "metric": "TEAM_TOTAL_SCORE",
                    "filters": [],
                    "limit": 0,
                }
            )

    def test_validate_query_spec_rejects_invalid_filter_inputs(self):
        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "team",
                    "metric": "TEAM_TOTAL_SCORE",
                    "filters": [{"field": "not_allowed", "operator": "=", "value": 1}],
                }
            )

        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "team",
                    "metric": "TEAM_TOTAL_SCORE",
                    "filters": [{"field": "category", "operator": "LIKE", "value": "crypto"}],
                }
            )

        with self.assertRaises(self.query_engine.QuerySpecError):
            self.query_engine.validate_query_spec(
                {
                    "rule": "r",
                    "entity": "team",
                    "metric": "TEAM_TOTAL_SCORE",
                    "filters": [{"field": "category", "operator": "IN", "value": "crypto"}],
                }
            )

    def test_compile_query_rejects_unsupported_metric_for_entity(self):
        spec = self.query_engine.QuerySpec(
            rule="r",
            entity="team",
            metric="FIRST_BLOOD",
            filters=[],
            limit=5,
            order={},
        )

        with mock.patch.object(self.query_engine, "_assert_schema", return_value=None):
            with self.assertRaises(self.query_engine.QuerySpecError):
                self.query_engine.compile_query(spec)


class MultiCriteriaExecutorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.multi_criteria = _load_module_from_path(MULTI_CRITERIA_PATH, _build_multi_criteria_stub_modules())

    def test_combine_intersection_keeps_only_entities_in_all_rules(self):
        query = self.multi_criteria.MultiCriteriaQuery(rules=[], logic="AND", combine_method="intersection", description="")
        executor = self.multi_criteria.MultiCriteriaExecutor(query)
        executor.rule_results = [
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="a", params={}),
                "result": {"result": [{"entity_id": 1, "metric_value": 100}, {"entity_id": 2, "metric_value": 80}]},
            },
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="b", params={}),
                "result": {"result": [{"entity_id": 2, "metric_value": 10}, {"entity_id": 3, "metric_value": 5}]},
            },
        ]

        combined = executor._combine_intersection()

        self.assertEqual([row["entity_id"] for row in combined["result"]], [2])
        self.assertEqual(combined["total_matched"], 1)
        self.assertEqual(combined["logic"], "AND")

    def test_combine_union_returns_unique_entities(self):
        query = self.multi_criteria.MultiCriteriaQuery(rules=[], logic="OR", combine_method="union", description="")
        executor = self.multi_criteria.MultiCriteriaExecutor(query)
        executor.rule_results = [
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="a", params={}),
                "result": {"result": [{"entity_id": 1}, {"entity_id": 2}]},
            },
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="b", params={}),
                "result": {"result": [{"entity_id": 2}, {"entity_id": 3}]},
            },
        ]

        combined = executor._combine_union()

        self.assertEqual({row["entity_id"] for row in combined["result"]}, {1, 2, 3})
        self.assertEqual(combined["total_matched"], 3)
        self.assertEqual(combined["logic"], "OR")

    def test_combine_weighted_score_aggregates_and_sorts_by_combined_score(self):
        query = self.multi_criteria.MultiCriteriaQuery(
            rules=[],
            logic="WEIGHTED",
            combine_method="weighted_score",
            description="",
        )
        executor = self.multi_criteria.MultiCriteriaExecutor(query)
        executor.rule_results = [
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="score", params={}, weight=0.7),
                "result": {"result": [{"entity_id": 1, "metric_value": 100}, {"entity_id": 2, "metric_value": 50}]},
            },
            {
                "rule": self.multi_criteria.CriteriaRule(template_id="bonus", params={}, weight=0.3),
                "result": {"result": [{"entity_id": 2, "metric_value": 100}, {"entity_id": 3, "metric_value": 20}]},
            },
        ]

        combined = executor._combine_weighted_score()

        self.assertEqual(combined["result"][0]["entity_id"], 1)
        self.assertEqual(combined["result"][0]["combined_score"], 70.0)
        self.assertEqual(combined["result"][1]["entity_id"], 2)
        self.assertEqual(combined["result"][1]["combined_score"], 65.0)

    def test_execute_runs_each_rule_and_combines_with_requested_method(self):
        query = self.multi_criteria.MultiCriteriaQuery(
            rules=[
                self.multi_criteria.CriteriaRule(template_id="top_teams_by_score", params={"limit": 5}),
                self.multi_criteria.CriteriaRule(template_id="solve_count_champions", params={"limit": 5}),
            ],
            logic="OR",
            combine_method="union",
            description="",
        )
        executor = self.multi_criteria.MultiCriteriaExecutor(query)

        with mock.patch.object(self.multi_criteria, "build_query_from_template") as mock_build, mock.patch.object(
            self.multi_criteria, "validate_query_spec"
        ) as mock_validate, mock.patch.object(self.multi_criteria, "execute_query") as mock_execute:
            mock_build.side_effect = [
                {"rule": "a", "entity": "team", "metric": "TEAM_TOTAL_SCORE", "filters": [], "limit": 5, "order": {}},
                {"rule": "b", "entity": "team", "metric": "TEAM_SOLVED_COUNT", "filters": [], "limit": 5, "order": {}},
            ]
            mock_validate.side_effect = [SimpleNamespace(rule="a"), SimpleNamespace(rule="b")]
            mock_execute.side_effect = [
                {"result": [{"entity_id": 1, "metric_value": 100}]},
                {"result": [{"entity_id": 2, "metric_value": 90}]},
            ]

            result = executor.execute()

        self.assertEqual(mock_build.call_count, 2)
        self.assertEqual(mock_validate.call_count, 2)
        self.assertEqual(mock_execute.call_count, 2)
        self.assertEqual({row["entity_id"] for row in result["result"]}, {1, 2})
        self.assertEqual(result["logic"], "OR")

    def test_execute_raises_for_unknown_combine_method(self):
        query = self.multi_criteria.MultiCriteriaQuery(rules=[], logic="AND", combine_method="unknown", description="")
        executor = self.multi_criteria.MultiCriteriaExecutor(query)

        with self.assertRaises(ValueError):
            executor.execute()


if __name__ == "__main__":
    unittest.main()