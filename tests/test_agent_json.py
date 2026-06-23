from bounty_agent.agent import _recon_coverage_gaps, _summary_claims_findings, parse_json_action
from bounty_agent.config import ProgramScope
from bounty_agent.scope import ScopeGuard


def test_parse_json_action_accepts_plain_json() -> None:
    assert parse_json_action('{"action":"finish","summary":"done"}') == {
        "action": "finish",
        "summary": "done",
    }


def test_parse_json_action_extracts_json_after_prose() -> None:
    assert parse_json_action('I will continue. {"action":"list_files","path":"."}') == {
        "action": "list_files",
        "path": ".",
    }


def test_parse_json_action_rejects_blank_text() -> None:
    assert parse_json_action("   ") is None


def test_summary_detects_unrecorded_finding_claim() -> None:
    assert _summary_claims_findings("Completed recon and identified one finding.")
    assert not _summary_claims_findings("Completed recon with no validated findings.")


def test_recon_coverage_requires_research_tools_hosts_and_script() -> None:
    scope = ScopeGuard(ProgramScope("test", allowed_domains=["example.com", "api.example.com", "docs.example.com"]))
    ok = type("Result", (), {"ok": True})()
    history = [
        ({"action": "search", "query": "site:github.com example api security"}, ok),
        ({"action": "search", "query": "site:medium.com example bug bounty"}, ok),
        ({"action": "search", "query": "site:cvedetails.com example cve"}, ok),
        ({"action": "search", "query": "site:security.snyk.io example advisory"}, ok),
        ({"action": "bash", "command": "katana -silent -u https://example.com -rl 2 -c 1"}, ok),
        ({"action": "bash", "command": "httpx -json -rl 5 -u https://api.example.com"}, ok),
        ({"action": "bash", "command": "nuclei -u https://docs.example.com -rl 2 -c 1"}, ok),
        ({"action": "write_file", "path": "verify.py"}, ok),
        ({"action": "bash", "command": "python3 verify.py"}, ok),
    ]

    assert _recon_coverage_gaps(history, scope) == []
    assert _recon_coverage_gaps(history[:2], scope)
