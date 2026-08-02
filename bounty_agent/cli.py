from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

from .agent import BountyAgent
from .cleaner import CleanerPass
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
    parser.add_argument("--target", help="Target URL, domain, or IP to test. Optional when --engagement is supplied.")
    parser.add_argument("--mode", choices=["mapping", "recon", "attack", "assistant", "auto"], default="auto")
    parser.add_argument("--provider", choices=sorted(PROVIDER_DEFAULTS), default="ollama")
    parser.add_argument("--model", help="OpenAI-compatible model spec, e.g. ollama/qwen2.5-coder:7b.")
    parser.add_argument("--no-llm", action="store_true", help="Do not call an LLM, even if an API key is configured.")
    parser.add_argument("--llm-base-url", help="OpenAI-compatible base URL. Defaults from --provider.")
    parser.add_argument("--llm-api-key", help="API key. Defaults from GROQ_API_KEY or OLLAMA_API_KEY.")
    parser.add_argument("--prompt", type=Path, help="Custom operator prompt file. Defaults to engagement/program/prompt.md.")
    parser.add_argument("--command-delay-seconds", type=float, help="Minimum delay before each executed bash tool call.")
    parser.add_argument("--max-commands-per-minute", type=int, help="Maximum executed bash tool calls per minute.")
    parser.add_argument("--max-steps", type=int, default=12)
    parser.add_argument("--max-repeated-commands", type=int, default=5)
    parser.add_argument("--max-malformed-responses", type=int, default=10)
    parser.add_argument("--llm-timeout-seconds", type=int, help="Timeout seconds for LLM HTTP calls.")
    parser.add_argument("--auth-file", type=Path, help="Optional auth context file with cookies, headers, tokens, or login notes.")
    parser.add_argument("--source-dir", type=Path, help="Optional local source tree to map without executing it.")
    parser.add_argument("--har-file", type=Path, action="append", default=[], help="Optional browser HAR capture to import as local evidence. Repeatable.")
    parser.add_argument("--priority-file", type=Path, help="Optional file listing targets or endpoints to test in depth first.")
    parser.add_argument("--allow-all-hosts", action="store_true", help="Allow all hosts and skip scope blocking.")
    parser.add_argument("--runs-dir", type=Path, help="Output directory for run artifacts.")
    parser.add_argument("--engagement-db", type=Path, help="Curated engagement recon database. Defaults beside engagement runs.")
    parser.add_argument("--runner", choices=["local", "docker"], default="local")
    parser.add_argument("--docker-image", default="bounty-sandbox")
    parser.add_argument("--docker-env-file", type=Path, help="Optional env file passed into the Docker sandbox.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and trace planned actions without execution.")
    parser.add_argument("--execute", action="store_true", help="Actually run approved commands. Default is dry-run.")
    parser.add_argument("--clean", action="store_true", help="Run the cleaner pass: audit curated engagement assets and write cleaner-report.md.")
    parser.add_argument("--clean-apply", action="store_true", help="Same as --clean but also attempt to apply corrections.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    load_env_file(Path(".env"))
    program_path = resolve_program_path(args.program, args.engagement)
    prompt_path = resolve_prompt_path(args.prompt, args.engagement)
    runs_dir = resolve_runs_dir(args.runs_dir, args.engagement)
    docker_env_file = resolve_docker_env_file(args.docker_env_file, args.engagement)
    scope = resolve_program_scope(program_path, args.engagement)
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
    targets = resolve_targets(args.target, args.engagement, scope)
    if not targets:
        raise SystemExit("No targets found. Provide --target or an engagement with an in-scope asset list.")
    primary_target = targets[0]
    settings = AgentSettings(
        model=model,
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        mode=args.mode,
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
            else 480
        ),
        rate_limit_notes=scope.rate_limits.notes,
        allow_all_hosts=args.allow_all_hosts,
        max_repeated_commands=args.max_repeated_commands,
        max_malformed_responses=max(1, args.max_malformed_responses),
        engagement_db_path=resolve_engagement_db_path(args.engagement_db, runs_dir, args.engagement),
        session_run_dir=build_session_run_dir(runs_dir, primary_target),
        session_targets=tuple(targets),
        queue_path=(args.engagement / "agent" / "target-queue.json") if args.engagement else None,
        auth_context_path=resolve_auth_context_path(args.auth_file, args.engagement),
        priority_targets_path=resolve_priority_targets_path(args.priority_file, args.engagement),
        source_code_path=args.source_dir,
        har_paths=tuple(args.har_file),
    )
    if args.clean or args.clean_apply:
        if not args.engagement:
            raise SystemExit("--clean requires --engagement.")
        cleaner = CleanerPass(args.engagement, apply=args.clean_apply)
        report = cleaner.run()
        print(f"Cleaner report: {report}")
        return 0

    agent = BountyAgent(scope, primary_target, settings, runs_dir)
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


def resolve_auth_context_path(auth_file: Path | None, engagement: Path | None) -> Path | None:
    if auth_file:
        return auth_file
    if engagement:
        for name in ("auth.txt", "auth.md", "auth.json", "auth.env", "authenticated.txt"):
            candidate = engagement / "program" / name
            if candidate.exists():
                return candidate
    return None


def resolve_priority_targets_path(priority_file: Path | None, engagement: Path | None) -> Path | None:
    if priority_file:
        return priority_file
    if engagement:
        for name in ("priority-targets.txt", "priority.txt", "deep-targets.txt"):
            candidate = engagement / "program" / name
            if candidate.exists():
                return candidate
    return None


