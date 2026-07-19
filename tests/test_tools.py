from pathlib import Path

from bounty_agent.config import AgentSettings, ProgramScope
from bounty_agent.report import write_report
from bounty_agent.scope import ScopeGuard
from bounty_agent.tools import ToolRegistry


class DummyRunner:
    def __init__(self) -> None:
        self.commands: list[str] = []
        self.settings = AgentSettings(command_timeout_seconds=300)

    def exec(self, command: str, timeout_seconds: int):
        self.commands.append(command)
        return type(
            "Result",
            (),
            {
                "command": command,
                "exit_code": 0,
                "stdout": "ok",
                "stderr": "",
                "timed_out": False,
            },
        )()

    def read_file(self, path: str) -> str:
        return ""

    def write_file(self, path: str, content: str) -> None:
        return None

    def list_files(self, path: str) -> list[str]:
        return []


class DummyTrace:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def write(self, event: str, **payload):
        self.events.append((event, payload))


def make_registry(max_repeated_commands: int = 2) -> ToolRegistry:
    return ToolRegistry(
        DummyRunner(),
        ScopeGuard(ProgramScope("test", allowed_domains=["example.com"]), allow_all=True),
        DummyTrace(),
        retrieval=None,
        max_repeated_commands=max_repeated_commands,
    )


def test_repeated_command_is_blocked_after_threshold() -> None:
    registry = make_registry(max_repeated_commands=2)
    action = {"action": "bash", "command": "curl -I https://example.com", "timeout_seconds": 5}

    assert registry.execute(action).ok
    assert registry.execute(action).ok
    result = registry.execute(action)

    assert not result.ok
    assert result.meta["repeat_blocked"] is True


def test_destructive_command_is_blocked() -> None:
    registry = make_registry()
    result = registry.execute({"action": "bash", "command": "rm -rf /", "timeout_seconds": 5})

    assert not result.ok
    assert result.meta["safety_blocked"] is True


def test_scanner_without_rate_flag_is_blocked() -> None:
    registry = make_registry()
    result = registry.execute({"action": "bash", "command": "ffuf -u https://example.com/FUZZ -w words.txt"})

    assert not result.ok
    assert result.meta["rate_guard_blocked"] is True


def test_tool_inventory_command_is_allowed() -> None:
    registry = make_registry()
    result = registry.execute({"action": "bash", "command": "command -v httpx || true"})

    assert result.ok


def test_httpx_tool_adds_scheme_for_raw_ip_targets() -> None:
    registry = make_registry()
    registry.execute({"action": "httpx", "target": "198.51.100.10", "timeout_seconds": 5})

    assert registry.runner.commands[0].startswith("httpx")


def test_inql_tool_command_is_built() -> None:
    registry = make_registry()
    registry.execute({"action": "inql", "target": "https://example.com/graphql", "timeout_seconds": 5})

    assert "inql" in registry.runner.commands[0]
    assert "https://example.com/graphql" in registry.runner.commands[0]


def test_graphql_introspection_is_exempt_from_repeat_blocking() -> None:
    registry = make_registry(max_repeated_commands=1)
    query = '{"query": "{__schema{types{name}}}"}'
    action = {"action": "bash", "command": f"curl -s -X POST https://example.com/graphql -d '{query}'", "timeout_seconds": 5}

    assert registry.execute(action).ok
    assert registry.execute(action).ok
    assert registry.execute(action).ok  # exempt, so never blocked


def test_feroxbuster_tool_command_is_built() -> None:
    registry = make_registry()
    registry.execute({"action": "feroxbuster", "target": "https://example.com", "timeout_seconds": 5})

    assert "feroxbuster" in registry.runner.commands[0]


def test_dalfox_tool_command_is_built() -> None:
    registry = make_registry()
    registry.execute({"action": "dalfox", "target": "https://example.com/search?q=test", "timeout_seconds": 5})

    assert "dalfox" in registry.runner.commands[0]