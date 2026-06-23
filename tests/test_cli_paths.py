from pathlib import Path

from bounty_agent.cli import resolve_docker_env_file, resolve_program_path, resolve_prompt_path, resolve_runs_dir


def test_engagement_defaults_program_scope() -> None:
    assert resolve_program_path(None, Path("engagements/acme")) == Path("engagements/acme/program/scope.json")


def test_engagement_defaults_runs_under_agent() -> None:
    assert resolve_runs_dir(None, Path("engagements/acme")) == Path("engagements/acme/agent/runs")


def test_engagement_defaults_prompt() -> None:
    assert resolve_prompt_path(None, Path("engagements/acme")) == Path("engagements/acme/program/prompt.md")


def test_explicit_paths_win() -> None:
    assert resolve_program_path(Path("scope.json"), Path("engagements/acme")) == Path("scope.json")
    assert resolve_runs_dir(Path("custom-runs"), Path("engagements/acme")) == Path("custom-runs")
    assert resolve_prompt_path(Path("prompt.md"), Path("engagements/acme")) == Path("prompt.md")


def test_explicit_docker_env_file_wins() -> None:
    assert resolve_docker_env_file(Path("secrets.env"), Path("engagements/acme")) == Path("secrets.env")
