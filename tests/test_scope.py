from bounty_agent.config import ProgramScope
from bounty_agent.scope import ScopeGuard


def test_allowed_root_domain() -> None:
    guard = ScopeGuard(ProgramScope("p", allowed_domains=["example.com", "*.example.com"]))
    assert guard.validate_target("https://example.com").allowed


def test_allowed_wildcard_subdomain() -> None:
    guard = ScopeGuard(ProgramScope("p", allowed_domains=["example.com", "*.example.com"]))
    assert guard.validate_target("https://api.example.com/v1").allowed


def test_wildcard_does_not_match_root_by_itself() -> None:
    guard = ScopeGuard(ProgramScope("p", allowed_domains=["*.example.com"]))
    assert not guard.validate_target("https://example.com").allowed


def test_excluded_domain_blocks_command() -> None:
    guard = ScopeGuard(
        ProgramScope("p", allowed_domains=["example.com", "*.example.com"], excluded_domains=["admin.example.com"])
    )
    decision = guard.validate_command("curl https://admin.example.com")
    assert not decision.allowed
    assert "excluded" in decision.reason


def test_url_paths_are_not_parsed_as_hosts() -> None:
    guard = ScopeGuard(ProgramScope("p", allowed_domains=["launchdarkly.com"]))
    decision = guard.validate_command("curl https://launchdarkly.com/robots.txt")

    assert decision.allowed
    assert decision.hosts == ("launchdarkly.com",)
