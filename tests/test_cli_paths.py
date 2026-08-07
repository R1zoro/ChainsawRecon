import json
from pathlib import Path

from bounty_agent.cli import (
    build_parser,
    resolve_docker_env_file,
    resolve_engagement_db_path,
    resolve_program_path,
    resolve_priority_targets_path,
    resolve_prompt_path,
    resolve_runs_dir,
    resolve_targets,
    resolve_program_scope,
)
from bounty_agent.config import ProgramScope


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


def test_priority_targets_detects_underscored_filename(tmp_path: Path) -> None:
    engagement = tmp_path / "engagements" / "acme"
    program_dir = engagement / "program"
    program_dir.mkdir(parents=True)
    (program_dir / "priority_targets.txt").write_text("https://foo.example\n", encoding="utf-8")

    assert resolve_priority_targets_path(None, engagement) == program_dir / "priority_targets.txt"


def test_engagement_db_defaults_under_agent_folder() -> None:
    assert resolve_engagement_db_path(None, Path("runs"), Path("engagements/acme")) == Path(
        "engagements/acme/agent/knowledge.db"
    )


def test_engagement_targets_are_inferred_from_in_scope_file(tmp_path: Path) -> None:
    engagement = tmp_path / "engagements" / "acme"
    program_dir = engagement / "program"
    program_dir.mkdir(parents=True)
    (program_dir / "in-scope.txt").write_text(
        "https://foo.example\nbar.example\n198.51.100.10\n",
        encoding="utf-8",
    )

    assert resolve_targets(None, engagement, ProgramScope("Acme")) == [
        "https://foo.example",
        "bar.example",
        "198.51.100.10",
    ]


def test_explicit_target_is_seeded_with_engagement_targets(tmp_path: Path) -> None:
    engagement = tmp_path / "engagements" / "acme"
    program_dir = engagement / "program"
    program_dir.mkdir(parents=True)
    (program_dir / "in-scope.txt").write_text(
        "https://foo.example\nbar.example\n",
        encoding="utf-8",
    )

    assert resolve_targets("https://seed.example", engagement, ProgramScope("Acme")) == [
        "https://seed.example",
        "https://foo.example",
        "bar.example",
    ]


def test_program_scope_expands_allowed_hosts_from_engagement_in_scope(tmp_path: Path) -> None:
    engagement = tmp_path / "engagements" / "acme"
    program_dir = engagement / "program"
    program_dir.mkdir(parents=True)
    (program_dir / "in-scope.txt").write_text("198.51.100.10\nhttps://api.example.com\n", encoding="utf-8")
    (program_dir / "scope.json").write_text(
        json.dumps({"program_name": "Acme", "allowed_domains": ["example.com"]}),
        encoding="utf-8",
    )

    scope = resolve_program_scope(program_dir / "scope.json", engagement)

    assert "198.51.100.10" in scope.allowed_domains
    assert "api.example.com" in scope.allowed_domains


def test_clean_apply_flag_parses_both_aliases() -> None:
    parser = build_parser()
    args = parser.parse_args(["--engagement", "engagements/acme", "--clean", "--apply"])
    assert args.clean is True
    assert args.clean_apply is True

    args2 = parser.parse_args(["--engagement", "engagements/acme", "--clean", "--clean-apply"])
    assert args2.clean is True
    assert args2.clean_apply is True
