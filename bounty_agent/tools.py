from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shlex
import time
from types import SimpleNamespace
from typing import Any, Optional
from urllib.parse import parse_qs, quote, unquote, urlparse

from .artifact_store import ArtifactStore, artifact_manifest
from .auth_context import AuthContext
from .browser_worker import BROWSER_WORKER_SCRIPT
from .burp_mcp import BurpMcpClient, BurpMcpConfig, MCP_ACTIONS, parse_patch
from .canonical_surface import normalize_url
from .controls import DynamicRateLimiter, GeminiAdjudicator
from .engagement_state import EXPERIMENT_READY_STATES, EngagementStateStore
from .infrastructure import ChallengeType, InfrastructureStore, classify_response, extract_hosts_from_tool_output
from .journeys import BrowserPage, JourneyStore
from .retrieval import RetrievalStore
from .recon_db import (
    NullReconStore,
    ReconObservation,
    ReconStore,
    SurfaceRecord,
    build_attack_results_from_action_result,
    build_facts_from_action_result,
    build_surfaces_from_action_result,
)
from .research import research_probe
from .sandbox import SandboxRunner
from .scope import ScopeGuard
from .skills import get_skill
from .strategy_memory import StrategyMemory
from .trace import TraceLogger
from .workers import get_worker, worker_gate, worker_manifest
from .nuclei import build_nuclei_command, parse_nuclei_jsonl, render_nuclei_summary
from .surface_router import SurfaceRoute, render_route, route_surface
from .auth_pipeline import (
    LoginSpec,
    load_login_spec,
    merge_maintained_cookies,
    parse_login_output,
    render_session_line,
    worker_spec_payload,
)
from .login_worker import LOGIN_WORKER_SCRIPT


@dataclass
class Finding:
    title: str
    severity: str
    asset: str
    evidence: str
    impact: str
    next_steps: str
    request: str = ""
    response: str = ""


@dataclass
class ToolResult:
    ok: bool
    content: str
    meta: dict[str, Any] = field(default_factory=dict)


