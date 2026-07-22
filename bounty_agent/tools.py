from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from typing import Any, Optional
from urllib.parse import parse_qs, quote, unquote, urlparse

from .canonical_surface import normalize_url
from .engagement_state import EngagementStateStore
from .infrastructure import ChallengeType, InfrastructureStore, classify_response, extract_hosts_from_tool_output
from .retrieval import RetrievalStore
from .recon_db import (
    NullReconStore,
    ReconObservation,
    ReconStore,
    build_attack_results_from_action_result,
    build_facts_from_action_result,
    build_surfaces_from_action_result,
)
from .sandbox import SandboxRunner
from .scope import ScopeGuard
from .skills import get_skill
from .strategy_memory import StrategyMemory
from .trace import TraceLogger


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
        self.finding_fingerprints: set[str] = set()
        self._tool_presence_cache: dict[str, bool] = {}
        self.state_store = state_store
        self.run_id = run_id
        self.active_objective_id: str | None = None
        self.active_hypothesis_id: str | None = None
        self.active_target = ""
        self.max_actions = max(0, max_actions)
        self.action_count = 0

        self._infra_store: Optional[InfrastructureStore] = None
        self._strategy_memory: Optional[StrategyMemory] = None

    def set_infrastructure_store(self, store: InfrastructureStore) -> None:
        """Attach infrastructure store for WAF/challenge awareness."""
        self._infra_store = store

    def set_strategy_memory(self, memory: StrategyMemory) -> None:
        """Attach strategy memory for preventing retry loops."""
        self._strategy_memory = memory

    def set_execution_context(self, *, objective_id: str | None = None, hypothesis_id: str | None = None,
                              target: str = "") -> None:
        """Attach all subsequent actions to the current security objective."""
        self.active_objective_id = objective_id
        self.active_hypothesis_id = hypothesis_id
        self.active_target = target

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
        # Reset consecutive search counter on non-search actions
        if name != "search":
            self._consecutive_search_count = 0
        try:
            if self.state_store and _requires_hypothesis(action) and not (
                action.get("hypothesis_id") or self.active_hypothesis_id
            ):
                result = ToolResult(
                    False,
                    "This attack action requires a recorded hypothesis first. Use create_hypothesis with the security question and required evidence, then run one bounded experiment.",
                    {"hypothesis_required": True},
                )
            elif name == "bash":
                result = self._bash(action)
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
            elif name == "write_file":
                result = self._write_file(action)
            elif name == "list_files":
                result = self._list_files(action)
            elif name == "use_skill":
                result = self._use_skill(action)
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
            else:
                result = ToolResult(False, f"Unsupported action: {name}")
        except Exception as exc:
            result = ToolResult(False, f"{type(exc).__name__}: {exc}")
        self.trace.write("tool_result", ok=result.ok, content=_truncate(result.content), meta=result.meta)
        self.history.append((action, result))
        self._record_recon_state(action, result)
        self._record_phase_one_state(action, result)
        return result

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

        repeat_result = self._check_repeated_command(command)
        if repeat_result:
            return repeat_result

        scope = self.scope_guard.validate_command(command)
        if not scope.allowed:
            return ToolResult(False, f"Scope blocked command: {scope.reason}", {"hosts": scope.hosts})

        self.rate_limiter.wait()
        result = self.runner.exec(command, timeout)
        self._add_discovered_hosts(result.stdout or "", result.stderr or "")

        # Infrastructure-aware block detection using classify_response
        combined = (result.stdout or "") + " " + (result.stderr or "")
        exit_ok = result.exit_code == 0

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

        content = (
            f"exit_code={result.exit_code} timed_out={result.timed_out}\n"
            f"--- stdout ---\n{_truncate(result.stdout)}\n"
            f"--- stderr ---\n{_truncate(result.stderr)}"
        )
        return ToolResult(result.exit_code == 0, content)

    def _tool_action(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("action", "")).strip()
        url = str(action.get("url") or action.get("target") or action.get("path") or "").strip()
        host = str(action.get("host") or "").strip()
        if not url and host:
            url = host
        if not url:
            return ToolResult(False, f"Missing target for {name} action.")
        command = _build_tool_command(name, url, action)
        return self._bash({**action, "action": "bash", "command": command, "timeout_seconds": action.get("timeout_seconds", self.runner.settings.command_timeout_seconds)})

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
        return ToolResult(True, self.runner.read_file(path))

    def _write_file(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", "")).strip()
        if not path:
            return ToolResult(False, "Missing file path. Include 'path' key with the file path.")
        repeat_result = self._check_repeated_write(path)
        if repeat_result:
            return repeat_result
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

    def _check_repeated_write(self, path: str) -> ToolResult | None:
        count = self.command_counts.get(f"_write_{path}", 0) + 1
        self.command_counts[f"_write_{path}"] = count
        if count <= 2:
            return None
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

        self.finding_fingerprints.add(fingerprint)
        self.findings.append(finding)
        return ToolResult(True, f"Recorded finding: {finding.title}")

    def _check_repeated_skill(self, action: dict[str, Any]) -> ToolResult | None:
        name = str(action.get("name", "")).strip().lower()
        objective = str(action.get("objective", "")).strip().lower()
        context = str(action.get("context", "")).strip().lower()
        fingerprint = "|".join([name, objective, context])
        count = self.skill_counts.get(fingerprint, 0) + 1
        self.skill_counts[fingerprint] = count
        if count <= 2:
            return None
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


class CommandRateLimiter:
    def __init__(self, delay_seconds: float, max_commands_per_minute: int, trace: TraceLogger) -> None:
        self.delay_seconds = max(0.0, delay_seconds)
        self.min_interval = 60.0 / max_commands_per_minute if max_commands_per_minute > 0 else 0.0
        self.trace = trace
        self._last_command_at = 0.0

    def wait(self) -> None:
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
    "sqlmap", "xsstrike", "dalfox", "inql", "clairvoyance", "grapeql",
}


def _requires_hypothesis(action: dict[str, Any]) -> bool:
    name = str(action.get("action", "")).strip().lower()
    if name in _HYPOTHESIS_REQUIRED_TOOLS:
        return True
    if name != "bash":
        return False
    command = str(action.get("command", "")).lower()
    return any(re.search(rf"(^|[;&|\s]){re.escape(tool)}\b", command) for tool in _HYPOTHESIS_REQUIRED_TOOLS)


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
    if "command -v" in lowered:
        return None
    scanner_rate_hints = {
        "ffuf": [" -rate", " --rate", " -t 1", " -t 2", " -t 3", " -t 4", " -t 5"],
        "nuclei": [" -rl ", " -rate-limit", " -rate", " --rate", " -c ", " -concurrency", " --concurrency", " -t 1", " -t 2"],
        "httpx": [" -rl ", " -rate-limit", " -rate", " --rate", " -threads", " --threads", " -c ", " -t "],
        "katana": [" -rl ", " -rate-limit", " -rate", " --rate", " -c ", " -concurrency", " --concurrency", " -t "],
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
