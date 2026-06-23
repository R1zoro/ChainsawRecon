from pathlib import Path

from bounty_agent.config import ProgramScope


def test_scope_loads_rate_limits() -> None:
    scope = ProgramScope.from_file(Path("engagements/_template/program/scope.json"))

    assert scope.rate_limits.delay_seconds == 2
    assert scope.rate_limits.max_commands_per_minute == 20
    assert "concurrency" in scope.rate_limits.notes