class ToolRegistry:
    def __init__(
        self,
        runner: SandboxRunner,
        scope_guard: ScopeGuard,
        trace: TraceLogger,
        retrieval: RetrievalStore,
        recon_store: ReconStore | NullReconStore | None = None,
        command_delay_seconds: float = 0.0,
        max_commands_per_minute: int = 0,
        max_repeated_commands: int = 2,
        allow_search: bool = False,
        state_store: EngagementStateStore | None = None,
        artifact_store: ArtifactStore | None = None,
        run_id: str = "",
        max_actions: int = 0,
    ) -> None:
        self.runner = runner
        self.scope_guard = scope_guard
        self.trace = trace
        self.retrieval = retrieval
        self.recon_store = recon_store or NullReconStore()
        self.findings: list[Finding] = []
        self.history: list[tuple[dict[str, Any], ToolResult]] = []
        self.rate_limiter = CommandRateLimiter(command_delay_seconds, max_commands_per_minute, trace)
        self.max_repeated_commands = max(1, max_repeated_commands)
        self.allow_search = allow_search
        self.command_counts: dict[str, int] = {}
        self.skill_counts: dict[str, int] = {}
        self.skill_blocked: set[str] = set()
        self.write_blocked_paths: set[str] = set()
        self.finding_fingerprints: set[str] = set()
        self.tool_presence_count = 0
        self._tool_presence_cache: dict[str, bool] = {}
        self.state_store = state_store
        self.artifact_store = artifact_store
        self.run_id = run_id
        self.active_objective_id: str | None = None
        self.active_hypothesis_id: str | None = None
        self.active_target = ""
        self.active_worker_name: str | None = None
        self._surface_routes: dict[str, SurfaceRoute] = {}
        self.max_actions = max(0, max_actions)
        self.action_count = 0

        self._infra_store: Optional[InfrastructureStore] = None
        self._strategy_memory: Optional[StrategyMemory] = None
        self._auth_context: Optional[AuthContext] = None
        self._adjudicator: Any = None
        self.scorecard: Any | None = None
        self._burp_mcp_client: Optional[BurpMcpClient] = None
        self._journey_store: JourneyStore | None = None
        self._world_model: Any | None = None
        self._session_manager: Any | None = None
        self._auth_context_path: Path | None = None
        self._engagement_id: str = ""

    def set_infrastructure_store(self, store: InfrastructureStore) -> None:
        """Attach infrastructure store for WAF/challenge awareness."""
        self._infra_store = store

    def set_strategy_memory(self, memory: StrategyMemory) -> None:
        """Attach strategy memory for preventing retry loops."""
        self._strategy_memory = memory

    def set_auth_context(self, auth_context: AuthContext) -> None:
        """Attach structured auth context for cookie injection."""
        self._auth_context = auth_context

    def set_endpoint_tracker(self, tracker: Any) -> None:
        """Attach the Milestone 2 endpoint exhaustion tracker."""
        self._endpoint_tracker = tracker

    def set_auth_gate_classifier(self, classifier: Any) -> None:
        """Attach the Milestone 2 auth-gate classifier."""
        self._auth_gate_classifier = classifier

    def set_adjudicator(self, adjudicator: Any) -> None:
        """Attach the Milestone 4.2 cross-model adjudicator."""
        self._adjudicator = adjudicator

    def set_scorecard(self, scorecard: Any | None) -> None:
        """Attach an optional benchmark scorecard for live measurement."""
        self.scorecard = scorecard

    def set_burp_mcp_client(self, client: BurpMcpClient | None) -> None:
        """Attach the Burp MCP adapter for high-level captured-request operations."""
        self._burp_mcp_client = client

    def set_journey_store(self, store: JourneyStore | None) -> None:
        """Attach durable browser journey storage for browser captures."""
        self._journey_store = store

    def set_world_model(self, model: Any | None) -> None:
        """Attach the engagement world model for bounded model queries."""
        self._world_model = model

    def set_session_manager(self, manager: Any | None) -> None:
        """Attach the first-class session/auth-lane manager."""
        self._session_manager = manager

    def set_auth_context_path(self, path: Path | None) -> None:
        """Path to the engagement auth JSON (login spec + cookie groups)."""
        self._auth_context_path = path

    def set_engagement_id(self, engagement_id: str) -> None:
        """Stable engagement id sessions are partitioned under.

        Must match the id the agent uses when reading the session lane
        (``stable_id("engagement", db_parent, program_name)``); defaults to the
        run id when never set.
        """
        self._engagement_id = engagement_id

    def _session_engagement_id(self) -> str:
        return self._engagement_id or self.run_id

    def set_execution_context(self, *, objective_id: str | None = None, hypothesis_id: str | None = None,
                              target: str = "") -> None:
        """Attach all subsequent actions to the current security objective."""
        self.active_objective_id = objective_id
        self.active_hypothesis_id = hypothesis_id
        self.active_target = target

    def _select_worker(self, action: dict[str, Any]) -> ToolResult:
        """Activate a specialist worker and enforce its action contract."""
        name = str(action.get("name") or "").strip()
        if not name:
            return ToolResult(False, "select_worker requires a worker name. Use list_workers to see options.")
        worker = get_worker(name)
        if worker is None:
            available = [w["name"] for w in worker_manifest()]
            return ToolResult(False, f"Unknown worker '{name}'. Available: {', '.join(available)}.", {"available_workers": available})
        self.active_worker_name = name
        lines = [f"Worker '{worker.name}' active.", f"Mission: {worker.mission}"]
        lines.append(f"Allowed actions: {', '.join(worker.allowed_actions) or '(none)'}")
        lines.append(f"Required evidence: {', '.join(worker.evidence_required) or 'none'}")
        return ToolResult(True, "\n".join(lines), {"active_worker": name})

    def _list_workers(self, action: dict[str, Any]) -> ToolResult:
        manifest = worker_manifest()
        lines = [f"- {w['name']}: {w['mission']}" for w in manifest]
        return ToolResult(True, "\n".join(lines), {"workers": [w["name"] for w in manifest]})

    def execute(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("action", "")).strip()
        if name != "finish" and self.max_actions and self.action_count >= self.max_actions:
            result = ToolResult(
                False,
                f"Action budget exhausted ({self.action_count}/{self.max_actions}). Preserve evidence and finish or defer.",
                {"budget_blocked": True, "actions_used": self.action_count, "actions_limit": self.max_actions},
            )
            self.trace.write("tool_result", ok=result.ok, content=_truncate(result.content), meta=result.meta)
            self.history.append((action, result))
            self._record_recon_state(action, result)
            self._record_phase_one_state(action, result)
            return result
        if name != "finish":
            self.action_count += 1
        self.trace.write("tool_call", action=action)
        experiment_hypothesis_id: str | None = None
        # Reset consecutive search counter on non-search actions
        if name != "search":
            self._consecutive_search_count = 0
        try:
            gate_error = worker_gate(self.active_worker_name, name)
            hypothesis_error = ""
            if not gate_error and _requires_hypothesis(action):
                hypothesis_error, experiment_hypothesis_id = self._experiment_hypothesis_gate(action)
            if gate_error:
                result = ToolResult(False, gate_error, {"worker_gate_blocked": True, "active_worker": self.active_worker_name})
            elif hypothesis_error:
                result = ToolResult(
                    False,
                    hypothesis_error,
                    {"hypothesis_required": True},
                )
            elif name == "bash":
                result = self._bash(action)
            elif name == "nuclei":
                result = self._nuclei_action(action)
            elif name in _TOOL_ACTIONS:
                result = self._tool_action(action)
            elif name == "search":
                result = self._search(action) if self.allow_search else ToolResult(
                    False,
                    "Internet search is disabled in mapping, recon, and attack modes. Use observed target evidence and installed tools.",
                    {"search_disabled": True},
                )
            elif name == "read_file":
                result = self._read_file(action)
            elif name == "browser_map":
                result = self._browser_map(action)
            elif name in {"list_journeys", "get_journey_steps", "search_journey_requests", "get_journey_request"}:
                result = self._journey_action(action)
            elif name in {"world_model_summary", "search_world_model"}:
                result = self._world_model_action(action)
            elif name == "route_surface":
                result = self._route_surface(action)
            elif name in {"perform_login", "verify_session", "renew_session", "session_status"}:
                result = self._auth_action(action)
            elif name == "list_artifacts":
                result = self._list_artifacts(action)
            elif name == "search_artifact":
                result = self._search_artifact(action)
            elif name == "read_artifact_slice":
                result = self._read_artifact_slice(action)
            elif name == "read_artifact_context":
                result = self._read_artifact_context(action)
            elif name == "summarize_artifact":
                result = self._summarize_artifact(action)
            elif name == "write_file":
                result = self._write_file(action)
            elif name == "list_files":
                result = self._list_files(action)
            elif name == "use_skill":
                result = self._use_skill(action)
            elif name == "research":
                result = self._research(action)
            elif name == "record_finding":
                result = self._record_finding(action)
            elif name == "create_objective":
                result = self._create_objective(action)
            elif name == "create_hypothesis":
                result = self._create_hypothesis(action)
            elif name == "record_evidence":
                result = self._record_evidence(action)
            elif name == "save_artifact":
                result = self._save_artifact(action)
            elif name == "create_verifier":
                result = self._create_verifier(action)
            elif name == "finish":
                result = ToolResult(True, "Finished.")
            elif name == "select_worker":
                result = self._select_worker(action)
            elif name == "list_workers":
                result = self._list_workers(action)
            elif name == "burp_send":
                result = self._burp_send(action)
            elif name == "burp_history":
                result = self._burp_history(action)
            elif name in MCP_ACTIONS:
                result = self._burp_mcp_action(action)
            else:
                result = ToolResult(False, f"Unsupported action: {name}")
        except Exception as exc:
            result = ToolResult(False, f"{type(exc).__name__}: {exc}")
        if experiment_hypothesis_id and self.state_store:
            self.state_store.transition_hypothesis(experiment_hypothesis_id, "experiment_attempted")
            result.meta["hypothesis_id"] = experiment_hypothesis_id
            result.meta["hypothesis_state"] = "experiment_attempted"
        self.trace.write("tool_result", ok=result.ok, content=_truncate(result.content), meta=result.meta)
        self.history.append((action, result))
        self._burn_failed_tool(action, result)
        self._record_recon_state(action, result)
        self._record_phase_one_state(action, result)
        self._record_scorecard_event(action, result)
        return result

    def _experiment_hypothesis_gate(self, action: dict[str, Any]) -> tuple[str, str | None]:
        """Require a durable, non-terminal hypothesis for an active experiment."""
        if not self.state_store:
            return "Structured engagement state is required before running an intrusive experiment.", None
        hypothesis_id = str(action.get("hypothesis_id") or self.active_hypothesis_id or "").strip()
        if not hypothesis_id:
            return (
                "This attack action requires a recorded hypothesis first. Use create_hypothesis with the security question and required evidence, then run one bounded experiment.",
                None,
            )
        hypothesis = self.state_store.hypothesis(hypothesis_id)
        if not hypothesis:
            return f"Hypothesis '{hypothesis_id}' does not exist. Create or select a recorded hypothesis before testing.", None
        if str(hypothesis.get("state", "")) not in EXPERIMENT_READY_STATES:
            return (
                f"Hypothesis '{hypothesis_id}' is in terminal state '{hypothesis.get('state')}'. Create or select an unresolved hypothesis before testing.",
                None,
            )
        return "", hypothesis_id

    def _record_phase_one_state(self, action: dict[str, Any], result: ToolResult) -> None:
        if not self.state_store:
            return
        try:
            target = _action_target(action) or self.active_target
            objective_id = str(action.get("objective_id") or self.active_objective_id or "") or None
            hypothesis_id = str(action.get("hypothesis_id") or self.active_hypothesis_id or "") or None
            self.state_store.record_action(
                self.run_id, action, result.ok, result.content, target=target,
                objective_id=objective_id, hypothesis_id=hypothesis_id, meta=result.meta,
            )
            artifact_id = str(result.meta.get("artifact_id") or "")
            artifact_path = str(result.meta.get("artifact_absolute_path") or result.meta.get("artifact_path") or "")
            if artifact_id and artifact_path:
                self.state_store.save_artifact(
                    "evidence", Path(artifact_path), result.content.splitlines()[0] if result.content else "Captured evidence artifact",
                    source=f"run:{self.run_id}", meta={"artifact_id": artifact_id, **result.meta},
                )
            if "=present" in result.content or "=missing" in result.content:
                self.state_store.record_tool_inventory(result.content, source=f"run:{self.run_id}")
        except Exception as exc:
            self.trace.write("phase_one_state_error", error=f"{type(exc).__name__}: {exc}")

    def _record_recon_state(self, action: dict[str, Any], result: ToolResult) -> None:
        source = f"tool:{len(self.history)}"
        target = _action_target(action)
        try:
            self.recon_store.add_observation(
                ReconObservation(
                    action=str(action.get("action", "")),
                    target=target,
                    summary=_truncate(result.content, 1200),
                    ok=result.ok,
                    source=source,
                    tags=tuple(_action_tags(action, result)),
                    meta={"action": action, "result_meta": result.meta},
                )
            )
            for surface in build_surfaces_from_action_result(action, result.ok, result.content, source):
                self.recon_store.upsert_surface(surface)
            for attack in build_attack_results_from_action_result(action, result.ok, result.content, source):
                self.recon_store.upsert_attack_result(attack)
                self._record_surface_outcome(attack)
            for fact in build_facts_from_action_result(action, result.ok, result.content, source):
                self.recon_store.upsert_fact(fact)
        except Exception as exc:
            self.trace.write("recon_state_error", error=f"{type(exc).__name__}: {exc}")

    def _bash(self, action: dict[str, Any]) -> ToolResult:
        command = str(action.get("command", "")).strip()
        timeout = int(action.get("timeout_seconds", self.runner.settings.command_timeout_seconds))
        if not command:
            return ToolResult(False, "Missing command.")

        safety_result = _validate_command_safety(command)
        if safety_result:
            return safety_result

        # Block login/credential commands when no auth context is supplied
        if not self._auth_context and _is_login_or_credential_command(command):
            return ToolResult(
                False,
                "Login/credential commands are blocked because no auth context was supplied. "
                "Do not attempt to create accounts or guess credentials. "
                "Use observed public endpoints and supplied auth context only.",
                {"login_blocked": True, "reason": "no_auth_context"},
            )

        repeat_result = self._check_repeated_command(command)
        if repeat_result:
            return repeat_result
        # Milestone 2: ban bulk-python endpoint scanning anti-pattern
        if is_bulk_python_scan(command):
            return ToolResult(
                False,
                "Bulk per-target python scanning is blocked. Write a single-purpose "
                "verifier for one endpoint, or use a dedicated tool "
                "(httpx, katana, sqlmap, dalfox).",
                {"bulk_python_blocked": True},
            )
        if _is_baseline_recon_command(command):
            self.tool_presence_count += 1
            if self.tool_presence_count > 2:
                return ToolResult(
                    False,
                    "Baseline tool-presence inventory blocked after 2 runs. "
                    "Use the existing inventory and move to discovery, fingerprinting, or a bounded verification script.",
                    {"tool_presence_blocked": True, "count": self.tool_presence_count},
                )

        # Cookie group injection from structured auth context.
        # Prefer an explicit auth_group when supplied, but also fall back to a
        # matching target entry so authenticated probes still reuse cookies even
        # when the model does not spell out the group.
        if self._auth_context:
            auth_group = str(action.get("auth_group", "") or "").strip()
            target_for_auth = self.active_target or _action_target(action) or ""
            cookie_header = ""
            extra_headers = {}
            if auth_group:
                cookie_header = self._auth_context.cookie_header_for_group(target_for_auth, auth_group)
                extra_headers = self._auth_context.extra_headers_for_group(target_for_auth, auth_group)
            elif target_for_auth:
                matched = self._auth_context._find_target(target_for_auth)
                if matched and matched.cookie_groups:
                    first_group = matched.cookie_groups[0]
                    cookie_header = self._auth_context.cookie_header_for_group(target_for_auth, first_group.group_id)
                    extra_headers = self._auth_context.extra_headers_for_group(target_for_auth, first_group.group_id)
            if cookie_header and ("curl" in command or "httpx" in command):
                if "-H" not in command:
                    cmd_cookies = f" -H 'Cookie: {cookie_header}'"
                    command += cmd_cookies
                for hdr_name, hdr_value in extra_headers.items():
                    if hdr_name.lower() not in ("cookie", "authorization"):
                        command += f" -H '{hdr_name}: {hdr_value}'"
            elif cookie_header and ("--cookie" not in command):
                if "httpx" in command:
                    command = command.replace("httpx", f"httpx -H 'Cookie: {cookie_header}'", 1)
                elif "katana" in command:
                    command = command.replace("katana", f"katana -H 'Cookie: {cookie_header}'", 1)

        scope = self.scope_guard.validate_command(command)
        if not scope.allowed:
            return ToolResult(False, f"Scope blocked command: {scope.reason}", {"hosts": scope.hosts})

        self.rate_limiter.wait()
        result = self.runner.exec(command, timeout)
        self._add_discovered_hosts(result.stdout or "", result.stderr or "")

        # Milestone 4.1: record rate-limit hits for dynamic backoff
        combined = (result.stdout or "") + " " + (result.stderr or "")
        exit_ok = result.exit_code == 0
        if not exit_ok and re.search(r"\b(429|403)\b", combined):
            dynamic = getattr(self.rate_limiter, "_dynamic", None)
            if dynamic is not None:
                dynamic.record_rate_limit_hit()
            result.meta["rate_limit_hit"] = True

        # Infrastructure-aware block detection using classify_response

        # Only classify if the command had an error and looks like HTTP output
        infra_classified = False
        infra_profile = None
        if not exit_ok and any(marker in combined.lower() for marker in ["403", "429", "cloudflare", "waf", "rate limit", "too many requests", "cloudfront", "attention required"]):
            # Attempt to extract status code, headers, and body from tool output
            status_code = 0
            status_match = re.search(r"STATUS:\s*(\d{3})", combined)
            if status_match:
                status_code = int(status_match.group(1))
            elif re.search(r"(403|429|503|520|521|522|523|524|525|526)", combined):
                for code in [403, 429, 503, 520, 521, 522, 523, 524, 525, 526]:
                    if str(code) in combined:
                        status_code = code
                        break

            # Extract headers from stdout if present
            headers_raw = {}
            header_section = ""
            header_match = re.search(r"HEADERS: (\{.*?\}|\[.*?\])", combined, re.DOTALL)
            if header_match:
                header_section = header_match.group(1)
                try:
                    headers_raw = json.loads(header_section)
                except (json.JSONDecodeError, ValueError):
                    pass

            # Extract body excerpt
            body_match = re.search(r"BODY: (.+)", combined, re.DOTALL)
            body_excerpt = body_match.group(1)[:2000] if body_match else ""
            if not body_excerpt:
                body_excerpt = combined[:2000]

            # Use class-wide infrastructure store if available
            try:
                if status_code >= 400:
                    infra_profile = classify_response(status_code, headers_raw or None, body_excerpt)
                    infra_classified = True
                    # Record in infrastructure store
                    if hasattr(self, '_infra_store') and self._infra_store:
                        self._infra_store.record(infra_profile)

                    # Don't retry if the challenge is terminal (needs browser, IP blocked)
                    if infra_profile.challenge_type in (
                        ChallengeType.JS_CHALLENGE,
                        ChallengeType.MANAGED_CHALLENGE,
                        ChallengeType.IP_BLOCK,
                    ):
                        # No retry — just return the classified result
                        self._ip_block_count = 0
                        content = (
                            f"exit_code={result.exit_code} timed_out={result.timed_out}\n"
                            f"--- stdout ---\n{_truncate(result.stdout)}\n"
                            f"--- stderr ---\n{_truncate(result.stderr)}\n"
                            f"--- infrastructure ---\n"
                            f"provider={infra_profile.provider.value}\n"
                            f"challenge={infra_profile.challenge_type.value}\n"
                            f"needs_browser={infra_profile.requires_browser}\n"
                            f"needs_session={infra_profile.requires_session}\n"
                        )
                        return ToolResult(False, content, {"infra_detected": True, "infra_profile": infra_profile.to_dict()})
            except Exception:
                infra_classified = False

            # Fallback: original retry logic for non-classified blocks
            if not infra_classified:
                block_count = getattr(self, "_ip_block_count", 0) + 1
                self._ip_block_count = block_count
                if block_count <= 3:
                    wait_time = 60 * block_count  # 60s, 120s, 180s
                    self.trace.write("ip_block_detected", wait_seconds=wait_time, attempt=block_count)
                    time.sleep(wait_time)
                    # Retry once after waiting
                    result = self.runner.exec(command, timeout)
                    self._add_discovered_hosts(result.stdout or "", result.stderr or "")
            # Also update ip_block_count even if classified, to prevent infinite retries
            elif infra_profile and infra_profile.retry_cooldown_seconds > 0:
                setattr(self, "_ip_block_count", (getattr(self, "_ip_block_count", 0) + 1))
        else:
            self._ip_block_count = 0

        artifact_meta, artifact_line = self._capture_command_artifact(command, result)
        content = (
            f"exit_code={result.exit_code} timed_out={result.timed_out}{artifact_line}\n"
            f"--- stdout preview ---\n{_truncate(result.stdout, 3000)}\n"
            f"--- stderr preview ---\n{_truncate(result.stderr, 1500)}\n"
            "Use search_artifact or read_artifact_slice with artifact_id for additional evidence."
        )
        return ToolResult(result.exit_code == 0, content, artifact_meta)

    def _capture_command_artifact(self, command: str, result: Any) -> tuple[dict[str, Any], str]:
        if not self.artifact_store or not (result.stdout or result.stderr):
            return {}, ""
        record = self.artifact_store.capture_command(
            command, result.stdout or "", result.stderr or "", exit_code=result.exit_code,
            timed_out=result.timed_out,
        )
        return {
            "artifact_id": record.artifact_id,
            "artifact_path": record.path,
            "artifact_absolute_path": str(self.artifact_store.workspace / record.path),
        }, "\nRaw output preserved: " + artifact_manifest(record)

    def _tool_action(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("action", "")).strip()
        schema_result = _validate_tool_action_schema(name, action)
        if schema_result:
            return schema_result
        url = str(action.get("url") or action.get("target") or action.get("path") or "").strip()
        host = str(action.get("host") or "").strip()
        if not url and host:
            url = host
        if not url:
            return ToolResult(False, f"Missing target for {name} action.")
        command = _build_tool_command(name, url, action)
        return self._bash({**action, "action": "bash", "command": command, "timeout_seconds": action.get("timeout_seconds", self.runner.settings.command_timeout_seconds)})

    def _nuclei_action(self, action: dict[str, Any]) -> ToolResult:
        """Run nuclei deterministically and render a record_finding-ready summary.

        Outputs JSONL to a per-target file, parses it back into deduplicated,
        severity-sorted findings, and returns a compact summary the model can
        act on directly (instead of a raw banner/result dump).
        """
        name = str(action.get("action", "")).strip()
        schema_result = _validate_tool_action_schema(name, action)
        if schema_result:
            return schema_result
        url = str(action.get("url") or action.get("target") or action.get("path") or "").strip()
        if not url:
            return ToolResult(False, "Missing target for nuclei action.")
        decision = self.scope_guard.validate_target(url)
        if not decision.allowed:
            return ToolResult(False, f"Scope blocked nuclei: {decision.reason}")
        digest = hashlib.sha256(url.encode("utf-8", errors="replace")).hexdigest()[:12]
        output_path = f"nuclei-{digest}.jsonl"
        command = build_nuclei_command(
            url,
            severity=str(action.get("severity", "")).strip(),
            tags=str(action.get("tags", "")).strip(),
            output_path=output_path,
        )
        result = self._bash({
            "action": "bash",
            "command": command,
            "timeout_seconds": action.get("timeout_seconds", 300),
        })
        if not result.ok:
            return result
        raw = ""
        try:
            raw = self.runner.read_file(output_path)
        except Exception:
            raw = ""
        findings = parse_nuclei_jsonl(raw)
        summary = render_nuclei_summary(findings, url)
        return ToolResult(True, summary, {"nuclei_findings": len(findings), "nuclei_target": url})

    def _route_surface(self, action: dict[str, Any]) -> ToolResult:
        """Fingerprint a surface and return its ordered fallback ladder.

        Advisory: the router answers "what should I try next here?" so the
        model doesn't re-pick a tool that already failed.  Burned rungs are
        tracked per surface and persist for the run.
        """
        url = str(action.get("url") or action.get("target") or action.get("host") or "").strip()
        if not url:
            return ToolResult(False, "Missing target for route_surface action.")
        route = route_surface(url, prior_failures=self._burned_for(url))
        self._surface_routes[_surface_route_key(url)] = route
        return ToolResult(True, render_route(route), {
            "surface_type": route.surface_type,
            "technologies": list(route.technologies),
            "next_tool": route.next_rung().tool if route.next_rung() else "",
        })

    def _burn_failed_tool(self, action: dict[str, Any], result: ToolResult) -> None:
        """When a tool action fails against a routed surface, burn that rung so
        the router's next_rung() skips it (fallback ladder instead of retrying
        the dead tool)."""
        if result.ok:
            return
        name = str(action.get("action", "")).strip()
        if name not in _TOOL_ACTIONS and name != "browser_map":
            return
        target = str(action.get("url") or action.get("target") or action.get("host") or "").strip()
        if not target:
            return
        try:
            route = self._surface_routes.get(_surface_route_key(target))
            if route is not None:
                route.burn(name)
        except Exception:
            pass

    def _burned_for(self, url: str) -> list[str]:
        """Look up already-failed tools for the surface this URL belongs to."""
        route = self._surface_routes.get(_surface_route_key(url))
        return list(route.burned) if route else []

    # ── Auth pipeline (simple id+password login, cookie renewal) ────────────

    def _auth_action(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("action", "")).strip()
        if name == "session_status":
            return self._session_status()
        if self._session_manager is None:
            return ToolResult(False, "Session manager is not attached; auth lane unavailable.", {"auth_disabled": True})
        if name == "perform_login":
            return self._perform_login()
        if name == "verify_session":
            return self._verify_session(str(action.get("alias") or ""))
        if name == "renew_session":
            return self._renew_session(str(action.get("alias") or ""))
        return ToolResult(False, f"Unknown auth action '{name}'.")

    def _login_spec(self) -> LoginSpec | None:
        return load_login_spec(self._auth_context_path)

    def _perform_login(self) -> ToolResult:
        """Execute the Playwright id+password login and register the session."""
        spec = self._login_spec()
        if spec is None:
            return ToolResult(
                False,
                "No login spec found. Add a top-level \"login\" block to the engagement auth JSON "
                "(url, username_env, password_env, optional selectors/verify_url). Credentials are read "
                "from the named environment variables, never from the spec.",
                {"login_spec_missing": True},
            )
        decision = self.scope_guard.validate_target(spec.login_url)
        if not decision.allowed:
            return ToolResult(False, f"Scope blocked perform_login: {decision.reason}")
        if spec.verify_url:
            verify_decision = self.scope_guard.validate_target(spec.verify_url)
            if not verify_decision.allowed:
                return ToolResult(False, f"Scope blocked perform_login verify_url: {verify_decision.reason}")

        digest = hashlib.sha256(spec.login_url.encode("utf-8", errors="replace")).hexdigest()[:12]
        script_path = ".chainsaw_login_worker.py"
        spec_path = f"auth/login-spec-{digest}.json"
        output_path = f"auth/login-output-{digest}.json"
        self.runner.write_file(script_path, LOGIN_WORKER_SCRIPT)
        # The spec file names env vars only — no secret values are written.
        self.runner.write_file(spec_path, json.dumps(worker_spec_payload(spec), indent=2))
        import sys
        python_bin = "/opt/venv/bin/python3" if self.runner.__class__.__name__ == "DockerSandboxRunner" else sys.executable
        command = (
            f"{python_bin} {shlex.quote(script_path)} --spec {shlex.quote(spec_path)} "
            f"--output {shlex.quote(output_path)} --timeout-ms 30000"
        )
        run = self._bash({"action": "bash", "command": command, "timeout_seconds": 180})
        if not run.ok:
            return ToolResult(False, f"perform_login worker failed: {run.content}", run.meta)
        try:
            outcome = parse_login_output(self.runner.read_file(output_path))
        except (OSError, ValueError) as exc:
            return ToolResult(False, f"perform_login produced no readable output: {type(exc).__name__}: {exc}", run.meta)

        if not outcome.success:
            session = self._session_manager.create_session(
                alias=spec.session_alias, engagement_id=self._session_engagement_id(), source="credentials",
                auth_mechanism="form-login", domains=(), role=spec.role, tenant=spec.tenant, status="failed",
            )
            self._session_manager.update_status(session.id, "failed", failure_reason=outcome.error or "login did not reach success state")
            return ToolResult(False, f"Login failed: {outcome.error or 'success condition not met'}", {"login_success": False})

        session = self._register_session(spec, outcome.cookie_map, outcome)
        self._record_login_journey(spec, outcome)
        lines = [
            f"Login succeeded as session '{spec.session_alias}' ({session.id}).",
            f"final_url={outcome.final_url}",
            f"cookies captured: {len(outcome.cookies)} ({', '.join(sorted(outcome.cookie_map)[:8])})",
        ]
        if outcome.verify_ok is not None:
            lines.append(f"verify_url check: {'ok' if outcome.verify_ok else 'FAILED'} (status={outcome.verify_status})")
        return ToolResult(True, "\n".join(lines), {
            "login_success": True, "session_id": session.id, "alias": spec.session_alias,
            "cookie_count": len(outcome.cookies), "domains": list(outcome.cookie_domains),
        })

    def _register_session(self, spec: LoginSpec, cookies: dict[str, str], outcome: Any):
        prior = self._find_session(spec.session_alias)
        if prior is not None and spec.maintain_cookies:
            prior_cookies = dict(getattr(prior, "cookies", None) or {})
            cookies = merge_maintained_cookies(cookies, prior_cookies, spec.maintain_cookies)
        session = self._session_manager.create_session(
            alias=spec.session_alias, engagement_id=self._session_engagement_id(), source="credentials",
            auth_mechanism="form-login", domains=outcome.cookie_domains, role=spec.role,
            tenant=spec.tenant, secret_policy="never-inline", status="active",
        )
        if outcome.verify_ok:
            self._session_manager.mark_verified(session.id, f"verify:{spec.verify_url}")
        if self._world_model is not None and cookies:
            try:
                from .world_model import Session as WorldSession
                self._world_model.upsert_session(WorldSession(
                    id=session.id, context=spec.session_alias, token_type="cookie",
                    role=spec.role, tenant=spec.tenant, cookies=cookies,
                ))
            except Exception:
                pass
        return session

    def _find_session(self, alias: str):
        """Best session for an alias: prefer active/verified, then freshest."""
        matches = [
            s for s in self._session_manager.list_sessions(engagement_id=self._session_engagement_id())
            if s.alias == alias
        ]
        if not matches:
            return None
        rank = {"active": 0, "waiting": 1, "pending": 2, "stale": 3, "expired": 4, "deferred": 5, "failed": 6}
        # ISO timestamps sort lexicographically; invert for freshest-first.
        matches.sort(key=lambda s: str(s.last_verified_at or ""), reverse=True)
        matches.sort(key=lambda s: rank.get(str(s.status), 9))
        return matches[0]

    def _verify_session(self, alias: str) -> ToolResult:
        """Re-check a session lane against its verify URL (cookie-injection)."""
        spec = self._login_spec()
        if spec is None:
            return ToolResult(False, "No login spec; nothing to verify against.", {"login_spec_missing": True})
        session = self._find_session(alias or spec.session_alias)
        if session is None:
            return ToolResult(False, f"No session with alias '{alias or spec.session_alias}'. Run perform_login first.")
        cookies = self._session_cookies(session)
        if not cookies:
            return ToolResult(False, f"Session '{session.alias}' has no stored cookies to verify with.")
        return self._run_verify(spec, session, cookies)

    def _renew_session(self, alias: str) -> ToolResult:
        """Renew a session: re-run the login, preserving operator-maintained cookies."""
        spec = self._login_spec()
        if spec is None:
            return ToolResult(False, "No login spec; cannot renew.", {"login_spec_missing": True})
        session = self._find_session(alias or spec.session_alias)
        if session is not None:
            self._session_manager.update_status(session.id, "stale", failure_reason="renewal requested")
        return self._perform_login()

    def _session_status(self) -> ToolResult:
        if self._session_manager is None:
            return ToolResult(True, "Session lane: none. Continue unauthenticated work.", {"sessions": []})
        sessions = self._session_manager.list_sessions(engagement_id=self._session_engagement_id())
        if not sessions:
            return ToolResult(True, "Session lane: none. Continue unauthenticated work.", {"sessions": []})
        lines = ["Session lane status:"]
        for s in sessions[:5]:
            lines.append(render_session_line(s.alias, s.status, s.auth_mechanism,
                                             role=s.role, domains=tuple(s.domains), failure=s.failure_reason))
        return ToolResult(True, "\n".join(lines), {"sessions": [s.to_dict() for s in sessions[:5]]})

    def _session_cookies(self, session: Any) -> dict[str, str]:
        """Read the session's cookies from the world model (never inline in prompts)."""
        if self._world_model is None:
            return {}
        # World model sessions carry cookie maps keyed by session id.
        try:
            rows = self._world_model.store.conn.execute(
                "SELECT cookies FROM sessions WHERE id=?", (session.id,)
            ).fetchall()
            if rows:
                return {str(k): str(v) for k, v in json.loads(rows[0][0] or "{}").items()}
        except Exception:
            return {}
        return {}

    def _run_verify(self, spec: LoginSpec, session: Any, cookies: dict[str, str]) -> ToolResult:
        digest = hashlib.sha256(spec.login_url.encode("utf-8", errors="replace")).hexdigest()[:12]
        script_path = ".chainsaw_login_worker.py"
        spec_path = f"auth/verify-spec-{digest}.json"
        output_path = f"auth/verify-output-{digest}.json"
        self.runner.write_file(script_path, LOGIN_WORKER_SCRIPT)
        self.runner.write_file(spec_path, json.dumps(worker_spec_payload(spec, verify_only=True, cookies=cookies), indent=2))
        import sys
        python_bin = "/opt/venv/bin/python3" if self.runner.__class__.__name__ == "DockerSandboxRunner" else sys.executable
        command = (
            f"{python_bin} {shlex.quote(script_path)} --spec {shlex.quote(spec_path)} "
            f"--output {shlex.quote(output_path)} --timeout-ms 20000"
        )
        run = self._bash({"action": "bash", "command": command, "timeout_seconds": 120})
        if not run.ok:
            return ToolResult(False, f"verify_session worker failed: {run.content}", run.meta)
        try:
            outcome = parse_login_output(self.runner.read_file(output_path))
        except (OSError, ValueError) as exc:
            return ToolResult(False, f"verify_session produced no readable output: {type(exc).__name__}: {exc}", run.meta)
        if outcome.success:
            self._session_manager.mark_verified(session.id, f"verify:{spec.verify_url or spec.login_url}")
            return ToolResult(True, f"Session '{session.alias}' verified active (status={outcome.verify_status}).",
                              {"session_id": session.id, "verified": True})
        self._session_manager.update_status(session.id, "expired", failure_reason="verify check failed")
        return ToolResult(False, f"Session '{session.alias}' failed verification (status={outcome.verify_status}). Consider renew_session.",
                          {"session_id": session.id, "verified": False})

    def _record_login_journey(self, spec: LoginSpec, outcome: Any) -> None:
        if self._journey_store is None:
            return
        try:
            journey_id = self._journey_store.create_journey(
                f"login:{spec.session_alias}",
                description="Playwright id+password login flow with session capture.",
                source="perform_login",
                meta={"login_url": spec.login_url, "final_url": outcome.final_url},
            )
            self._journey_store.add_step(journey_id, action="navigate", page_after=spec.login_url)
            self._journey_store.add_step(journey_id, action="submit_credentials", page_before=spec.login_url,
                                         page_after=outcome.final_url)
            if outcome.verify_ok is not None:
                self._journey_store.add_step(journey_id, action="verify_session", page_after=spec.verify_url)
        except Exception:
            pass

    def _search(self, action: dict[str, Any]) -> ToolResult:
        query = str(action.get("query", "")).strip()
        engine = str(action.get("engine", "google")).strip().lower()
        max_results = int(action.get("max_results", 5))
        if not query:
            return ToolResult(False, "Missing query.")
        if engine != "google":
            return ToolResult(False, f"Unsupported search engine: {engine}. Assistant search is Google-only.")
        if max_results <= 0 or max_results > 10:
            return ToolResult(False, "max_results must be between 1 and 10.")
        # Search death spiral limit: max 3 consecutive searches
        self._consecutive_search_count = getattr(self, '_consecutive_search_count', 0) + 1
        if self._consecutive_search_count > 3:
            self._consecutive_search_count = 0
            return ToolResult(
                False,
                "Search blocked after 3 consecutive searches without a non-search action. "
                "Execute a bash command, write_file, or use_skill before searching again.",
                {"search_blocked": True},
            )

        safe_query = _sanitize_search_query(query)
        command = f"curl -fsSL 'https://www.google.com/search?q={safe_query}'"

        self.rate_limiter.wait()
        result = self.runner.exec(command, int(action.get("timeout_seconds", self.runner.settings.command_timeout_seconds)))
        content = _format_search_results(result.stdout or "", max_results)
        if result.exit_code != 0 and result.stderr:
            content += f"\n--- tool error ---\n{_truncate(result.stderr)}"
        return ToolResult(result.exit_code == 0, content)

    def _read_file(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", ""))
        content = self.runner.read_file(path)
        if not self.artifact_store or len(content) <= 3000:
            return ToolResult(True, content)
        record = self.artifact_store.capture_text(
            "workspace_file", content, source="read_file", summary=f"Workspace file {path}",
            meta={"workspace_path": path},
        )
        return ToolResult(
            True,
            f"Read {path}. Large content preserved: {artifact_manifest(record)}\n"
            f"--- preview ---\n{content[:2500]}\nUse artifact retrieval for the remaining content.",
            {"artifact_id": record.artifact_id, "artifact_path": record.path, "artifact_absolute_path": str(self.artifact_store.workspace / record.path)},
        )

    def _browser_map(self, action: dict[str, Any]) -> ToolResult:
        """Run a bounded, same-origin public browser mapping pass."""
        url = str(action.get("url") or action.get("target") or "").strip()
        decision = self.scope_guard.validate_target(url)
        if not decision.allowed:
            return ToolResult(False, f"Scope blocked browser_map: {decision.reason}")
        digest = hashlib.sha256(url.encode("utf-8", errors="replace")).hexdigest()[:12]
        script_path = ".chainsaw_browser_worker.py"
        output_path = f"browser/capture-{digest}.json"
        screenshot_dir = f"browser/screenshots-{digest}"
        self.runner.write_file(script_path, BROWSER_WORKER_SCRIPT)
        import sys
        if self.runner.__class__.__name__ == "DockerSandboxRunner":
            python_bin = "/opt/venv/bin/python3"
        else:
            python_bin = sys.executable
        command = (
            f"{python_bin} {shlex.quote(script_path)} --url {shlex.quote(url)} --output {shlex.quote(output_path)} "
            f"--max-pages {max(1, min(int(action.get('max_pages', 5)), 20))} "
            f"--max-depth {max(0, min(int(action.get('max_depth', 1)), 3))} "
            f"--timeout-ms {max(3_000, min(int(action.get('timeout_ms', 20_000)), 60_000))} "
            f"--screenshot-dir {shlex.quote(screenshot_dir)}"
        )
        result = self._bash({"action": "bash", "command": command, "timeout_seconds": action.get("timeout_seconds", 120)})
        if not result.ok:
            return result
        try:
            capture_text = self.runner.read_file(output_path)
            capture = json.loads(capture_text)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            return ToolResult(False, f"browser_map produced no readable capture: {type(exc).__name__}: {exc}", result.meta)
        artifact_meta = dict(result.meta)
        if self.artifact_store:
            record = self.artifact_store.capture_text(
                "browser_capture", capture_text, source="browser_map", summary=_browser_capture_summary(capture),
                meta={"url": url, "workspace_capture": output_path, "screenshots": capture.get("screenshots", [])}, suffix=".json",
            )
            artifact_meta.update({"artifact_id": record.artifact_id, "artifact_path": record.path, "artifact_absolute_path": str(self.artifact_store.workspace / record.path)})
        self._record_browser_surfaces(capture, source="browser_map")
        forms = capture.get("forms", [])[:12]
        form_lines = [
            f"- {item.get('method', 'GET')} {item.get('action', '')} inputs="
            + ", ".join(str(control.get("name") or control.get("type")) for control in item.get("inputs", [])[:15])
            for item in forms
        ]
        content = (
            f"Browser map complete: {_browser_capture_summary(capture)}\n"
            f"capture_path={output_path}\n"
            + ("Forms:\n" + "\n".join(form_lines) if form_lines else "Forms: none observed.")
            + (f"\nFull browser capture preserved as artifact_id={artifact_meta.get('artifact_id')}." if artifact_meta.get("artifact_id") else "")
        )
        return ToolResult(True, content, artifact_meta)

    def _record_browser_surfaces(self, capture: dict[str, Any], *, source: str) -> None:
        journey_id = ""
        if self._journey_store:
            journey_id = self._journey_store.create_journey(
                str(capture.get("title") or capture.get("url") or "browser journey"),
                description="Browser worker capture with page and network lineage.",
                source=source,
                meta={"start_url": capture.get("url", ""), "page_count": len(capture.get("pages", []))},
            )
        for page in capture.get("pages", []):
            url = str(page.get("final_url") or page.get("url") or "")
            parsed = urlparse(url)
            if not parsed.hostname:
                continue
            page_id = ""
            if self._journey_store:
                page_id = self._journey_store.upsert_page(BrowserPage(
                    id=f"PAGE-{hashlib.sha1(url.encode()).hexdigest()[:12]}",
                    url=url, title=str(page.get("title") or ""), status=page.get("status"),
                    input_count=len(page.get("inputs", []) or []),
                    meta={"source": source},
                ))
                step_id = self._journey_store.add_step(
                    journey_id, action="navigate", page_after=page_id,
                    element_description=str(page.get("title") or url),
                    meta={"url": url, "status": page.get("status")},
                )
            self.recon_store.upsert_surface(SurfaceRecord(
                url, parsed.hostname.lower(), parsed.path or "/", "web", source,
                tags=("browser",), meta={"title": page.get("title", ""), "status": page.get("status")},
            ))
        for form in capture.get("forms", []):
            action_url = str(form.get("action") or form.get("page_url") or "")
            parsed = urlparse(action_url)
            if not parsed.hostname:
                continue
            controls = form.get("inputs", [])
            self.recon_store.upsert_surface(SurfaceRecord(
                action_url, parsed.hostname.lower(), parsed.path or "/", "web", source,
                tags=("browser", "form", "parameter"), meta={"method": form.get("method", "GET"), "inputs": controls[:40]},
            ))
        for request in capture.get("network", []):
            url = str(request.get("url") or "")
            parsed = urlparse(url)
            if not parsed.hostname:
                continue
            request_id = ""
            if self._journey_store:
                request_id = self._journey_store.add_captured_request(
                    method=str(request.get("method") or "GET").upper(), url=url,
                    headers=request.get("request_headers") or request.get("headers") or {},
                    body=str(request.get("request_body") or request.get("body") or ""),
                    source=source, meta={"resource_type": request.get("resource_type", "")},
                )
                if journey_id:
                    step_id = self._journey_store.add_step(
                        journey_id, action="network-request", page_after=url,
                        meta={"request_id": request_id, "method": request.get("method", "GET")},
                    )
                    self._journey_store.link_request_to_step(journey_id, step_id, request_id, relation="caused")
            path = parsed.path or "/"
            kind = "graphql" if "graphql" in path.lower() else "api" if "/api/" in path.lower() else "web"
            self.recon_store.upsert_surface(SurfaceRecord(
                url, parsed.hostname.lower(), path, kind, source, tags=("browser", "network"),
                meta={"method": request.get("method", "GET"), "resource_type": request.get("resource_type", "")},
            ))

    def _journey_action(self, action: dict[str, Any]) -> ToolResult:
        """Return bounded journey indexes or one stored request on demand."""
        if not self._journey_store:
            return ToolResult(False, "Journey storage is unavailable.", {"journey_store_disabled": True})
        name = str(action.get("action", ""))
        limit = max(1, min(int(action.get("limit", 20)), 100))
        if name == "list_journeys":
            journeys = self._journey_store.list_journeys(limit=limit)
            return ToolResult(True, "\n".join(f"- {j.id}: {j.name} ({j.source})" for j in journeys) or "No journeys stored.", {"count": len(journeys)})
        journey_id = str(action.get("journey_id") or "")
        if name == "get_journey_steps":
            if not journey_id:
                return ToolResult(False, "get_journey_steps requires journey_id.")
            steps = self._journey_store.steps_for_journey(journey_id)
            return ToolResult(True, "\n".join(f"{s.order}. {s.action} before={s.page_before} after={s.page_after}" for s in steps) or "No steps stored.", {"journey_id": journey_id, "count": len(steps)})
        if name == "search_journey_requests":
            query = str(action.get("query") or "")
            requests = self._journey_store.search_captured_requests(query, limit=limit)
            return ToolResult(True, "\n".join(f"- {r.id}: {r.method} {r.url} session={r.session_id or '-'}" for r in requests) or "No matching journey requests.", {"count": len(requests)})
        request_id = str(action.get("request_id") or "")
        if not request_id:
            return ToolResult(False, "get_journey_request requires request_id.")
        request = self._journey_store.get_captured_request(request_id)
        if not request:
            return ToolResult(False, f"Journey request not found: {request_id}")
        return ToolResult(True, json.dumps({"id": request.id, "method": request.method, "url": request.url, "headers": request.headers, "body": request.body}, ensure_ascii=False), {"request_id": request_id})

    def _world_model_action(self, action: dict[str, Any]) -> ToolResult:
        if self._world_model is None:
            return ToolResult(False, "World model is unavailable.", {"world_model_disabled": True})
        summary = self._world_model.architecture_summary()
        if action.get("action") == "world_model_summary":
            bounded = {key: value for key, value in summary.items() if key != "relationships"}
            bounded["relationship_count"] = len(summary.get("relationships", []))
            bounded["attack_boundaries"] = self._world_model.attack_surface_summary(limit=10)
            return ToolResult(True, json.dumps(bounded, ensure_ascii=False), {"query": "summary"})
        query = str(action.get("query") or "").lower()
        limit = max(1, min(int(action.get("limit", 30)), 100))
        matches: list[str] = []
        for category in ("services", "technologies", "routes", "source_assets", "browser_captures", "sessions"):
            for item in summary.get(category, []):
                text = json.dumps(item, ensure_ascii=False)
                if not query or query in text.lower():
                    matches.append(f"[{category}] {text}")
                    if len(matches) >= limit:
                        break
            if len(matches) >= limit:
                break
        return ToolResult(True, "\n".join(matches) or "No matching world-model records.", {"query": query, "count": len(matches)})

    def _list_artifacts(self, action: dict[str, Any]) -> ToolResult:
        if not self.artifact_store:
            return ToolResult(False, "Artifact evidence store is unavailable for this runner.")
        records = self.artifact_store.list_artifacts(
            kind=str(action.get("kind", "")).strip(), limit=int(action.get("limit", 20)),
        )
        return ToolResult(
            True,
            "\n".join(artifact_manifest(record) for record in records) if records else "No matching artifacts.",
        )

    def _search_artifact(self, action: dict[str, Any]) -> ToolResult:
        if not self.artifact_store:
            return ToolResult(False, "Artifact evidence store is unavailable for this runner.")
        try:
            record, matches = self.artifact_store.search(
                str(action.get("artifact_id", "")).strip(), str(action.get("query", "")).strip(),
                max_matches=int(action.get("max_matches", 20)), context_lines=int(action.get("context_lines", 1)),
                regex=bool(action.get("regex", False)),
            )
        except (ValueError, FileNotFoundError, OSError, re.error) as exc:
            return ToolResult(False, f"Artifact search failed: {type(exc).__name__}: {exc}")
        if not matches:
            return ToolResult(True, f"No matches in {artifact_manifest(record)}", {"artifact_id": record.artifact_id})
        lines = [artifact_manifest(record), f"matches={len(matches)}"]
        for match in matches:
            lines.append(f"--- lines {match['start_line']}-{match['end_line']} (match {match['line']}) ---\n{match['preview']}")
        return ToolResult(True, "\n".join(lines), {"artifact_id": record.artifact_id, "matches": matches})

    def _read_artifact_context(self, action: dict[str, Any]) -> ToolResult:
        if not self.artifact_store:
            return ToolResult(False, "Artifact evidence store is unavailable for this runner.")
        try:
            record, slices = self.artifact_store.read_context(
                str(action.get("artifact_id", "")).strip(),
                query=str(action.get("query", "")).strip(),
                max_matches=int(action.get("max_matches", 8)),
                context_lines=int(action.get("context_lines", 3)),
                regex=bool(action.get("regex", False)),
            )
        except (ValueError, FileNotFoundError, OSError, re.error) as exc:
            return ToolResult(False, f"Artifact context read failed: {type(exc).__name__}: {exc}")
        if not slices:
            return ToolResult(True, f"No contextual matches in {artifact_manifest(record)}", {"artifact_id": record.artifact_id})
        lines = [artifact_manifest(record), f"context_matches={len(slices)}"]
        for slice_obj in slices:
            lines.append(f"--- lines {slice_obj['start_line']}-{slice_obj['end_line']} ---\n{slice_obj['preview']}")
        return ToolResult(True, "\n".join(lines), {"artifact_id": record.artifact_id, "context_matches": slices})

    def _summarize_artifact(self, action: dict[str, Any]) -> ToolResult:
        if not self.artifact_store:
            return ToolResult(False, "Artifact evidence store is unavailable for this runner.")
        try:
            summary = self.artifact_store.summarize(
                str(action.get("artifact_id", "")).strip(),
                max_chars=int(action.get("max_chars", 4000)),
            )
        except (ValueError, FileNotFoundError, OSError) as exc:
            return ToolResult(False, f"Artifact summary failed: {type(exc).__name__}: {exc}")
        return ToolResult(True, summary, {"artifact_id": summary.get("artifact_id")})

    def _read_artifact_slice(self, action: dict[str, Any]) -> ToolResult:
        if not self.artifact_store:
            return ToolResult(False, "Artifact evidence store is unavailable for this runner.")
        try:
            end_value = action.get("end_line")
            record, content, start, end = self.artifact_store.read_lines(
                str(action.get("artifact_id", "")).strip(), int(action.get("start_line", 1)),
                int(end_value) if end_value is not None else None,
            )
        except (ValueError, FileNotFoundError, OSError) as exc:
            return ToolResult(False, f"Artifact read failed: {type(exc).__name__}: {exc}")
        return ToolResult(
            True, f"{artifact_manifest(record)}\n--- lines {start}-{end} ---\n{content}",
            {"artifact_id": record.artifact_id},
        )

    def _write_file(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", "")).strip()
        if not path:
            return ToolResult(False, "Missing file path. Include 'path' key with the file path.")
        blocked = self._check_write_blocklist(path)
        if blocked:
            return blocked
        repeat_result = self._check_repeated_write(path)
        if repeat_result:
            return blocked or repeat_result
        # Accept 'content' as the primary field; also accept 'data' for flexibility
        content = action.get("content") or action.get("data")
        if content is None:
            guidance = _artifact_contract_guidance(path or "output.txt")
            return ToolResult(
                False,
                "write_file requires a 'content' field with the file body. "
                "(The 'data' field is also accepted.) "
                "Include the full file text as a string in the JSON action itself.\n"
                f"Repair guidance:\n{guidance}",
                {"write_rejected": True, "path": path, "reason": "missing_content_field"},
            )
        content = str(content)
        empty_reason = _reject_empty_workspace_write(path, content)
        if empty_reason:
            guidance = _artifact_contract_guidance(path)
            return ToolResult(
                False,
                f"{empty_reason}\nRepair guidance for {path}:\n{guidance}",
                {"write_rejected": True, "path": path, "guidance": guidance},
            )
        self.runner.write_file(path, content)
        return ToolResult(True, f"Wrote {len(content)} bytes to {path}.")

    def _create_objective(self, action: dict[str, Any]) -> ToolResult:
        if not self.state_store:
            return ToolResult(False, "Structured engagement state is unavailable.")
        title = str(action.get("title", "")).strip()
        target = str(action.get("target") or self.active_target or "").strip()
        if not title or not target:
            return ToolResult(False, "create_objective requires title and target.")
        objective_id = self.state_store.ensure_objective(
            title, target, source="model", priority=int(action.get("priority", 50)),
            description=str(action.get("description", "")).strip(), meta={"action": action},
        )
        self.active_objective_id = objective_id
        return ToolResult(True, f"Created security objective {objective_id}: {title}", {"objective_id": objective_id})

    def _create_hypothesis(self, action: dict[str, Any]) -> ToolResult:
        if not self.state_store:
            return ToolResult(False, "Structured engagement state is unavailable.")
        title = str(action.get("title", "")).strip()
        question = str(action.get("security_question") or action.get("question") or "").strip()
        surface = str(action.get("surface") or action.get("target") or self.active_target or "").strip()
        if not title or not question or not surface:
            return ToolResult(False, "create_hypothesis requires title, security_question, and surface.")
        required = action.get("required_evidence", [])
        if not isinstance(required, list):
            return ToolResult(False, "required_evidence must be a JSON list.")
        hypothesis_id = self.state_store.create_hypothesis(
            title, question, surface, objective_id=str(action.get("objective_id") or self.active_objective_id or "") or None,
            state=str(action.get("state", "suspected")), confidence=str(action.get("confidence", "candidate")),
            required_evidence=[str(item) for item in required], source="model", meta={"action": action},
        )
        self.active_hypothesis_id = hypothesis_id
        return ToolResult(True, f"Created hypothesis {hypothesis_id}: {title}", {"hypothesis_id": hypothesis_id})

    def _record_evidence(self, action: dict[str, Any]) -> ToolResult:
        if not self.state_store:
            return ToolResult(False, "Structured engagement state is unavailable.")
        kind = str(action.get("kind", "")).strip()
        summary = str(action.get("summary", "")).strip()
        location = str(action.get("location", "")).strip()
        content = str(action.get("content", ""))
        if not kind or not summary:
            return ToolResult(False, "record_evidence requires kind and summary.")
        if not location:
            location = f"inline:{kind}"
        evidence_id = self.state_store.record_evidence(
            kind, location, summary, content=content,
            objective_id=str(action.get("objective_id") or self.active_objective_id or "") or None,
            hypothesis_id=str(action.get("hypothesis_id") or self.active_hypothesis_id or "") or None,
            source="model", meta={"action": action},
        )
        return ToolResult(True, f"Recorded evidence {evidence_id}: {summary}", {"evidence_id": evidence_id})

    def _save_artifact(self, action: dict[str, Any]) -> ToolResult:
        kind = _safe_artifact_component(str(action.get("artifact_type") or action.get("kind") or ""))
        data = action.get("data")
        if not kind or not isinstance(data, dict):
            return ToolResult(False, "save_artifact requires artifact_type and an object data field.")
        name = _safe_artifact_component(str(action.get("name") or data.get("name") or kind))
        path = f"artifacts/{kind}/{name}.json"
        content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        self.runner.write_file(path, content)
        artifact_id = ""
        if self.state_store:
            artifact_id = self.state_store.save_artifact(kind, Path(path), str(data.get("summary") or kind), source="model", meta=data)
            self.state_store.record_evidence(
                "artifact", path, str(data.get("summary") or f"Saved {kind} artifact"), content=content,
                objective_id=str(action.get("objective_id") or self.active_objective_id or "") or None,
                hypothesis_id=str(action.get("hypothesis_id") or self.active_hypothesis_id or "") or None,
                source="model", meta={"artifact_id": artifact_id},
            )
        return ToolResult(True, f"Saved typed {kind} artifact to {path}.", {"path": path, "artifact_id": artifact_id})

    def _create_verifier(self, action: dict[str, Any]) -> ToolResult:
        target = str(action.get("target") or self.active_target or "").strip()
        purpose = _safe_artifact_component(str(action.get("purpose") or "verification"))
        if not target:
            return ToolResult(False, "create_verifier requires a target.")
        method = str(action.get("method") or "GET").upper()
        path = str(action.get("path") or f"verify_{purpose}.py")
        code = _render_verifier(target, method, action.get("headers"), action.get("body"))
        self.runner.write_file(path, code)
        if self.state_store:
            self.state_store.save_artifact("verifier", Path(path), f"{purpose} verifier for {target}", source="model")
            self.state_store.record_evidence(
                "verifier", path, f"Generated {purpose} verifier", content=code,
                objective_id=str(action.get("objective_id") or self.active_objective_id or "") or None,
                hypothesis_id=str(action.get("hypothesis_id") or self.active_hypothesis_id or "") or None,
                source="model",
            )
        return ToolResult(True, f"Created verifier {path} for {method} {target}.", {"path": path})

    def _check_write_blocklist(self, path: str) -> ToolResult | None:
        if path not in self.write_blocked_paths:
            return None
        return ToolResult(
            False,
            f"write_file for {path} is unavailable because prior attempts were repeatedly blocked.\n"
            "Use bash with cat/tee, or write a different artifact path.",
            {"write_blocked": True, "path": path, "blocked": True},
        )

    def _check_repeated_write(self, path: str) -> ToolResult | None:
        count = self.command_counts.get(f"_write_{path}", 0) + 1
        self.command_counts[f"_write_{path}"] = count
        if count <= 2:
            return None
        self.write_blocked_paths.add(path)
        return ToolResult(
            False,
            f"write_file for {path} blocked after {count} attempts.\n"
            "The previous attempts were rejected because content was missing or invalid.\n"
            "STOP and switch strategy: use bash with cat/tee to write the file, or write a different artifact.",
            {"write_blocked": True, "path": path, "attempts": count},
        )

    def _list_files(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", "."))
        return ToolResult(True, "\n".join(self.runner.list_files(path)))

    def _use_skill(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("name", ""))
        if name == "public_research" and not self.allow_search:
            return ToolResult(
                False,
                "public_research is assistant-only. Use fingerprinting, surface discovery, or validation from observed target evidence.",
                {"skill_disabled": True},
            )
        blocked = self._check_skill_blocklist(name, action)
        if blocked:
            return blocked
        repeat_result = self._check_repeated_skill(action)
        if repeat_result:
            return repeat_result
        skill = get_skill(name)
        if not skill:
            return ToolResult(False, f"Unknown skill: {name}")
        objective = str(action.get("objective", "")).strip()
        context = str(action.get("context", "")).strip()
        prefix = []
        if objective:
            prefix.append(f"Objective: {objective}")
        if context:
            prefix.append(f"Current context: {context}")
        guidance = "\n\n".join(prefix + [skill.full()])
        return ToolResult(True, guidance, {"skill": skill.name})

    def _research(self, action: dict[str, Any]) -> ToolResult:
        """Milestone 3.4: deterministic research probes (OSV / Tavily)."""
        ok, content, meta = research_probe(action)
        return ToolResult(ok, content, meta)

    def _record_finding(self, action: dict[str, Any]) -> ToolResult:
        if self.state_store and not (action.get("hypothesis_id") or self.active_hypothesis_id):
            return ToolResult(
                False,
                "Finding rejected: link it to a recorded hypothesis and its supporting evidence first.",
                {"finding_rejected": True, "hypothesis_required": True},
            )
        finding = Finding(
            title=str(action.get("title", "Untitled finding")),
            severity=str(action.get("severity", "unknown")),
            asset=str(action.get("asset", "")),
            evidence=str(action.get("evidence", "")),
            impact=str(action.get("impact", "")),
            next_steps=str(action.get("next_steps", "")),
            request=str(action.get("request", "")),
            response=str(action.get("response", "")),
        )
        scope = self.scope_guard.validate_target(finding.asset)
        if finding.asset and not scope.allowed:
            return ToolResult(False, f"Finding asset is out of scope: {scope.reason}")
        rung, rung_reason = _classify_finding_rung(finding)
        if rung != "validated":
            return ToolResult(
                False,
                (
                    f"Finding rejected at ladder rung `{rung}`: {rung_reason}. "
                    "Save it as evidence, notes, or a potential weakness until stronger proof exists."
                ),
                {"finding_rejected": True, "finding_rung": rung},
            )
        evidence_issue = _validate_finding_evidence(finding)
        if evidence_issue:
            return ToolResult(False, evidence_issue, {"finding_rejected": True})

        fingerprint = _finding_fingerprint(finding)
        if fingerprint in self.finding_fingerprints:
            return ToolResult(
                True,
                "Duplicate finding suppressed. Do not record it again; either add new evidence, write a verification script, or finish.",
                {"duplicate": True},
            )

        # Milestone 4.2: cross-model adjudication before recording
        if self._adjudicator is not None:
            try:
                adjudication = self._adjudicator.adjudicate(finding)
                if adjudication.get("verdict") != "validated":
                    reasons = "; ".join(adjudication.get("reasons", []))
                    return ToolResult(
                        False,
                        f"Finding rejected by cross-model adjudicator ({adjudication.get('model', 'unknown')}): {reasons}. "
                        "Save it as evidence or notes until a second model validates it.",
                        {"finding_rejected": True, "adjudicator": True, "reasons": adjudication.get("reasons", [])},
                    )
            except Exception as exc:
                self.trace.write("adjudicator_error", error=f"{type(exc).__name__}: {exc}")

        self.finding_fingerprints.add(fingerprint)
        self.findings.append(finding)
        return ToolResult(True, f"Recorded finding: {finding.title}")

    def _check_skill_blocklist(self, name: str, action: dict[str, Any]) -> ToolResult | None:
        if not name:
            return None
        normalized = name.strip().lower()
        if normalized not in self.skill_blocked:
            return None
        return ToolResult(
            False,
            f"Skill '{name}' is currently unavailable because a prior request was blocked. Switch to a different skill, write a Python verification script, or finish.",
            {"skill_blocked": True, "skill": normalized},
        )

    def _check_repeated_skill(self, action: dict[str, Any]) -> ToolResult | None:
        name = str(action.get("name", "")).strip().lower()
        objective = str(action.get("objective", "")).strip().lower()
        context = str(action.get("context", "")).strip().lower()
        fingerprint = "|".join([name, objective, context])
        count = self.skill_counts.get(fingerprint, 0) + 1
        self.skill_counts[fingerprint] = count
        if count <= 2:
            return None
        self.skill_blocked.add(name)
        return ToolResult(
            False,
            (
                f"Repeated skill request blocked after 2 runs for {name}.\n"
                "Use the existing playbook output, move to a new phase, or execute a concrete probe instead of asking for the same skill again."
            ),
            {"repeat_blocked": True, "repeat_count": count, "skill": name},
        )

    def _check_repeated_command(self, command: str) -> ToolResult | None:
        # Exempt GraphQL introspection queries (they are all different, not repeats)
        if _is_graphql_introspection(command):
            return None
        # Exempt baseline recon checks that run on every target (robots.txt, sitemap.xml, tool presence)
        if _is_baseline_recon_command(command):
            return None

        fingerprint = _command_fingerprint(command)
        count = self.command_counts.get(fingerprint, 0) + 1
        self.command_counts[fingerprint] = count
        if count <= self.max_repeated_commands:
            return None
        return ToolResult(
            False,
            (
                f"Repeated command blocked after {self.max_repeated_commands} runs.\n"
                "Do not run the same probe again. Change strategy now: write a comprehensive Python verification script "
                "(50-200 payload/query variations) and run it once, "
                "enumerate a new endpoint class, "
                "or record a final finding with unique evidence."
            ),
            {"repeat_blocked": True, "repeat_count": count, "fingerprint": fingerprint},
        )

    def _record_scorecard_event(self, action: dict[str, Any], result: ToolResult) -> None:
        if not self.scorecard:
            return
        name = str(action.get("action", ""))
        if name == "record_finding":
            if result.meta.get("finding_rejected"):
                detail = str(result.content)[:2000]
                self.scorecard.record(SimpleNamespace(
                    phase="m4_adjud",
                    name="finding_rejected",
                    passed=True,
                    detail=detail,
                    metric="finding_rejected",
                    value=None,
                ))
            elif result.ok:
                self.scorecard.record_finding({
                    "title": str(action.get("title", "Untitled finding")),
                    "evidence": str(action.get("evidence", "")),
                })
                self.scorecard.record(SimpleNamespace(
                    phase="m4_adjud",
                    name="finding_recorded",
                    passed=True,
                    detail=str(action.get("title", ""))[:2000],
                    metric="finding_recorded",
                    value=1.0,
                ))
        elif name == "bash" and result.meta.get("rate_limit_hit"):
            self.scorecard.record(SimpleNamespace(
                phase="m4_rate",
                name="rate_limit_hit",
                passed=False,
                detail=str(action.get("command", ""))[:2000],
                metric="rate_limit_hit",
                value=1.0,
            ))

    def _record_surface_outcome(self, attack: AttackResult) -> None:
        try:
            if hasattr(self, "_endpoint_tracker") and self._endpoint_tracker:
                from .endpoint_tracker import SurfaceOutcome
                self._endpoint_tracker.record(SurfaceOutcome(
                    surface_key=attack.surface_key,
                    host=attack.surface_key.split("/")[0] if "/" in attack.surface_key else attack.surface_key,
                    path="/" + "/".join(attack.surface_key.split("/")[1:]) if "/" in attack.surface_key else "/",
                    outcome=attack.outcome,
                    auth_context=attack.auth_context,
                ))
            if hasattr(self, "_auth_gate_classifier") and self._auth_gate_classifier and attack.auth_context == "public":
                combined = " ".join([attack.evidence, attack.surface_key]).lower()
                new_auth = self._auth_gate_classifier.classify(combined, "", attack.auth_context)
                if new_auth == "auth_gate":
                    attack.auth_context = "auth_gate"
        except Exception:
            pass

    def _add_discovered_hosts(self, stdout: str, stderr: str) -> None:
        try:
            discovered = list(self.scope_guard._extract_hosts(stdout + "\n" + stderr))
        except Exception:
            discovered = []
        if not discovered or not getattr(self.scope_guard, "dynamic_allow_file", None):
            return
        dyn = self.scope_guard.dynamic_allow_file
        try:
            existing = set()
            if dyn.exists():
                existing = {
                    line.strip().lower()
                    for line in dyn.read_text(encoding="utf-8").splitlines()
                    if line.strip() and not line.strip().startswith("#")
                }
            to_add = []
            for host in discovered:
                lowered = host.lower()
                if lowered in existing:
                    continue
                if self.scope_guard._matches_any(lowered, self.scope_guard.scope.excluded_domains):
                    continue
                if not self.scope_guard._is_allowed_host(lowered):
                    continue
                to_add.append(host)
            if to_add:
                dyn.parent.mkdir(parents=True, exist_ok=True)
                with dyn.open("a", encoding="utf-8") as handle:
                    for host in to_add:
                        handle.write(host + "\n")
        except Exception:
            return


    def _burp_mcp_action(self, action: dict[str, Any]) -> ToolResult:
        """Dispatch high-level Burp MCP actions.

        These actions are scope-checked and rate-limited before the MCP
        invocation, and their results are compact so the model does not
        receive raw traffic or secrets in the prompt.
        """
        name = str(action.get("action", "")).strip()
        if self._burp_mcp_client is None:
            return ToolResult(
                False,
                "Burp MCP is not configured. Use --burp-mcp-url (and --burp-mcp-transport/--burp-mcp-token) "
                "to enable captured-request operations, or use the deprecated --burp-api-url/--burp-api-key.",
                {"burp_mcp_disabled": True, "action": name},
            )
        target = str(action.get("target") or action.get("url") or self.active_target or "").strip()
        if target:
            decision = self.scope_guard.validate_target(target)
            if not decision.allowed:
                return ToolResult(False, f"Scope blocked {name}: {decision.reason}")
        request_id = str(action.get("request_id") or action.get("template_id") or "").strip()

        try:
            if name == "search_captured_requests":
                result = self._burp_mcp_client.search_history(
                    str(action.get("query", "")), target=target, limit=max(1, min(int(action.get("limit", 20)), 100)),
                )
            elif name == "get_captured_request":
                if not request_id:
                    return ToolResult(False, "get_captured_request requires request_id.")
                result = self._burp_mcp_client.get_request(request_id)
            elif name == "get_captured_response":
                if not request_id:
                    return ToolResult(False, "get_captured_response requires request_id.")
                result = self._burp_mcp_client.get_response(request_id)
            elif name == "replay_captured_request":
                if not request_id:
                    return ToolResult(False, "replay_captured_request requires request_id.")
                try:
                    patch = parse_patch(action.get("patch"))
                except ValueError as exc:
                    return ToolResult(False, str(exc))
                result = self._burp_mcp_client.replay_request(request_id, patch, target)
                if result.ok:
                    result.meta.update({
                        "template_id": request_id,
                        "patch": patch,
                        "session_alias": str(action.get("session_alias") or "").strip() or getattr(self._burp_mcp_client.config, "session_alias", ""),
                    })
            elif name == "compare_captured_responses":
                baseline_id = str(action.get("baseline_id") or "").strip()
                candidate_id = str(action.get("candidate_id") or "").strip()
                if not baseline_id or not candidate_id:
                    return ToolResult(False, "compare_captured_responses requires baseline_id and candidate_id.")
                result = self._burp_mcp_client.compare_responses(baseline_id, candidate_id)
            elif name == "create_repeater_experiment":
                if not request_id:
                    return ToolResult(False, "create_repeater_experiment requires request_id.")
                result = self._burp_mcp_client.create_repeater_experiment(request_id, target)
            else:
                return ToolResult(False, f"Unsupported Burp MCP action: {name}")
        except Exception as exc:
            return ToolResult(False, f"{type(exc).__name__}: {exc}", {"burp_mcp_error": True})

        if not result.ok:
            return ToolResult(False, result.content, {"burp_mcp": True, **result.meta})

        # Compact result: strip raw request/response bodies unless explicitly asked.
        content = result.content
        if name not in {"get_captured_request", "get_captured_response"}:
            try:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    content = "\n".join(
                        f"- {item.get('method', '?')} {item.get('url', '')} status={item.get('status_code', '')}"
                        for item in parsed[: min(len(parsed), 30)]
                    ) or "No matching entries."
                elif isinstance(parsed, dict):
                    if "history" in parsed:
                        content = "\n".join(
                            f"- {item.get('method', '?')} {item.get('url', '')} status={item.get('status_code', '')}"
                            for item in parsed.get("history", [])[:30]
                        ) or "No matching entries."
            except (json.JSONDecodeError, TypeError):
                pass
        meta = {"burp_mcp": True, "action": name, **result.meta}
        if self.artifact_store and result.content:
            record = self.artifact_store.capture_text(
                "burp_mcp",
                result.content,
                source=f"burp_mcp:{name}",
                summary=f"Burp MCP {name} result",
                meta={
                    "target": target,
                    "request_id": request_id,
                    "session_alias": str(action.get("session_alias") or "").strip(),
                    "burp_result_meta": result.meta,
                },
            )
            meta["artifact_id"] = record.artifact_id
            meta["artifact_path"] = record.path
            meta["artifact_absolute_path"] = str(self.artifact_store.workspace / record.path)
        return ToolResult(True, content, meta)

    def _burp_send(self, action: dict[str, Any]) -> ToolResult:
        """Send a raw HTTP request through Burp REST API (Repeater-style)."""
        if not getattr(self.runner.settings, "burp_api_url", "") or not getattr(self.runner.settings, "burp_api_key", ""):
            return ToolResult(False, "Burp REST API is not configured. Use --burp-api-url and --burp-api-key.", {"burp_disabled": True})
        target = str(action.get("target") or self.active_target or "").strip()
        if not target:
            return ToolResult(False, "burp_send requires a target URL.")
        scope = self.scope_guard.validate_target(target)
        if not scope.allowed:
            return ToolResult(False, f"Scope blocked burp_send: {scope.reason}")
        method = str(action.get("method", "GET")).upper()
        headers = action.get("headers") or {}
        body = action.get("body")
        if not isinstance(headers, dict):
            headers = {}
        burp_url = self._build_burp_api_url("/send", target)
        payload: dict[str, Any] = {"url": target, "method": method, "headers": headers}
        if body is not None:
            payload["body"] = body
        command = (
            f"curl -sS -X POST {shlex.quote(burp_url)} "
            f"-H 'Authorization: Bearer {shlex.quote(getattr(self.runner.settings, 'burp_api_key', ''))}' "
            f"-H 'Content-Type: application/json' "
            f"--data {shlex.quote(json.dumps(payload, ensure_ascii=False))}"
        )
        result = self._bash({"action": "bash", "command": command, "timeout_seconds": int(action.get("timeout_seconds", self.runner.settings.command_timeout_seconds))})
        if result.ok:
            try:
                data = json.loads(result.stdout or "{}")
                return ToolResult(True, json.dumps(data, ensure_ascii=False, indent=2)[:4000], {"burp_action": "send", "target": target})
            except (json.JSONDecodeError, ValueError):
                return ToolResult(True, result.stdout[:4000], {"burp_action": "send", "target": target})
        return ToolResult(False, result.content, {"burp_action": "send", "target": target})

    def _burp_history(self, action: dict[str, Any]) -> ToolResult:
        """Query Burp proxy history for recent requests/responses."""
        if not getattr(self.runner.settings, "burp_api_url", "") or not getattr(self.runner.settings, "burp_api_key", ""):
            return ToolResult(False, "Burp REST API is not configured. Use --burp-api-url and --burp-api-key.", {"burp_disabled": True})
        target = str(action.get("target") or self.active_target or "").strip()
        if target:
            scope = self.scope_guard.validate_target(target)
            if not scope.allowed:
                return ToolResult(False, f"Scope blocked burp_history: {scope.reason}")
        limit = max(1, min(int(action.get("limit", 20)), 100))
        params = f"?limit={limit}"
        if target:
            params += f"&url={shlex.quote(target)}"
        burp_url = self._build_burp_api_url(f"/history{params}", target or "")
        command = (
            f"curl -sS {shlex.quote(burp_url)} "
            f"-H 'Authorization: Bearer {shlex.quote(getattr(self.runner.settings, 'burp_api_key', ''))}'"
        )
        result = self._bash({"action": "bash", "command": command, "timeout_seconds": int(action.get("timeout_seconds", self.runner.settings.command_timeout_seconds))})
        if result.ok:
            try:
                data = json.loads(result.stdout or "[]")
                if isinstance(data, list):
                    lines = [f"Burp history: {len(data)} entries"]
                    for entry in data[: min(len(data), limit)]:
                        url = entry.get("url", "")
                        method = entry.get("method", "")
                        status = entry.get("status_code", "")
                        lines.append(f"- {method} {status} {url}")
                    return ToolResult(True, "\n".join(lines), {"burp_action": "history", "target": target, "count": len(data)})
                return ToolResult(True, json.dumps(data, ensure_ascii=False, indent=2)[:4000], {"burp_action": "history", "target": target})
            except (json.JSONDecodeError, ValueError):
                return ToolResult(True, result.stdout[:4000], {"burp_action": "history", "target": target})
        return ToolResult(False, result.content, {"burp_action": "history", "target": target})

    def _build_burp_api_url(self, path: str, target: str) -> str:
        base = getattr(self.runner.settings, "burp_api_url", "").rstrip("/")
        return f"{base}{path}"


class CommandRateLimiter:
    def __init__(self, delay_seconds: float, max_commands_per_minute: int, trace: TraceLogger) -> None:
        self.delay_seconds = max(0.0, delay_seconds)
        self.min_interval = 60.0 / max_commands_per_minute if max_commands_per_minute > 0 else 0.0
        self.trace = trace
        self._last_command_at = 0.0
        # Milestone 4.1: dynamic rate-limit maintenance
        self._dynamic: DynamicRateLimiter | None = None

    def attach_dynamic(self, dynamic: DynamicRateLimiter) -> None:
        """Attach a dynamic rate limiter that maintains below the real limit."""
        self._dynamic = dynamic

    def wait(self) -> None:
        # Use the dynamic effective limit if attached (M4.1)
        if self._dynamic is not None:
            dynamic_interval = self._dynamic.min_interval_seconds()
            required_delay = max(self.delay_seconds, dynamic_interval)
        else:
            required_delay = max(self.delay_seconds, self.min_interval)
        if required_delay <= 0:
            return
        now = time.monotonic()
        elapsed = now - self._last_command_at
        sleep_for = max(0.0, required_delay - elapsed)
        if sleep_for > 0:
            self.trace.write("rate_limit_sleep", seconds=round(sleep_for, 3))
            time.sleep(sleep_for)
        self._last_command_at = time.monotonic()


_TOOL_ACTIONS = {
    "httpx",
    "subfinder",
    "nuclei",
    "waybackurls",
    "gobuster",
    "dirsearch",
    "nikto",
    "sqlmap",
    "xsstrike",
    "wafw00f",
    "katana",
    "whatweb",
    "amass",
    "gau",
    "assetfinder",
    "dnsx",
    "naabu",
    "inql",
    "clairvoyance",
    "grapeql",
    "feroxbuster",
    "dalfox",
    "crtsh",
    "git",
    "pip",
    "pip3",
    "npm",
    "wget",
    "curl",
    "dig",
    "nslookup",
    "openssl",
    "nmap",
}


_HYPOTHESIS_REQUIRED_TOOLS = {
    "sqlmap", "xsstrike", "dalfox", "inql", "clairvoyance", "grapeql", "nuclei", "burp_send",
}
_HYPOTHESIS_REQUIRED_MCP_ACTIONS = {"replay_captured_request"}


def _requires_hypothesis(action: dict[str, Any]) -> bool:
    name = str(action.get("action", "")).strip().lower()
    if name in _HYPOTHESIS_REQUIRED_TOOLS:
        return True
    if name in _HYPOTHESIS_REQUIRED_MCP_ACTIONS:
        # A replay without a patch is a baseline operation; a mutation is an
        # active security experiment and must be tied to a hypothesis.
        return bool(action.get("patch"))
    if name != "bash":
        return False
    command = str(action.get("command", "")).lower()
    # Exempt tool presence checks and for-loop tool inventories — these are harmless startup actions
    if "command -v" in command or "for t in" in command:
        return False
    return any(re.search(rf"(^|[;&|\s]){re.escape(tool)}\b", command) for tool in _HYPOTHESIS_REQUIRED_TOOLS)


def _validate_tool_action_schema(name: str, action: dict[str, Any]) -> ToolResult | None:
    """Enforce a typed tool contract: scanner actions must carry a target field,
    and must not smuggle an arbitrary raw command string through the action object.
    """
    if name not in _TOOL_ACTIONS:
        return None
    if "command" in action:
        return ToolResult(
            False,
            f"{name} action blocked. Use the tool action schema only; do not pass a raw scanner command string in the action object.",
            {"tool_schema_blocked": True, "tool": name},
        )
    target = str(action.get("url") or action.get("target") or action.get("host") or action.get("path") or "").strip()
    if not target:
        return ToolResult(False, f"Missing target for {name} action.", {"tool_schema_blocked": True, "tool": name})
    # Sanitize away free-form bash-like keys that bypass action typing.
    if any(key in action for key in ("shell", "stdin", "args", "argv")):
        return ToolResult(
            False,
            f"{name} action blocked. Tool actions must be typed and mapped through the canonical command builder.",
            {"tool_schema_blocked": True, "tool": name},
        )
    return None


def _build_tool_command(tool: str, url: str, action: dict[str, Any]) -> str:
    normalized_url = _normalize_target_for_tool(url)
    sanitized_url = normalized_url.replace("'", "\\'")
    if tool == "httpx":
        return f"httpx -rate-limit 5 -threads 1 '{sanitized_url}'"
    if tool == "subfinder":
        return f"subfinder -d '{sanitized_url}'"
    if tool == "nuclei":
        return f"nuclei -u '{sanitized_url}' -rate-limit 5 -concurrency 1"
    if tool == "waybackurls":
        return f"waybackurls '{sanitized_url}'"
    if tool == "gobuster":
        return f"gobuster dir -u '{sanitized_url}' -t 1 -delay 1s"
    if tool == "dirsearch":
        return f"dirsearch -u '{sanitized_url}' -t 1 --max-rate 1"
    if tool == "nikto":
        return f"nikto -host '{sanitized_url}'"
    if tool == "sqlmap":
        return f"sqlmap -u '{sanitized_url}' --batch --safe-url --threads=1"
    if tool == "xsstrike":
        return f"xsstrike -u '{sanitized_url}'"
    if tool == "wafw00f":
        return f"wafw00f '{sanitized_url}'"
    if tool == "katana":
        return f"katana -u '{sanitized_url}' -c 1 -rate-limit 5"
    if tool == "whatweb":
        return f"whatweb '{sanitized_url}'"
    if tool == "amass":
        return f"amass enum -d '{sanitized_url}'"
    if tool == "gau":
        return f"gau '{sanitized_url}'"
    if tool == "assetfinder":
        return f"assetfinder '{sanitized_url}'"
    if tool == "dnsx":
        return f"dnsx -d '{sanitized_url}'"
    if tool == "naabu":
        return f"naabu -host '{sanitized_url}' -rate 50"
    if tool == "inql":
        return f"inql --no-color -t '{sanitized_url}'"
    if tool == "clairvoyance":
        return f"clairvoyance '{sanitized_url}'"
    if tool == "grapeql":
        return f"grapeql '{sanitized_url}'"
    if tool == "feroxbuster":
        return f"feroxbuster -u '{sanitized_url}' -t 2 -d 3 --no-recursion --time-limit 60s"
    if tool == "dalfox":
        return f"dalfox url '{sanitized_url}' --only-custom-payload --no-gf --silence --skip-bav"
    if tool == "crtsh":
        return f"crtsh '{sanitized_url}'"
    return f"{tool} '{sanitized_url}'"


def _normalize_target_for_tool(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return normalized
    if normalized.startswith(("http://", "https://")):
        return normalized
    if normalized.startswith("//"):
        return f"http:{normalized}"
    if _looks_like_ip(normalized):
        return f"http://{normalized}"
    if "/" in normalized or ":" in normalized:
        return normalized
    return f"http://{normalized}"


def _looks_like_ip(value: str) -> bool:
    try:
        import ipaddress

        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def _sanitize_search_query(value: str) -> str:
    return quote(value, safe="")


def _format_search_results(html: str, max_results: int) -> str:
    parser = SearchResultParser()
    parser.feed(html)
    results = parser.results[:max_results]
    if not results:
        return _truncate(html, 3000)
    return "\n".join(
        f"{index}. {title or '(untitled)'}\n   {url}"
        for index, (title, url) in enumerate(results, start=1)
    )


def _truncate(value: str, limit: int = 12000) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"\n...[truncated {len(value) - limit} chars]"


def _browser_capture_summary(capture: dict[str, Any]) -> str:
    return (
        f"pages={len(capture.get('pages', []))}; forms={len(capture.get('forms', []))}; "
        f"scripts={len(capture.get('scripts', []))}; network_requests={len(capture.get('network', []))}; "
        f"screenshots={len(capture.get('screenshots', []))}; errors={len(capture.get('errors', []))}"
    )


def _command_fingerprint(command: str) -> str:
    normalized = re.sub(r"\s+", " ", command.strip().lower())
    normalized = re.sub(r"(authorization:\s*bearer\s+)[^\s\"']+", r"\1<token>", normalized)
    normalized = re.sub(r"\b(ldso|ob_ldso|pa_ldso|session[a-z0-9_-]*|csrf[a-z0-9_-]*)=[^;\"'\s]+", r"\1=<value>", normalized)
    normalized = re.sub(r"([?&][a-z0-9_.-]+=)[^&\s]+", r"\1<value>", normalized)
    normalized = re.sub(r"\b[a-f0-9]{16,}\b", "<hex>", normalized)
    # Normalize GraphQL query bodies - replace all field names with <field>
    if '{"query"' in normalized or '"query":"' in normalized:
        normalized = re.sub(r"\b[a-z_]+(?=\s*[:\(\{])", "<field>", normalized)
        normalized = re.sub(r"\b[a-z_]+(?=\s*\()", "<field>", normalized)
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()[:16]


def _finding_fingerprint(finding: Finding) -> str:
    text = " ".join(
        [
            finding.title,
            finding.severity,
            finding.asset,
            finding.evidence,
            finding.request,
        ]
    ).lower()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"['\"]?[./]*etc/(passwd|shadow|hosts)['\"]?", "etc-file", text)
    text = re.sub(r"\b[a-f0-9]{8,}\b", "hex-token", text)
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16]


def _surface_route_key(url: str) -> str:
    """Stable per-surface key for the fallback-ladder burn registry.

    Normalizes the URL (challenge-token/tracking strip, www, protocol, path)
    so the same surface maps to one key regardless of the exact URL variant
    the model passed.
    """
    normalized = normalize_url(url if "://" in url else f"https://{url}")
    parsed = urlparse(normalized)
    return (parsed.hostname or "").lower() + (parsed.path or "/")


def _action_target(action: dict[str, Any]) -> str:
    for key in ("asset", "command", "query", "path", "name"):
        value = str(action.get(key, "")).strip()
        if value:
            return value[:300]
    return str(action.get("action", ""))


def _action_tags(action: dict[str, Any], result: ToolResult) -> list[str]:
    tags = [str(action.get("action", ""))]
    command = str(action.get("command", "")).lower()
    query = str(action.get("query", "")).lower()
    if any(tool in command for tool in ("katana", "subfinder", "waybackurls", "gau", "ffuf", "gobuster", "dirsearch")):
        tags.append("discovery")
    if any(tool in command for tool in ("httpx", "wafw00f", "whatweb")):
        tags.append("fingerprint")
    if any(tool in command for tool in ("nuclei", "nikto", "xsstrike", "sqlmap", "dalfox")):
        tags.append("scanner")
    if "inql" in command or "graphql" in command:
        tags.append("graphql")
    if "python" in command:
        tags.append("verification")
    if query:
        tags.append("research")
    if result.meta.get("finding_rejected"):
        tags.append("rejected")
    return [tag for tag in tags if tag]


def _validate_finding_evidence(finding: Finding) -> str:
    evidence = finding.evidence.strip().lower()
    combined = " ".join([finding.evidence, finding.request, finding.response]).lower()
    severity = finding.severity.strip().lower()
    if severity in {"", "unknown", "info", "informational"}:
        return "Finding rejected: informational observations belong in recon notes, not the findings section."
    if not finding.request.strip() or not finding.response.strip():
        return "Finding rejected: provide the exact request and response used to reproduce the behavior."
    impact_text = finding.impact.strip()
    if not impact_text:
        return "Finding rejected: describe concrete security impact, not only unexpected behavior."
    if impact_text.lower() in {"none", "n/a", "no impact", "unknown"}:
        return "Finding rejected: impact must describe concrete security harm, not 'none' or a placeholder."
    if not evidence:
        return "Finding rejected: evidence is empty. Include a concrete request/response excerpt or evidence file path."
    weak_markers = [
        "tool result summary",
        "content_length=",
        "content_length",
        "httpx: not found",
        "command not found",
        "sh: 1:",
        "syntax error",
        "unterminated quoted string",
        "unmatched closing",
        "unmatched '}'",
        "unmatched ']'",
    ]
    if any(marker in combined for marker in weak_markers):
        return (
            "Finding rejected: summaries, missing tools, client-side syntax failures, or content length alone "
            "are not vulnerability evidence."
        )
    if "404 page not found" in combined and not any(term in combined for term in ["bypass", "leak", "unauthorized data"]):
        return "Finding rejected: a 404 response alone is not evidence of a vulnerability."
    benign_markers = ["sitemap available", "endpoint available", "authentication required", "unauthorized html"]
    if any(marker in combined or marker in finding.title.lower() for marker in benign_markers):
        return "Finding rejected: public discovery or expected authentication behavior is not a vulnerability."
    if "sitemap" in finding.title.lower() or "robots" in finding.title.lower():
        return "Finding rejected: sitemap or robots.txt discovery belongs in recon notes, not findings."
    if re.search(r"\b(401|403|404)\b", combined) and not any(
        term in combined for term in ["bypass", "cross-tenant", "unauthorized data", "sensitive data"]
    ):
        return "Finding rejected: an expected 401, 403, or 404 response is not a vulnerability without bypass impact."
    if "http 200" in combined or "200 ok" in combined:
        if any(term in combined for term in ["links to /api", "flag in api response", "default flag", "idor-test-2"]):
            return "Finding rejected: an authenticated normal API listing response is not IDOR evidence without cross-tenant or unauthorized data proof."
    if any(term in combined for term in ["google search", "search results above"]):
        return "Finding rejected: public research output is context, not vulnerability evidence."
    if "varnish cache hit" in combined and not any(term in combined for term in ["other tenant", "cross-tenant", "cached private data", "sensitive response body"]):
        return "Finding rejected: a cache hit alone is not evidence of cross-tenant leakage."
    if "timed out" in combined or "timeout" in combined:
        return "Finding rejected: timeout or reachability issues are reliability observations, not security findings."
    if "invalid or missing ldso cookie" in combined and not any(term in combined for term in ["bypass", "still returned data", "unauthorized data", "other tenant"]):
        return "Finding rejected: invalid-cookie errors indicate an auth boundary, not a bypass."
    if re.search(r"\b200 ok\b", combined) and not any(term in combined for term in ["unauthorized", "cross-tenant", "sensitive", "__schema", "mutation", "stack trace", "token", "internal error"]):
        return "Finding rejected: a 200 OK alone is not enough evidence of a vulnerability."
    return ""


def _classify_finding_rung(finding: Finding) -> tuple[str, str]:
    combined = " ".join([finding.title, finding.request, finding.response, finding.evidence, finding.impact]).lower()
    if any(term in combined for term in ["search result", "google search", "medium.com", "stackoverflow"]):
        return ("observed", "public research context does not demonstrate a vulnerability")
    if any(term in combined for term in ["graphql endpoint found", "endpoint exists", "responds with empty json", "cache hit", "301 moved permanently", "405", "timed out"]):
        return ("interesting", "this is an interesting surface or behavior, but not proof of exploitability")
    if any(term in combined for term in ["potential", "investigate further", "verify if", "possible", "may allow"]):
        return ("candidate", "the write-up still describes a hypothesis rather than a validated issue")
    if any(term in combined for term in ["unauthorized data", "cross-tenant", "idor", "auth bypass", "schema", "__schema", "stack trace", "internal error", "injection"]) and any(term in combined for term in ["200 ok", "http/1.1 200", "data:", "body:", "{", "["]):
        return ("validated", "the finding includes both a concrete security hypothesis and a response suggesting impact")
    return ("suspicious", "the observation needs stronger unauthorized behavior or impact proof before it becomes a finding")


def _reject_empty_workspace_write(path: str, content: str) -> str | None:
    stripped = content.strip()
    if not stripped:
        suffix = Path(path).suffix.lower()
        if suffix in {".py", ".js", ".ts", ".tsx", ".sh", ".bash", ".ps1", ".json", ".md", ".txt", ".yaml", ".yml"}:
            return (
                f"Refusing to write empty or whitespace-only content to {path}. "
                "Write a concise but useful artifact instead."
            )
        return None
    suffix = Path(path).suffix.lower()
    basename = Path(path).name.lower()
    if suffix == ".py":
        if len(stripped) < 24:
            return f"Refusing to write underspecified Python artifact to {path}. Include a complete executable script."
        try:
            ast.parse(content)
        except SyntaxError as exc:
            return f"Refusing to write syntactically invalid Python to {path}: {exc.msg}."
    if suffix == ".json":
        try:
            import json

            json.loads(content)
        except Exception:
            return f"Refusing to write invalid JSON to {path}."
    if suffix == ".txt" and any(term in basename for term in ("request", "response", "evidence", "graphql", "proof", "artifact")):
        line_count = len([line for line in content.splitlines() if line.strip()])
        lowered = stripped.lower()
        if line_count < 2 and not any(term in lowered for term in ("status", "response", "query", "mutation", "headers", "--- stdout ---")):
            return (
                f"Refusing to write low-signal text artifact to {path}. "
                "Preserve the exact request plus observed response or evidence, not only a bare command."
            )
        required_markers = ("target:", "response", "why_interesting", "method:")
        if "graphql" in basename and not any(marker in lowered for marker in ("query", "mutation", "response_status", "response_body_excerpt")):
            return f"Refusing to write incomplete GraphQL evidence to {path}. Include request shape and response excerpt."
        if any(term in basename for term in ("request", "response", "evidence")) and sum(marker in lowered for marker in required_markers) < 2:
            return f"Refusing to write underspecified evidence text to {path}. Include structured request/response sections."
    if re.search(r"(payload|headers|data)\s*=\s*['\"]?\{\s*$", stripped, re.I):
        return f"Refusing to write obviously truncated artifact to {path}."
    if suffix in {".py", ".js", ".ts", ".tsx", ".sh", ".bash", ".ps1", ".json", ".md", ".txt", ".yaml", ".yml"} and stripped.endswith(("payload = '{", 'payload = "{', "headers = {", "data = {", "query = {")):
        return (
            f"Refusing to write truncated artifact to {path}. "
            "Write the complete content instead of a partial stub."
        )
    return None


def _artifact_contract_guidance(path: str) -> str:
    suffix = Path(path).suffix.lower()
    basename = Path(path).name.lower()
    if suffix == ".py":
        return (
            "Write a complete runnable verifier with: imports, target URL, headers/cookies if needed, request payload, "
            "actual request execution, and printed response status plus a short body excerpt.\n"
            "Template:\n"
            "import requests\n"
            "url = 'https://example.com/path'\n"
            "headers = {'Content-Type': 'application/json'}\n"
            "cookies = {'name': 'value'}\n"
            "payload = {'key': 'value'}\n"
            "resp = requests.post(url, headers=headers, cookies=cookies, json=payload, timeout=20)\n"
            "print('STATUS:', resp.status_code)\n"
            "print('HEADERS:', dict(resp.headers))\n"
            "print('BODY:', resp.text[:800])"
        )
    if suffix == ".json":
        return (
            "Write valid JSON only. For evidence JSON, prefer keys like target, method, headers, cookies, body, "
            "response_status, response_headers, response_body_excerpt, and why_interesting."
        )
    if suffix == ".txt":
        if "graphql" in basename:
            return (
                "Write structured GraphQL evidence with sections:\n"
                "TARGET:\nMETHOD:\nHEADERS:\nCOOKIES:\nOPERATION:\nQUERY:\nVARIABLES:\n"
                "RESPONSE_STATUS:\nRESPONSE_HEADERS:\nRESPONSE_BODY_EXCERPT:\nWHY_INTERESTING:"
            )
        if any(term in basename for term in ("request", "response", "evidence", "proof", "artifact")):
            return (
                "Write structured evidence text with sections:\n"
                "TARGET:\nMETHOD:\nHEADERS:\nCOOKIES:\nBODY:\nRESPONSE_STATUS:\n"
                "RESPONSE_HEADERS:\nRESPONSE_BODY_EXCERPT:\nWHY_INTERESTING:"
            )
    return "Write a complete, non-empty artifact that preserves exact inputs, observed outputs, and why the result matters."


def _safe_artifact_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip()).strip(".-").lower()
    return cleaned[:80]


def _render_verifier(target: str, method: str, headers: object, body: object) -> str:
    safe_headers = headers if isinstance(headers, dict) else {}
    safe_body = body if isinstance(body, (dict, list, str, int, float, bool)) or body is None else None
    return (
        "# Generated by ChainsawRecon. Review before executing against an authorized target.\n"
        "import json\n"
        "import requests\n\n"
        f"URL = {target!r}\n"
        f"METHOD = {method!r}\n"
        f"HEADERS = {safe_headers!r}\n"
        f"BODY = {safe_body!r}\n\n"
        "response = requests.request(METHOD, URL, headers=HEADERS, json=BODY, timeout=20, allow_redirects=False)\n"
        "print('STATUS:', response.status_code)\n"
        "print('HEADERS:', json.dumps(dict(response.headers), sort_keys=True))\n"
        "print('BODY:', response.text[:2000])\n"
    )




# --- Milestone 2: Tool-first policy & 7-Question Gate ---


_SURFACE_TYPE_TO_TOOL = {
    "graphql": ["inql", "clairvoyance"],
    "api": ["httpx", "katana"],
    "js": ["katana", "httpx"],
    "auth": ["httpx", "wafw00f"],
    "upload": ["httpx"],
    "redirect": ["httpx"],
    "version": ["httpx", "whatweb"],
    "web": ["httpx", "katana"],
}


def recommended_tool_for_surface(surface_type: str) -> list[str]:
    """Deterministic surface-type -> tool mapping for the tool-first policy."""
    return list(_SURFACE_TYPE_TO_TOOL.get(surface_type, ["httpx"]))


def is_bulk_python_scan(command: str) -> bool:
    """Detect the 'write one python script that scans 100 endpoints' anti-pattern.

    Only matches actual Python script execution, not bash loops that mention
    python3 as a tool name in a command -v inventory check.
    """
    lowered = command.lower()
    # Exempt baseline recon commands (tool presence check, robots.txt, sitemap.xml)
    if _is_baseline_recon_command(command):
        return False
    # Must be actual Python invocation: python3 script.py, python3 -c "code", or python3 <<EOF
    # Do NOT match bash loops like: for t in curl python3 httpx; do ... done
    is_python_invocation = bool(re.search(r'\bpython3?\s+(?:-[a-z]+\s+)?[a-zA-Z0-9_./-]+\.py\b', lowered) or
                                re.search(r'\bpython3?\s+-c\s+', lowered) or
                                re.search(r'\bpython3?\s+<<', lowered))
    if not is_python_invocation:
        return False
    # Now check for bulk scanning patterns within the Python script/command
    if "range(" in lowered or "for " in lowered:
        if "requests" in lowered or "urllib" in lowered or "httpx" in lowered:
            return True
    return False


_QUESTION_GATE = [
    "1. In-scope: Is the asset explicitly within the engagement program scope?",
    "2. Reproducible: Is there an exact request + response pair that anyone can replay?",
    "3. Real impact: Does the evidence demonstrate unauthorized access, data exposure, or security control bypass (not just unexpected behavior)?",
    "4. Not auth-gate: Is this a true bypass or cross-tenant access, not merely a login wall or expected 401/403?",
    "5. Business relevance: Does this affect user data, tenant isolation, or a core application function?",
    "6. VRT severity: Does this map to a VRT category at Low or above?",
    "7. POE complete: Is the full Proof of Exploit (request, response, and why-interesting) present and complete?",
]


def evaluate_finding_7q(finding: Finding) -> tuple[str, list[str]]:
    """Run the 7-Question Gate on a finding candidate.

    Returns (rung, failed_reasons). rung is 'validated' if all questions pass,
    otherwise 'candidate' with the list of failing questions.
    """
    evidence_text = " ".join([
        finding.title, finding.request, finding.response, finding.evidence, finding.impact,
    ]).lower()
    failures: list[str] = []
    if not finding.asset.strip():
        failures.append("1. cannot verify scope without an asset field")
    if not finding.request.strip() or not finding.response.strip():
        failures.append("2. missing exact request or response")
    impact_lower = finding.impact.strip().lower()
    if not impact_lower or impact_lower in {"none", "n/a", "no impact", "unknown"}:
        failures.append("3. no concrete security impact described")
    impact_markers = [
        "unauthorized", "cross-tenant", "idor", "bypass", "schema", "__schema",
        "stack trace", "injection", "sensitive data", "leaked", "exposed",
    ]
    if not any(term in evidence_text for term in impact_markers):
        failures.append("3. evidence does not show unauthorized access or data exposure")
    auth_gate_terms = [
        "login", "sign in", "authentication required", "please log in",
        "401 unauthorized", "403 forbidden", "access challenge",
    ]
    bypass_terms = ["bypass", "cross-tenant", "still returned", "after bypass"]
    if any(term in evidence_text for term in auth_gate_terms):
        if not any(term in evidence_text for term in bypass_terms):
            failures.append("4. appears to be an auth-gate, not a verified bypass")
    if finding.severity.strip().lower() in {"", "unknown", "info", "informational"}:
        failures.append("6. severity not specified or informational")
    weak_markers = [
        "content_length", "tool result summary", "command not found",
        "syntax error", "httpx: not found", "timed out", "timeout",
    ]
    if any(marker in evidence_text for marker in weak_markers):
        failures.append("7. evidence contains weak markers (summaries, timeouts, tool errors)")
    if not failures:
        return ("validated", [])
    return ("candidate", failures)



def _validate_command_safety(command: str) -> ToolResult | None:
    lowered = command.lower()
    blocked_patterns = [
        r"\brm\s+-[^\n]*r[^\n]*f\b",
        r"\bmkfs\b",
        r"\bdd\s+if=",
        r"\bshutdown\b",
        r"\breboot\b",
        r"\bmasscan\b",
        r"\bhping3\b",
        r"\bslowhttptest\b",
        r"\bhydra\b",
        r"\bmedusa\b",
        r"\bhashcat\b",
        r"\bjohn\b",
        r":\(\)\s*\{\s*:\|:",
    ]
    for pattern in blocked_patterns:
        if re.search(pattern, lowered):
            return ToolResult(
                False,
                "Command blocked by safety policy. Use low-impact recon and verification only.",
                {"safety_blocked": True, "pattern": pattern},
            )
    # Harden the validator against malformed scanner grammar that the model can emit
    # through the command-compiler loop. These are syntax rejections, not runtime
    # scanner hints, so they should fail immediately with the same rate-guard meta.
    if re.search(r"\bhttpx\b.*\s-(?:t|c)\b", lowered):
        return ToolResult(
            False,
            "httpx command blocked because it uses malformed low-rate flag grammar. "
            "Replace -t/-c with the supported httpx rate/threads controls instead of emitting an ungrounded alias map.",
            {"rate_guard_blocked": True, "tool": "httpx"},
        )
    if re.search(r"\bkatana\b.*\s-ls\b", lowered):
        return ToolResult(
            False,
            "katana command blocked because it uses a malformed or unsupported flag grammar. "
            "Use a supported katana rate/concurrency signal such as -c or the documented rate-limit flag instead of -ls.",
            {"rate_guard_blocked": True, "tool": "katana"},
        )
    if "command -v" in lowered:
        return None
    scanner_rate_hints = {
        "ffuf": [" -rate", " --rate", " -t 1", " -t 2", " -t 3", " -t 4", " -t 5"],
        "nuclei": [" -rl ", " -rate-limit", " -rate", " --rate", " -c ", " -concurrency", " --concurrency", " -t 1", " -t 2"],
        "httpx": [" -rl ", " -rate-limit", " -rate", " --rate", " -threads", " --threads"],
        "katana": [" -rl ", " -rate-limit", " -rate", " --rate", " -c ", " -concurrency", " --concurrency"],
        "gobuster": [" -t ", " --delay ", " --rate "],
        "dirsearch": [" --max-rate ", " -t ", " --rate "],
        "sqlmap": [" --delay=", " --threads=", " --safe-url", " --batch"],
    }
    # Accept if ANY rate/concurrency/t thread flag is present in the command
    command_padded = f" {lowered} "
    for tool, hints in scanner_rate_hints.items():
        if re.search(rf"(^|[;&]\s*){tool}\b|\s{tool}\b", lowered):
            if not any(hint in command_padded for hint in hints):
                return ToolResult(
                    False,
                    (
                        f"{tool} command blocked because it lacks explicit low-rate/concurrency controls. "
                        "Add flags like --rate 1, --concurrency 1, -t 1, or --batch."
                    ),
                    {"rate_guard_blocked": True, "tool": tool},
                )
    return None


class SearchResultParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[tuple[str, str]] = []
        self._href = ""
        self._text: list[str] = []
        self._capture = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        values = {key: value or "" for key, value in attrs}
        href = values.get("href", "")
        css_class = values.get("class", "")
        if "result__a" in css_class or href.startswith("http") or "uddg=" in href:
            self._capture = True
            self._href = _unwrap_search_url(href)
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._text.append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._capture:
            return
        title = " ".join(part for part in self._text if part).strip()
        if self._href and not any(url == self._href for _, url in self.results):
            self.results.append((title, self._href))
        self._capture = False
        self._href = ""
        self._text = []


def _unwrap_search_url(value: str) -> str:
    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    if "uddg" in query and query["uddg"]:
        return unquote(query["uddg"][0])
    return value


def _is_graphql_introspection(command: str) -> bool:
    """Detect if a command is a GraphQL introspection or query probe.

    GraphQL queries are all different (different fields, arguments, variables)
    so they should not be treated as repeated commands. This exempts:
    - Introspection queries (__schema, __type, __typename)
    - GraphQL POST requests with query bodies
    - GET requests with ?query= parameter containing GraphQL syntax
    """
    lowered = command.lower()
    # GraphQL introspection markers
    if any(marker in lowered for marker in ("__schema", "__type", "__typename")):
        return True
    # GraphQL query/mutation/subscription in POST body or GET query param
    if '{"query"' in lowered or '"query":"' in lowered or "'query':'" in lowered:
        return True
    if "?query=" in lowered and any(marker in lowered for marker in ("{", "query", "mutation", "subscription")):
        return True
    # GraphQL content-type header
    if "application/graphql" in lowered:
        return True
    return False


def _is_baseline_recon_command(command: str) -> bool:
    """Exempt baseline recon checks that run on EVERY target from repeat-blocking.

    The deterministic recon plan runs these on each target:
    - robots.txt fetch
    - sitemap.xml fetch
    - tool presence check (for t in curl python3 ...)
    """
    lowered = command.lower()
    # robots.txt or sitemap.xml fetch
    if "robots.txt" in lowered or "sitemap.xml" in lowered:
        return True
    # Tool presence check command
    if "command -v" in lowered and "for t in" in lowered:
        return True
    return False


def _is_login_or_credential_command(command: str) -> bool:
    """Detect login, registration, password, or session automation attempts."""
    lowered = command.lower()
    login_markers = [
        "login", "signin", "sign-in", "sign_in",
        "register", "signup", "sign-up", "sign_up",
        "password", "passwd", "pass_word",
        "credential", "auth_token", "authentication",
        "session cookie", "obtain.*session", "obtain.*auth",
        "test@example.com", "test123",
    ]
    return any(marker in lowered for marker in login_markers)