def resolve_engagement_db_path(engagement_db: Path | None, runs_dir: Path, engagement: Path | None) -> Path:
    if engagement_db:
        return engagement_db
    if engagement:
        return engagement / "agent" / "knowledge.db"
    return runs_dir / "knowledge.db"


def build_session_run_dir(runs_dir: Path, target: str) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", target).strip("-")[:80] or "session"
    return runs_dir / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slug}"


def resolve_program_scope(program_path: Path, engagement: Path | None) -> ProgramScope:
    scope = ProgramScope.from_file(program_path)
    if engagement is None:
        return scope
    in_scope_path = engagement / "program" / "in-scope.txt"
    if not in_scope_path.exists():
        return scope
    parsed_hosts = _collect_scope_hosts(in_scope_path.read_text(encoding="utf-8"))
    if not parsed_hosts:
        return scope
    merged_domains = list(dict.fromkeys([*scope.allowed_domains, *parsed_hosts]))
    return ProgramScope(
        program_name=scope.program_name,
        allowed_domains=merged_domains,
        excluded_domains=list(scope.excluded_domains),
        allowed_urls=list(scope.allowed_urls),
        notes=scope.notes,
        rate_limits=scope.rate_limits,
    )


def resolve_targets(target: str | None, engagement: Path | None, scope: ProgramScope | None = None) -> list[str]:
    if engagement is None:
        return [target] if target else []

    queue_path = engagement / "agent" / "target-queue.json"
    seeded_targets = _seed_targets_from_engagement(engagement, target)
    pending_queue = _load_target_queue(queue_path)
    if pending_queue:
        merged = list(dict.fromkeys([*pending_queue, *seeded_targets]))
        _write_target_queue(queue_path, merged)
        return merged

    if seeded_targets:
        _write_target_queue(queue_path, seeded_targets)
    return seeded_targets


def _seed_targets_from_engagement(engagement: Path, target: str | None) -> list[str]:
    seeded: list[str] = []
    mapping_targets = _collect_mapping_state_targets(engagement)
    in_scope_targets = _collect_in_scope_targets(engagement)
    if target:
        seeded.append(target)
    seeded.extend(in_scope_targets)
    seeded.extend(mapping_targets)
    return list(dict.fromkeys([item for item in seeded if item]))


def _collect_in_scope_targets(engagement: Path) -> list[str]:
    in_scope_path = engagement / "program" / "in-scope.txt"
    if not in_scope_path.exists():
        return []
    parsed_targets: list[str] = []
    for line in in_scope_path.read_text(encoding="utf-8").splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#"):
            continue
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            parsed_targets.append(cleaned)
            continue
        if _looks_like_target(cleaned):
            parsed_targets.append(cleaned)
    return list(dict.fromkeys(parsed_targets))


def _collect_mapping_state_targets(engagement: Path) -> list[str]:
    runs_dir = engagement / "agent" / "runs"
    if not runs_dir.exists():
        return []

    candidate_files = sorted(runs_dir.rglob("mapping-state.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for mapping_path in candidate_files:
        try:
            data = json.loads(mapping_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        raw_targets = data.get("targets")
        if isinstance(raw_targets, list):
            targets = []
            for item in raw_targets:
                normalized = _normalize_mapping_target(item)
                if normalized and normalized not in targets:
                    targets.append(normalized)
            if targets:
                return targets

        raw_hosts = data.get("hosts")
        if isinstance(raw_hosts, list):
            targets = []
            for item in raw_hosts:
                normalized = _normalize_mapping_target(item)
                if normalized and normalized not in targets:
                    targets.append(normalized)
            if targets:
                return targets
    return []


def _normalize_mapping_target(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.startswith("#"):
        return None
    if cleaned.startswith(("http://", "https://")):
        return cleaned
    if _looks_like_target(cleaned):
        return cleaned
    return None


def consume_next_target(target: str | None, engagement: Path | None, scope: ProgramScope | None = None) -> str | None:
    if engagement is None:
        return target

    queue_path = engagement / "agent" / "target-queue.json"
    pending_queue = _load_target_queue(queue_path)
    if not pending_queue:
        return None
    next_target = pending_queue[0]
    remaining = pending_queue[1:]
    if target and target not in remaining:
        remaining = [target, *remaining]
    _write_target_queue(queue_path, remaining)
    return next_target


def read_optional_text(path: Path | None) -> str:
    if path is None or not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _load_target_queue(queue_path: Path) -> list[str]:
    if not queue_path.exists():
        return []
    try:
        data = json.loads(queue_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, str) and item.strip()]


def _write_target_queue(queue_path: Path, targets: list[str]) -> None:
    queue_path.parent.mkdir(parents=True, exist_ok=True)
    queue_path.write_text(json.dumps(targets, ensure_ascii=False, indent=2), encoding="utf-8")


def _collect_scope_hosts(text: str) -> list[str]:
    hosts: list[str] = []
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#"):
            continue
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            hosts.append(_extract_host_from_url(cleaned))
            continue
        if _looks_like_target(cleaned):
            hosts.append(cleaned)
    return list(dict.fromkeys([host for host in hosts if host]))


def _looks_like_target(value: str) -> bool:
    if not value:
        return False
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", value):
        return True
    if re.match(r"^[A-Za-z0-9.-]+$", value):
        return True
    return False


def _extract_host_from_url(value: str) -> str:
    from urllib.parse import urlparse

    try:
        parsed = urlparse(value)
    except ValueError:
        return value
    return parsed.hostname or value


if __name__ == "__main__":
    raise SystemExit(main())
