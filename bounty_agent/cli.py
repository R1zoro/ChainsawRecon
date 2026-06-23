from __future__ import annotations

import argparse
import os
from pathlib import Path

from .agent import BountyAgent
from .config import AgentSettings, ProgramScope, load_env_file


PROVIDER_DEFAULTS = {
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key_env": "OLLAMA_API_KEY",
        "api_key_default": "ollama",
        "model": "ollama/qwen2.5-coder:7b",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        "api_key_default": "",
        "model": "groq/llama-3.3-70b-versatile",
    },
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scope-aware bug bounty triage agent.")
    parser.add_argument("--program", type=Path, help="Path to program scope JSON.")
    parser.add_argument("--engagement", type=Path, help="Engagement folder containing program/scope.json.")
    parser.add_argument("--target", required=True, help="Target URL, domain, or IP to test.")
    parser.add_argument("--provider", choices=sorted(PROVIDER_DEFAULTS), default="ollama")
    parser.add_argument("--model", help="OpenAI-compatible model spec, e.g. ollama/qwen2.5-coder:7b.")
    parser.add_argument("--no-llm", action="store_true", help="Do not call an LLM, even if an API key is configured.")
    parser.add_argument("--llm-base-url", help="OpenAI-compatible base URL. Defaults from --provider.")
    parser.add_argument("--llm-api-key", help="API key. Defaults from GROQ_API_KEY or OLLAMA_API_KEY.")
    parser.add_argument("--prompt", type=Path, help="Custom operator prompt file. Defaults to engagement/program/prompt.md.")
    parser.add_argument("--command-delay-seconds", type=float, help="Minimum delay before each executed bash tool call.")
    parser.add_argument("--max-commands-per-minute", type=int, help="Maximum executed bash tool calls per minute.")
    parser.add_argument("--max-steps", type=int, default=12)
    parser.add_argument("--max-repeated-commands", type=int, default=2)
    parser.add_argument("--llm-timeout-seconds", type=int, help="Timeout seconds for LLM HTTP calls.")
    parser.add_argument("--allow-all-hosts", action="store_true", help="Allow all hosts and skip scope blocking.")
    parser.add_argument("--runs-dir", type=Path, help="Output directory for run artifacts.")
    parser.add_argument("--runner", choices=["local", "docker"], default="local")
    parser.add_argument("--docker-image", default="bounty-sandbox")
    parser.add_argument("--docker-env-file", type=Path, help="Optional env file passed into the Docker sandbox.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and trace planned actions without execution.")
    parser.add_argument("--execute", action="store_true", help="Actually run approved commands. Default is dry-run.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    load_env_file(Path(".env"))
    program_path = resolve_program_path(args.program, args.engagement)
    prompt_path = resolve_prompt_path(args.prompt, args.engagement)
    runs_dir = resolve_runs_dir(args.runs_dir, args.engagement)
    docker_env_file = resolve_docker_env_file(args.docker_env_file, args.engagement)
    scope = ProgramScope.from_file(program_path)
    provider = PROVIDER_DEFAULTS[args.provider]
    llm_base_url = args.llm_base_url or provider["base_url"]
    llm_api_key = args.llm_api_key
    if llm_api_key is None:
        llm_api_key = os.environ.get(provider["api_key_env"], provider["api_key_default"])
    model = args.model
    if args.no_llm:
        model = None
    elif model is None and llm_api_key:
        model = provider["model"]
    settings = AgentSettings(
        model=model,
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        max_steps=args.max_steps,
        dry_run=not args.execute,
        runner=args.runner,
        docker_image=args.docker_image,
        docker_env_file=docker_env_file,
        custom_prompt=read_optional_text(prompt_path),
        command_delay_seconds=(
            args.command_delay_seconds
            if args.command_delay_seconds is not None
            else scope.rate_limits.delay_seconds
        ),
        max_commands_per_minute=(
            args.max_commands_per_minute
            if args.max_commands_per_minute is not None
            else scope.rate_limits.max_commands_per_minute
        ),
        llm_timeout_seconds=(
            args.llm_timeout_seconds
            if args.llm_timeout_seconds is not None
            else 240
        ),
        rate_limit_notes=scope.rate_limits.notes,
        allow_all_hosts=args.allow_all_hosts,
        max_repeated_commands=args.max_repeated_commands,
    )
    agent = BountyAgent(scope, args.target, settings, runs_dir)
    run_dir = agent.run()
    print(f"Run complete: {run_dir}")
    print(f"Report: {run_dir / 'report.md'}")
    return 0


def resolve_program_path(program: Path | None, engagement: Path | None) -> Path:
    if program:
        return program
    if engagement:
        return engagement / "program" / "scope.json"
    raise SystemExit("Either --program or --engagement is required.")


def resolve_runs_dir(runs_dir: Path | None, engagement: Path | None) -> Path:
    if runs_dir:
        return runs_dir
    if engagement:
        return engagement / "agent" / "runs"
    return Path("runs")


def resolve_prompt_path(prompt: Path | None, engagement: Path | None) -> Path | None:
    if prompt:
        return prompt
    if engagement:
        return engagement / "program" / "prompt.md"
    return None


def resolve_docker_env_file(docker_env_file: Path | None, engagement: Path | None) -> Path | None:
    if docker_env_file:
        return docker_env_file
    if engagement:
        candidate = engagement / "program" / "secrets.env"
        return candidate if candidate.exists() else None
    return None


def read_optional_text(path: Path | None) -> str:
    if path is None or not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
