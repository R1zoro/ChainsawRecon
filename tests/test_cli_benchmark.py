from pathlib import Path
import types
import sys

from bounty_agent.cli import main


def test_benchmark_handler_runs_without_program_or_engagement(monkeypatch, tmp_path: Path) -> None:
    argv = ["--benchmark", "http://localhost:3000"]
    captured = {}

    def fake_run_benchmark(target: str, scope_path=None, dry=True):
        captured["target"] = target
        captured["scope_path"] = scope_path
        captured["dry"] = dry
        return tmp_path / "benchmarks" / "scorecard.md"

    fake_module = types.ModuleType("bounty_agent.benchmark")
    fake_module.run_benchmark = fake_run_benchmark
    monkeypatch.setitem(sys.modules, "bounty_agent.benchmark", fake_module)

    exit_code = main(argv)

    assert exit_code == 0
    assert captured["target"] == "http://localhost:3000"
    assert captured["scope_path"] is None
    assert captured["dry"] is True
