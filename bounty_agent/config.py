from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path


@dataclass(frozen=True)
class RateLimitConfig:
    delay_seconds: float = 0.0
    max_commands_per_minute: int = 0
    notes: str = ""


@dataclass(frozen=True)
class ProgramScope:
    program_name: str
    allowed_domains: list[str] = field(default_factory=list)
    excluded_domains: list[str] = field(default_factory=list)
    allowed_urls: list[str] = field(default_factory=list)
    notes: str = ""
    rate_limits: RateLimitConfig = field(default_factory=RateLimitConfig)

    @classmethod
    def from_file(cls, path: Path) -> "ProgramScope":
        data = json.loads(path.read_text(encoding="utf-8"))
        rate_limits = data.get("rate_limits", {})
        return cls(
            program_name=str(data.get("program_name", "Unnamed Program")),
            allowed_domains=list(data.get("allowed_domains", [])),
            excluded_domains=list(data.get("excluded_domains", [])),
            allowed_urls=list(data.get("allowed_urls", [])),
            notes=str(data.get("notes", "")),
            rate_limits=RateLimitConfig(
                delay_seconds=float(rate_limits.get("delay_seconds", 0.0)),
                max_commands_per_minute=int(rate_limits.get("max_commands_per_minute", 0)),
                notes=str(rate_limits.get("notes", "")),
            ),
        )


@dataclass(frozen=True)
class AgentSettings:
    model: str | None = None
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = "ollama"
    mode: str = "recon"
    max_steps: int = 12
    dry_run: bool = True
    runner: str = "local"
    docker_image: str = "bounty-sandbox"
    docker_env_file: Path | None = None
    command_timeout_seconds: int = 600
    custom_prompt: str = ""
    llm_timeout_seconds: int = 480
    command_delay_seconds: float = 0.0
    max_commands_per_minute: int = 0
    rate_limit_notes: str = ""
    allow_all_hosts: bool = False
    max_repeated_commands: int = 2
    max_malformed_responses: int = 10
    early_stop_check_interval: int = 10
    engagement_db_path: Path | None = None
    session_run_dir: Path | None = None
    session_targets: tuple[str, ...] = ()
    queue_path: Path | None = None
    auth_context_path: Path | None = None
    priority_targets_path: Path | None = None


def env_or_default(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
