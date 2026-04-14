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
DECAY_PATH = MANAGEMENT_PLATFORM_DIR / "CTFd" / "plugins" / "dynamic_challenges" / "decay.py"


def _load_decay_module():
    ctfd_module = types.ModuleType("CTFd")
    ctfd_module.__path__ = []

    models_module = types.ModuleType("CTFd.models")
    models_module.Solves = SimpleNamespace(query=None, account_id=0, challenge_id=0)

    utils_module = types.ModuleType("CTFd.utils")
    utils_module.__path__ = []
    modes_module = types.ModuleType("CTFd.utils.modes")
    modes_module.get_model = lambda: SimpleNamespace(id=1, hidden=False, banned=False)

    ctfd_module.models = models_module
    ctfd_module.utils = utils_module
    utils_module.modes = modes_module

    stubs = {
        "CTFd": ctfd_module,
        "CTFd.models": models_module,
        "CTFd.utils": utils_module,
        "CTFd.utils.modes": modes_module,
    }

    spec = importlib.util.spec_from_file_location(f"fctf_test_decay_{uuid.uuid4().hex}", DECAY_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {DECAY_PATH}")

    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, stubs, clear=False):
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module


class DynamicChallengeDecayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.decay = _load_decay_module()

    def test_linear_returns_initial_for_zero_solves(self):
        challenge = SimpleNamespace(initial=500, decay=40, minimum=100)

        with mock.patch.object(self.decay, "get_solve_count", return_value=0):
            value = self.decay.linear(challenge)

        self.assertEqual(value, 500)

    def test_linear_subtracts_one_solve_before_decay(self):
        challenge = SimpleNamespace(initial=500, decay=40, minimum=100)

        with mock.patch.object(self.decay, "get_solve_count", return_value=3):
            value = self.decay.linear(challenge)

        self.assertEqual(value, 420)

    def test_linear_clamps_to_minimum(self):
        challenge = SimpleNamespace(initial=120, decay=50, minimum=30)

        with mock.patch.object(self.decay, "get_solve_count", return_value=10):
            value = self.decay.linear(challenge)

        self.assertEqual(value, 30)

    def test_logarithmic_sets_decay_to_one_when_zero(self):
        challenge = SimpleNamespace(initial=500, decay=0, minimum=100)

        with mock.patch.object(self.decay, "get_solve_count", return_value=2):
            value = self.decay.logarithmic(challenge)

        self.assertEqual(challenge.decay, 1)
        self.assertEqual(value, 100)

    def test_logarithmic_keeps_initial_value_for_first_solver(self):
        challenge = SimpleNamespace(initial=400, decay=10, minimum=50)

        with mock.patch.object(self.decay, "get_solve_count", return_value=1):
            value = self.decay.logarithmic(challenge)

        self.assertEqual(value, 400)

    def test_decay_function_registry_contains_expected_handlers(self):
        self.assertIn("linear", self.decay.DECAY_FUNCTIONS)
        self.assertIn("logarithmic", self.decay.DECAY_FUNCTIONS)
        self.assertIs(self.decay.DECAY_FUNCTIONS["linear"], self.decay.linear)
        self.assertIs(self.decay.DECAY_FUNCTIONS["logarithmic"], self.decay.logarithmic)


if __name__ == "__main__":
    unittest.main()