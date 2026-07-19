from __future__ import annotations

from bounty_agent.config import AgentSettings


def test_default_command_timeout_is_sufficient_for_long_running_tools():
    settings = AgentSettings()
    assert settings.command_timeout_seconds >= 300, (
        "command_timeout_seconds must be high enough for nuclei/inql/feroxbuster scans"
    )


def test_default_llm_timeout_is_sufficient():
    settings = AgentSettings()
    assert settings.llm_timeout_seconds >= 240, (
        "llm_timeout_seconds must accommodate slow model responses"
    )


def test_custom_timeouts_override_defaults():
    settings = AgentSettings(command_timeout_seconds=600, llm_timeout_seconds=420)
    assert settings.command_timeout_seconds == 600
    assert settings.llm_timeout_seconds == 420