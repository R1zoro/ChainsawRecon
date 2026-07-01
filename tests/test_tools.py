from pathlib import Path

from bounty_agent.config import ProgramScope
from bounty_agent.report import write_report
from bounty_agent.scope import ScopeGuard
from bounty_agent.tools import ToolRegistry


class DummyRunner:
    def __init__(self) -> None:
        self.commands: list[str] = []

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
    assert "http://198.51.100.10" in registry.runner.commands[0]


def test_report_includes_methodology_and_recommended_next_steps(tmp_path: Path) -> None:
    report_path = tmp_path / "report.md"
    write_report(
        report_path,
        ProgramScope("Example", allowed_domains=["example.com"]),
        "198.51.100.10",
        [],
        "Observed a public endpoint and a possible auth boundary.",
        run_coverage={
            "surface_count": 2,
            "attack_count": 1,
            "surface_types": {"api": 1, "web": 1},
            "next_tasks": [
                {"surface_type": "api", "surface": "198.51.100.10/api", "attack_type": "auth_check", "reason": "Auth boundary"}
            ],
        },
        engagement_coverage={},
    )

    content = report_path.read_text(encoding="utf-8")
    assert "## Methodology" in content
    assert "## Recommended Next Steps" in content
    assert "auth boundary" in content.lower()


def test_use_skill_returns_structured_playbook() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "use_skill",
            "name": "public_research",
            "objective": "find public references for endpoint behavior",
        }
    )

    assert result.ok
    assert result.meta["skill"] == "public_research"
    assert "At least four distinct searches" in result.content


def test_repeated_skill_request_is_blocked_after_threshold() -> None:
    registry = make_registry()
    action = {
        "action": "use_skill",
        "name": "public_research",
        "objective": "find public references for endpoint behavior",
    }

    assert registry.execute(action).ok
    assert registry.execute(action).ok
    result = registry.execute(action)

    assert not result.ok
    assert result.meta["repeat_blocked"] is True


def test_unknown_skill_is_rejected() -> None:
    registry = make_registry()
    result = registry.execute({"action": "use_skill", "name": "unknown"})

    assert not result.ok
    assert "Unknown skill" in result.content


def test_weak_finding_evidence_is_rejected() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "Bad finding",
            "severity": "high",
            "asset": "https://example.com",
            "evidence": "Tool result summary: action=bash ok=True content_length=547",
            "next_steps": "Verify",
        }
    )

    assert not result.ok
    assert result.meta["finding_rejected"] is True


def test_client_side_syntax_error_is_rejected_as_finding_evidence() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "GraphQL syntax error",
            "severity": "low",
            "asset": "https://example.com/graphql",
            "evidence": "GraphQL query with unmatched closing bracket",
            "next_steps": "Verify whether this is a vulnerability",
        }
    )

    assert not result.ok
    assert result.meta["finding_rejected"] is True


def test_expected_unauthorized_response_is_not_a_finding() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "Endpoint returns unauthorized HTML",
            "severity": "medium",
            "asset": "https://example.com/api/v2/flags",
            "request": "GET /api/v2/flags HTTP/1.1",
            "response": "HTTP/1.1 401 Unauthorized\n<html>login required</html>",
            "evidence": "401 Unauthorized HTML",
            "impact": "Endpoint requires authentication.",
            "next_steps": "Verify manually",
        }
    )

    assert not result.ok
    assert result.meta["finding_rejected"] is True


def test_sitemap_discovery_is_not_a_finding() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "LaunchDarkly Sitemap Discovery",
            "severity": "low",
            "asset": "https://example.com",
            "request": "GET /sitemap.xml HTTP/1.1",
            "response": "HTTP/1.1 200 OK\n<sitemapindex>...</sitemapindex>",
            "evidence": "sitemap.xml present",
            "impact": "None",
            "next_steps": "Review sitemap contents",
        }
    )

    assert not result.ok
    assert result.meta["finding_rejected"] is True


def test_normal_authenticated_listing_is_not_idor_evidence() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "LaunchDarkly IDOR via API",
            "severity": "high",
            "asset": "https://example.com/api/v2/flags",
            "request": "GET /api/v2/flags HTTP/1.1",
            "response": "HTTP/1.1 200 OK\nlinks to /api/v2/flags/default and /api/v2/flags/idor-test-2",
            "evidence": "idor-test-2 flag in API response",
            "impact": "Potential unauthorized access to flags",
            "next_steps": "Verify manually",
        }
    )

    assert not result.ok
    assert result.meta["finding_rejected"] is True


def test_valid_finding_requires_request_response_and_impact() -> None:
    registry = make_registry()
    result = registry.execute(
        {
            "action": "record_finding",
            "title": "Cross-tenant project metadata exposure",
            "severity": "high",
            "asset": "https://example.com/api/projects/other-tenant",
            "request": "GET /api/projects/other-tenant HTTP/1.1",
            "response": "HTTP/1.1 200 OK\n{\"projectName\":\"unauthorized data\"}",
            "evidence": "Authenticated low-rate request returned unauthorized data from another tenant.",
            "impact": "An authenticated user can read another tenant's project metadata.",
            "next_steps": "Manually verify with owned test tenants only.",
        }
    )

    assert result.ok
