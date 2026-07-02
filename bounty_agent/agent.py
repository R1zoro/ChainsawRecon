from __future__ import annotations

from datetime import datetime
import json
import re
import tempfile
from pathlib import Path

from .config import AgentSettings, ProgramScope
from .llm import ChatMessage, LLMClient, NullLLMClient, OpenAICompatibleClient
from .prompts import build_system_prompt, deterministic_recon_plan
from .report import write_report
from .retrieval import NullRetrievalStore, RetrievalStore
from .recon_db import NullReconStore, ReconStore, promote_run_facts
from .sandbox import DockerSandboxRunner, LocalWorkspaceRunner
from .scope import ScopeGuard
from .tools import ToolRegistry
from .trace import TraceLogger


class BountyAgent:
    def __init__(self, scope: ProgramScope, target: str, settings: AgentSettings, runs_dir: Path) -> None:
        self.scope = scope
        self.target = target
        self.settings = settings
        self.session_targets = [item for item in settings.session_targets if item] or [target]
        self.initial_targets = list(dict.fromkeys(self.session_targets))
        self.pending_targets = list(dict.fromkeys(self.session_targets))
        self.completed_targets: list[str] = []
        self.target_outcomes: dict[str, str] = {}
        self.run_dir = settings.session_run_dir or (runs_dir / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{_slug(target)}")
        self.workspace = self.run_dir / "workspace"
        self.trace = TraceLogger(self.run_dir / "trace.jsonl")
        self.retrieval = self._build_retrieval_store()
        self.run_recon = self._build_run_recon_store()
        self.engagement_recon = self._build_engagement_recon_store()
        # create ScopeGuard with per-run dynamic allowlist and optional allow-all
        dynamic_file = self.workspace / "allowed_hosts.txt"
        self.scope_guard = ScopeGuard(scope, dynamic_allow_file=dynamic_file, allow_all=self.settings.allow_all_hosts)
        self.runner = self._build_runner()
        self.tools = ToolRegistry(
            self.runner,
            self.scope_guard,
            self.trace,
            self.retrieval,
            self.run_recon,
            command_delay_seconds=settings.command_delay_seconds,
            max_commands_per_minute=settings.max_commands_per_minute,
            max_repeated_commands=settings.max_repeated_commands,
        )
        self.llm = self._build_llm()

    def run(self) -> Path:
        try:
            return self._run()
        finally:
            self.runner.close()
            self.retrieval.close()
            self.run_recon.close()
            self.engagement_recon.close()

    def _run(self) -> Path:
        self.trace.write("session_start", targets=self.session_targets, runner=self.settings.runner)
        effective_mode = self._resolve_effective_mode()
        self.trace.write("mode_selected", requested=self.settings.mode, effective=effective_mode)
        self._refresh_session_queue()
        self._persist_session_state(effective_mode)

        while self.pending_targets:
            index = len(self.completed_targets) + 1
            current_target = self.pending_targets.pop(0)
            self.target = current_target
            target_decision = self.scope_guard.validate_target(current_target)
            self.trace.write(
                "start_target",
                target=current_target,
                queue_index=index,
                queue_total=index + len(self.pending_targets),
                scope_allowed=target_decision.allowed,
                reason=target_decision.reason,
            )
            if not target_decision.allowed:
                self.target_outcomes[current_target] = f"blocked before recon ({target_decision.reason})"
                self.completed_targets.append(current_target)
                self._refresh_session_queue()
                self._persist_session_state(effective_mode)
                continue

            messages = [
                ChatMessage("system", build_system_prompt(self.scope, current_target, self.settings)),
                ChatMessage("system", self._build_engagement_memory_prompt()),
                ChatMessage("system", self._build_coverage_memory_prompt()),
                ChatMessage("system", self._build_mapping_context_prompt()),
                ChatMessage("system", self._build_mode_guidance_prompt(effective_mode)),
                ChatMessage("system", self._build_phase_handoff_prompt(effective_mode)),
                ChatMessage("user", f"Begin with safe recon for queue target {index}: {current_target}. Pending queue size after this target: {len(self.pending_targets)}. Record only findings with concrete evidence."),
            ]

            for action in deterministic_recon_plan(current_target):
                if self.settings.dry_run:
                    self.trace.write("dry_run_action", action=action)
                    result_content = f"Dry run: would execute {action.get('command')}"
                    result_ok = True
                else:
                    result = self.tools.execute(action)
                    result_content = result.content
                    result_ok = result.ok
                self.retrieval.add(index, action, result_content, {"type": action.get("action"), "phase": "startup", "target": current_target})
                messages.append(ChatMessage("user", self._format_tool_feedback(action, result_ok, result_content)))

            summary = ""
            if self._should_run_mapping_preflight(effective_mode):
                self.trace.write("mode_preflight", mode=effective_mode, action="mapping", target=current_target)
                summary = self._run_mapping_preflight(messages)
            if effective_mode == "mapping":
                summary = summary or f"{current_target}: mapping mode completed."
            elif self.settings.model:
                summary = self._run_llm_loop(messages)
            else:
                summary = f"{current_target}: dry run completed without an LLM."
            self.target_outcomes[current_target] = summary
            self.completed_targets.append(current_target)
            discovered = self._extend_pending_targets_from_recon()
            if discovered:
                self.trace.write("queue_extended", source_target=current_target, discovered=discovered)
            self._refresh_session_queue()
            self._persist_session_state(effective_mode)

        summary_lines = [f"{target}: {self.target_outcomes[target]}" for target in self.completed_targets]
        summary = "\n".join(summary_lines) if summary_lines else "No targets were processed."

        write_report(
            self.run_dir / "report.md",
            self.scope,
            ", ".join(self.session_targets),
            self.tools.findings,
            summary,
            self.tools.history,
            self.run_recon.facts(),
            self.engagement_recon.facts(),
            self.run_recon.coverage_summary(),
            self.engagement_recon.coverage_summary(),
            self.completed_targets or self.session_targets,
            self._persist_potential_weaknesses(),
        )
        promoted = self._promote_run_memory()
        self.trace.write("recon_promoted", count=promoted, engagement_db=str(self._engagement_db_path()))
        self.trace.write("finish", report=str(self.run_dir / "report.md"))
        self._persist_session_state(effective_mode, finished=True)
        return self.run_dir

    def _run_llm_loop(self, messages: list[ChatMessage]) -> str:
        final_summary = ""
        invalid_json_count = 0
        repeat_blocks = 0
        finish_rejections = 0
        llm_history_start = len(self.tools.history)
        action_counts: dict[str, int] = {}
        for step in range(self.settings.max_steps):
            try:
                memory_snippet = self._build_retrieval_context(messages, step)
                coverage_snippet = self._build_coverage_brief(step)
                progress_hint = self._build_progress_hint(step, action_counts, repeat_blocks)
                response = self.llm.complete(messages + memory_snippet + coverage_snippet + progress_hint)
            except Exception as exc:
                message = f"LLM call failed: {type(exc).__name__}: {exc}"
                self.trace.write("model_error", step=step, error=message)
                return message
            self.trace.write("model_response", step=step, content=response)
            action = parse_json_action(response)
            if not action:
                invalid_json_count += 1
                if invalid_json_count >= 5:
                    message = "Stopped after 5 malformed or empty model responses."
                    self.trace.write("model_error", step=step, error=message)
                    return message
                messages.append(
                    ChatMessage(
                        "user",
                        (
                            "FORMAT ERROR. Reply with one JSON object only. No explanation or markdown. "
                            'Example: {"action":"finish","summary":"Unable to continue safely."}'
                        ),
                    )
                )
                continue
            invalid_json_count = 0
            if action.get("action") == "finish":
                proposed_summary = str(action.get("summary", "Finished."))
                gaps = _recon_coverage_gaps(self.tools.history[llm_history_start:], self.scope_guard)
                coverage_gaps = self._surface_coverage_gaps()
                attack_gaps = self._attack_family_gaps()
                rejected_reason = ""
                if gaps:
                    rejected_reason = "Recon coverage is incomplete: " + "; ".join(gaps)
                elif coverage_gaps:
                    rejected_reason = "Surface coverage is incomplete: " + "; ".join(coverage_gaps)
                elif attack_gaps:
                    rejected_reason = "Attack-family coverage is incomplete: " + "; ".join(attack_gaps)
                elif _summary_claims_findings(proposed_summary) and not self.tools.findings:
                    rejected_reason = "The summary claims a vulnerability or finding, but no finding passed evidence validation."
                if rejected_reason:
                    finish_rejections += 1
                    if finish_rejections >= 3:
                        return f"Stopped because the model attempted to finish before completing recon. {rejected_reason}"
                    messages.append(ChatMessage("assistant", json.dumps(action)))
                    messages.append(
                        ChatMessage(
                            "user",
                            (
                                f"FINISH REJECTED. {rejected_reason}. Continue with the missing recon steps. "
                                "Do not record normal public pages, expected 401/403/404 responses, or auth-required "
                                "HTML as findings."
                            ),
                        )
                    )
                    continue
                final_summary = proposed_summary
                break
            action_name = str(action.get("action", ""))
            action_counts[action_name] = action_counts.get(action_name, 0) + 1
            if self.settings.dry_run and action.get("action") == "bash":
                result_content = f"Dry run: would execute {action.get('command')}"
                result_ok = True
                self.trace.write("dry_run_action", action=action)
            else:
                result = self.tools.execute(action)
                result_content = result.content
                result_ok = result.ok
                if result.meta.get("repeat_blocked"):
                    repeat_blocks += 1
            self.retrieval.add(step, action, result_content, {"type": action.get("action")})
            messages.append(ChatMessage("assistant", json.dumps(action)))
            messages.append(ChatMessage("user", self._format_tool_feedback(action, result_ok, result_content)))
            if repeat_blocks >= 5:
                return "Stopped because repeated probes were blocked five times. Review trace and choose a different strategy."
        return final_summary or "Reached step limit. Review trace for the latest state."

    def _run_mapping_preflight(self, messages: list[ChatMessage]) -> str:
        messages.append(ChatMessage("user", f"MODE={self.settings.mode}: create a concise target map before any broad enumeration or exploitation."))
        skill_action = {
            "action": "use_skill",
            "name": "target_mapping",
            "objective": "Create a compact target map from the engagement scope and observed baseline responses",
            "context": self.settings.mode,
        }
        skill_result = self.tools.execute(skill_action)
        self._append_tool_feedback(messages, skill_action, skill_result)

        map_content = self._build_target_map_content()
        write_action = {
            "action": "write_file",
            "path": "target-map.md",
            "content": map_content,
        }
        write_result = self.tools.execute(write_action)
        self._append_tool_feedback(messages, write_action, write_result)

        payload = self._build_mapping_payload()
        mapping_path = self._persist_mapping_state(payload)
        self.trace.write("mapping_state_persisted", path=str(mapping_path))

        if write_result.ok:
            return "Mapping completed. Target map written to target-map.md and persisted to mapping-state.json."
        return "Mapping preflight attempted, but target-map.md could not be written."

    def _resolve_effective_mode(self) -> str:
        mode = (self.settings.mode or "auto").lower()
        if mode == "mapping":
            return "mapping"
        if mode in {"recon", "attack", "auto"}:
            mapping_state = self._load_mapping_state()
            if not mapping_state:
                return "mapping"
            if mode == "auto" and not self.engagement_recon.facts():
                return "recon"
            return mode
        return "mapping"

    def _should_run_mapping_preflight(self, effective_mode: str | None = None) -> bool:
        mode = (effective_mode or self._resolve_effective_mode()).lower()
        if mode == "mapping":
            return True
        if mode in {"recon", "attack"}:
            mapping_state = self._load_mapping_state()
            if mapping_state and mapping_state.get("targets"):
                return False
            return not bool(self.engagement_recon.facts())
        return False

    def _load_mapping_state(self) -> dict[str, object] | None:
        candidate_files = sorted(
            self.run_dir.parent.rglob("mapping-state.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for mapping_path in candidate_files:
            try:
                data = json.loads(mapping_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("targets"):
                return data
        return None

    def _build_mapping_context_prompt(self) -> str:
        mapping_state = self._load_mapping_state()
        if not mapping_state:
            return "No persisted mapping state was found. Build a fresh target map before broad enumeration."
        targets = mapping_state.get("targets", [])
        hosts = mapping_state.get("hosts", [])
        surfaces = mapping_state.get("surfaces", [])
        lines = [
            "Persisted mapping state from a prior run. Treat this as the current target map and prioritize these targets and surfaces.",
            f"Targets: {', '.join(str(target) for target in targets) if targets else '(none)'}",
            f"Hosts: {', '.join(str(host) for host in hosts) if hosts else '(none)'}",
        ]
        if surfaces:
            lines.append("Surfaces:")
            for surface in surfaces[:8]:
                host = surface.get("host", "")
                path_pattern = surface.get("path_pattern", "")
                surface_type = surface.get("surface_type", "")
                auth_context = surface.get("auth_context", "")
                lines.append(f"- {surface_type} {host}{path_pattern} auth={auth_context}")
        return "\n".join(lines)

    def _build_mode_guidance_prompt(self, effective_mode: str) -> str:
        lines = [
            f"Effective workflow mode: {effective_mode}",
            "If a surface is marked as auth-aware, inspect the authentication flow before broad exploration.",
            "Do not switch to exploitation until there is evidence from mapping or recon for the relevant surface.",
        ]
        if effective_mode == "mapping":
            lines.append("Mapping is the current safe phase; keep the scope narrow and write a compact target map.")
        elif effective_mode == "recon":
            lines.append("Recon is the current safe phase; enumerate one target or surface at a time with low rate.")
        else:
            lines.append("Attack is the current phase; only proceed when mapping or recon evidence is available for that surface.")
        return "\n".join(lines)

    def _build_phase_handoff_prompt(self, effective_mode: str) -> str:
        surfaces = self._merged_surfaces()
        auth_surfaces = [surface for surface in surfaces if surface.auth_context and surface.auth_context != "public"]
        if effective_mode != "attack":
            if not auth_surfaces:
                return "Continue with the current phase and prefer low-rate verification over noisy scans."
            lines = [
                "Continue with the current phase and prefer low-rate verification over noisy scans.",
                "Auth-relevant surfaces are already present, so do not finish before checking login, session, callback, reset, tenant, and account-flow behavior where applicable.",
            ]
            for surface in auth_surfaces[:5]:
                lines.append(f"- {surface.surface_type} {surface.host}{surface.path_pattern} auth={surface.auth_context}")
            return "\n".join(lines)
        lines = [
            "Reinforced recon-to-attack handoff.",
            "If mapping or recon has already identified an auth-sensitive, API, or tenant-scoped surface, move from generic recon to targeted verification and one focused follow-up check.",
            "Do not repeat broad crawling once there is clear evidence for a specific surface.",
        ]
        if auth_surfaces:
            lines.append("Current auth-aware surfaces:")
            for surface in auth_surfaces[:5]:
                lines.append(f"- {surface.surface_type} {surface.host}{surface.path_pattern} auth={surface.auth_context}")
        return "\n".join(lines)

    def _build_target_map_content(self) -> str:
        payload = self._build_mapping_payload()
        lines = [
            f"# Target map for {self.scope.program_name}",
            "",
            f"- Current target: {self.target}",
            f"- Session targets: {', '.join(self.completed_targets + self.pending_targets) or self.target}",
            f"- Program: {self.scope.program_name}",
            f"- Allowed domains: {', '.join(self.scope.allowed_domains) or '(none)'}",
            f"- Excluded domains: {', '.join(self.scope.excluded_domains) or '(none)'}",
            f"- Allowed URLs: {', '.join(self.scope.allowed_urls) or '(none)'}",
            f"- Notes: {self.scope.notes or '(none)'}",
            "",
            "## Baseline observations",
            "- Confirm target scope and access constraints before broad probing.",
            "- Capture robots.txt, sitemap.xml, API entry points, and auth-relevant surfaces when available.",
            "- Prefer low-rate, evidence-based follow-up.",
            "",
            "## Structured targets",
        ]
        for host in payload["hosts"]:
            lines.append(f"- Host: {host}")
        lines.extend(["", "## Structured surfaces"])
        for surface in payload["surfaces"]:
            lines.append(
                f"- {surface['surface_type']} {surface['host']}{surface['path_pattern']} auth={surface['auth_context']}"
            )
        return "\n".join(lines) + "\n"

    def _build_mapping_payload(self) -> dict[str, object]:
        surfaces = self._merged_surfaces()
        hosts = sorted({surface.host for surface in surfaces if surface.host and surface.host != "local"})
        for target in reversed(self.completed_targets + self.pending_targets):
            if target not in hosts:
                hosts = [target] + hosts
        payload = {
            "program_name": self.scope.program_name,
            "target": self.target,
            "targets": list(dict.fromkeys(self.completed_targets + self.pending_targets)),
            "hosts": hosts,
            "allowed_domains": self.scope.allowed_domains,
            "excluded_domains": self.scope.excluded_domains,
            "allowed_urls": self.scope.allowed_urls,
            "notes": self.scope.notes,
            "surfaces": [
                {
                    "host": surface.host,
                    "path_pattern": surface.path_pattern,
                    "surface_type": surface.surface_type,
                    "auth_context": surface.auth_context,
                    "tags": list(surface.tags),
                }
                for surface in surfaces
            ],
            "generated_at": datetime.now().isoformat(),
        }
        return payload

    def _persist_mapping_state(self, payload: dict[str, object]) -> Path:
        mapping_path = self.run_dir / "mapping-state.json"
        mapping_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return mapping_path

    def _persist_session_state(self, effective_mode: str, finished: bool = False) -> Path:
        payload = {
            "generated_at": datetime.now().isoformat(),
            "program_name": self.scope.program_name,
            "effective_mode": effective_mode,
            "current_target": self.target,
            "initial_targets": list(self.initial_targets),
            "completed_targets": list(self.completed_targets),
            "pending_targets": list(self.pending_targets),
            "known_targets": list(dict.fromkeys(self.completed_targets + self.pending_targets)),
            "target_outcomes": dict(self.target_outcomes),
            "artifacts": {
                "report": "report.md",
                "trace": "trace.jsonl",
                "mapping_state": "mapping-state.json",
                "potential_weaknesses": "potential-weaknesses.json",
                "workspace": "workspace",
            },
            "finished": finished,
        }
        path = self.run_dir / "session-state.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _refresh_session_queue(self) -> None:
        if not self.settings.queue_path:
            return
        queue = list(dict.fromkeys(self.pending_targets))
        self.settings.queue_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings.queue_path.write_text(json.dumps(queue, ensure_ascii=False, indent=2), encoding="utf-8")

    def _extend_pending_targets_from_recon(self) -> list[str]:
        discovered = self._collect_discovered_targets()
        known = set(self.completed_targets) | set(self.pending_targets)
        additions: list[str] = []
        for candidate in discovered:
            if candidate in known:
                continue
            additions.append(candidate)
            known.add(candidate)
            self.pending_targets.append(candidate)
            self.session_targets.append(candidate)
        return additions

    def _collect_discovered_targets(self) -> list[str]:
        candidates: list[str] = []
        for fact in self.run_recon.facts():
            if fact.kind == "host":
                normalized = self._normalize_discovered_target(fact.value)
                if normalized:
                    candidates.append(normalized)
                continue
            if fact.kind == "endpoint" and self._is_interesting_endpoint_fact(fact):
                normalized = self._normalize_discovered_target(fact.value)
                if normalized:
                    candidates.append(normalized)
        for surface in self._merged_surfaces():
            if self._is_interesting_surface(surface):
                normalized = self._normalize_discovered_target(surface.host)
                if normalized:
                    candidates.append(normalized)
            url = str((surface.meta or {}).get("url", "")).strip()
            if url and self._is_interesting_surface(surface):
                normalized = self._normalize_discovered_target(url)
                if normalized:
                    candidates.append(normalized)
        ordered: list[str] = []
        for candidate in candidates:
            if candidate not in ordered:
                ordered.append(candidate)
        return ordered

    def _normalize_discovered_target(self, value: str) -> str | None:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned == "local":
            return None
        if cleaned.startswith(("http://", "https://")):
            decision = self.scope_guard.validate_target(cleaned)
            return cleaned if decision.allowed else None
        if "/" in cleaned or "?" in cleaned:
            cleaned = f"https://{cleaned.lstrip('/')}"
            decision = self.scope_guard.validate_target(cleaned)
            return cleaned if decision.allowed else None
        decision = self.scope_guard.validate_target(cleaned)
        return cleaned if decision.allowed else None

    def _merged_surfaces(self) -> list[object]:
        merged: list[object] = []
        seen: set[tuple[str, str, str]] = set()
        for surface in [*self.engagement_recon.surfaces(), *self.run_recon.surfaces()]:
            fingerprint = (surface.surface_key, surface.surface_type, surface.auth_context)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            merged.append(surface)
        return merged

    def _is_interesting_endpoint_fact(self, fact: object) -> bool:
        tags = set(getattr(fact, "tags", ()) or ())
        if tags & {"api", "graphql", "auth", "upload", "redirect", "js", "version"}:
            return True
        path_pattern = str((getattr(fact, "meta", {}) or {}).get("path_pattern", "")).lower()
        return bool(re.search(r"(api|graphql|swagger|openapi|auth|login|oauth|upload|callback|redirect|reset|admin|internal|debug|\.js\b)", path_pattern))

    def _is_interesting_surface(self, surface: object) -> bool:
        surface_type = str(getattr(surface, "surface_type", "")).lower()
        if surface_type in {"api", "graphql", "js", "auth", "upload", "redirect", "version"}:
            return True
        tags = set(getattr(surface, "tags", ()) or ())
        return bool(tags & {"parameter", "js", "schema", "auth"})

    def _persist_potential_weaknesses(self) -> Path:
        attack_results = self.run_recon.attack_results()
        weaknesses = []
        seen: set[tuple[str, str, str]] = set()
        for result in attack_results:
            if result.outcome not in {"interesting", "confirmed"}:
                continue
            fingerprint = (result.surface_key, result.attack_type, result.auth_context)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            weaknesses.append(
                {
                    "surface": result.surface_key,
                    "attack_type": result.attack_type,
                    "auth_context": result.auth_context,
                    "outcome": result.outcome,
                    "evidence": result.evidence,
                    "tags": list(result.tags),
                    "meta": result.meta or {},
                }
            )
        chained = []
        auth_surfaces = [item for item in weaknesses if item["attack_type"] in {"auth", "graphql", "api"}]
        js_surfaces = [item for item in weaknesses if item["attack_type"] in {"js_analysis", "sourcemap"}]
        if auth_surfaces and js_surfaces:
            for auth_item in auth_surfaces[:4]:
                for js_item in js_surfaces[:4]:
                    chained.append(
                        {
                            "kind": "candidate_chain",
                            "from": js_item["surface"],
                            "to": auth_item["surface"],
                            "reason": "JS/API evidence may inform an authenticated follow-up path or operation name.",
                        }
                    )
        payload = {
            "generated_at": datetime.now().isoformat(),
            "session_targets": list(self.session_targets),
            "potential_weaknesses": weaknesses,
            "candidate_chains": chained,
        }
        path = self.run_dir / "potential-weaknesses.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _append_tool_feedback(self, messages: list[ChatMessage], action: dict[str, object], result: object) -> None:
        messages.append(ChatMessage("assistant", json.dumps(action)))
        messages.append(ChatMessage("user", self._format_tool_feedback(action, getattr(result, "ok", False), getattr(result, "content", ""))))

    def _build_progress_hint(
        self,
        step: int,
        action_counts: dict[str, int],
        repeat_blocks: int,
    ) -> list[ChatMessage]:
        if step == 0:
            return []
        hints: list[str] = []
        if repeat_blocks:
            hints.append(
                f"{repeat_blocks} repeated probes have been blocked. You must switch strategy instead of retrying."
            )
        if step >= 2 and action_counts.get("use_skill", 0) == 0:
            hints.append(
                "Use a playbook before choosing more probes. Call use_skill with one of: public_research, "
                "surface_discovery, fingerprint, scanner_triage, verification_script, finding_triage."
            )
        if step >= 8 and action_counts.get("search", 0) == 0:
            hints.append(
                "You have not used the search action yet. Search public references for the target technology, endpoint names, CWE, CVE, GitHub issues, Snyk advisories, CVE details, Medium writeups, or Stack Overflow clues."
            )
        if step >= 12 and action_counts.get("write_file", 0) == 0:
            hints.append(
                "You have not written a verification script yet. If manual curl probes are repeating, write a small Python script in the workspace and run it once."
            )
        if step and step % 10 == 0:
            hints.append(
                "Progress checkpoint: summarize what is already known, avoid duplicate findings, and move to a new phase: research, endpoint discovery, scripted verification, or final report."
            )
        if step >= 3:
            hints.append(
                "Prefer JS-heavy and API-heavy follow-up when such surfaces exist: inspect bundles for endpoints, source maps, GraphQL operations, and parameterized API routes before repeating generic curl checks."
            )
        if not hints:
            return []
        return [ChatMessage("system", "\n".join(hints))]

    def _build_coverage_memory_prompt(self) -> str:
        run_summary = self.run_recon.coverage_summary()
        engagement_summary = self.engagement_recon.coverage_summary()
        lines = [
            "Structured coverage memory. Use this to avoid retesting what is already covered and to prefer unresolved JS/API surfaces.",
            f"Current run: {run_summary['surface_count']} surfaces, {run_summary['attack_count']} attack results, {run_summary['tested_combinations']} tested combinations.",
            f"Engagement memory: {engagement_summary['surface_count']} surfaces, {engagement_summary['attack_count']} attack results.",
        ]
        auth_open = [task for task in run_summary.get("next_tasks", []) if task.get("surface_type") == "auth"][:3]
        if auth_open:
            lines.append("Unresolved auth-focused tasks in this run:")
            for task in auth_open:
                lines.append(
                    f"- {task['surface']} -> {task['attack_type']} ({task['reason']})"
                )
        tasks = engagement_summary.get("next_tasks", [])[:4]
        if tasks:
            lines.append("Prominent unresolved tasks from engagement memory:")
            for task in tasks:
                lines.append(
                    f"- {task['surface_type']} {task['surface']} -> {task['attack_type']} ({task['reason']})"
                )
        return "\n".join(lines)

    def _build_coverage_brief(self, step: int) -> list[ChatMessage]:
        if step == 0:
            return []
        tasks = self.run_recon.coverage_summary().get("next_tasks", [])[:4]
        if not tasks:
            return []
        lines = ["Current untested high-value coverage targets:"]
        for task in tasks:
            lines.append(
                f"- {task['surface_type']} {task['surface']} auth={task['auth_context']} next={task['attack_type']} ({task['reason']})"
            )
        return [ChatMessage("system", "\n".join(lines))]

    def _surface_coverage_gaps(self) -> list[str]:
        summary = self.run_recon.coverage_summary()
        tasks = summary.get("next_tasks", [])
        if not tasks:
            return []
        high_value = [task for task in tasks if task.get("surface_type") in {"api", "graphql", "js", "upload", "auth"}]
        if not high_value:
            return []
        return [
            f"{task['surface']} lacks {task['attack_type']} coverage"
            for task in high_value[:5]
        ]

    def _attack_family_gaps(self) -> list[str]:
        surfaces = self.run_recon.surfaces()
        attacks = self.run_recon.attack_results()
        tested = {(item.surface_key, item.attack_type, item.auth_context) for item in attacks}
        gaps: list[str] = []
        for surface in surfaces:
            required = self._required_attack_families_for_surface(surface)
            if not required:
                continue
            missing = [attack_type for attack_type in required if (surface.surface_key, attack_type, surface.auth_context) not in tested]
            if missing:
                gaps.append(f"{surface.surface_key} missing {', '.join(missing[:3])}")
            if len(gaps) >= 6:
                break
        return gaps

    def _required_attack_families_for_surface(self, surface: object) -> list[str]:
        surface_type = str(getattr(surface, "surface_type", "")).lower()
        tags = set(getattr(surface, "tags", ()) or ())
        required: list[str] = []
        if surface_type == "js":
            required.extend(["js_analysis", "sourcemap"])
        elif surface_type == "graphql":
            required.extend(["graphql", "auth"])
        elif surface_type == "api":
            required.extend(["api", "parameter"])
            if "parameter" in tags:
                required.append("sqli")
        elif surface_type == "redirect":
            required.extend(["redirect", "ssrf"])
        elif surface_type == "auth":
            required.extend(["auth", "session"])
        elif surface_type == "upload":
            required.extend(["upload", "content_type"])
        elif surface_type == "web" and "parameter" in tags:
            required.extend(["xss", "sqli"])
        elif surface_type == "web":
            required.append("xss")
        return list(dict.fromkeys(required))

    def _format_tool_feedback(self, action: dict[str, object], ok: bool, content: str) -> str:
        excerpt = content[:2500]
        if len(content) > len(excerpt):
            excerpt += f"\n...[truncated {len(content) - len(excerpt)} chars]"
        return (
            f"Tool result: action={action.get('action')} ok={ok} content_length={len(content)}\n"
            f"{excerpt}\n"
            "Use the actual response above. Do not treat content_length alone as evidence."
        )

    def _build_retrieval_context(self, messages: list[ChatMessage], step: int) -> list[ChatMessage]:
        if not self.retrieval:
            return []
        query = self._derive_retrieval_query(messages)
        if not query:
            return []
        hits = self.retrieval.search(query, top_k=5)
        if not hits:
            return []
        lines: list[str] = ["Relevant prior tool outputs:"]
        for hit in hits:
            lines.append(f"Step {hit.step}: action={json.dumps(hit.action)}")
            lines.append(hit.content)
            lines.append("---")
        return [ChatMessage("system", "\n".join(lines))]

    def _derive_retrieval_query(self, messages: list[ChatMessage]) -> str:
        last_user = next((msg.content for msg in reversed(messages) if msg.role == "user"), "")
        last_assistant = next((msg.content for msg in reversed(messages) if msg.role == "assistant"), "")
        query = " ".join([last_user.strip(), last_assistant.strip()]).strip()
        return query[:1400]

    def _build_llm(self) -> LLMClient:
        if not self.settings.model:
            return NullLLMClient()
        return OpenAICompatibleClient(
            base_url=self.settings.llm_base_url,
            api_key=self.settings.llm_api_key,
            model=self.settings.model,
            timeout_seconds=self.settings.llm_timeout_seconds,
        )

    def _build_retrieval_store(self) -> RetrievalStore | NullRetrievalStore:
        retrieval_dir = Path(tempfile.gettempdir()) / "bounty-agent-rag"
        retrieval_path = retrieval_dir / f"{self.run_dir.name}.db"
        try:
            store = RetrievalStore(retrieval_path)
            self.trace.write("retrieval_enabled", path=str(retrieval_path))
            return store
        except Exception as exc:
            self.trace.write("retrieval_disabled", error=f"{type(exc).__name__}: {exc}")
            return NullRetrievalStore()

    def _build_run_recon_store(self) -> ReconStore | NullReconStore:
        try:
            store = ReconStore(self.run_dir / "recon.db")
            self.trace.write("run_recon_enabled", path=str(store.path))
            return store
        except Exception as exc:
            self.trace.write("run_recon_disabled", error=f"{type(exc).__name__}: {exc}")
            return NullReconStore()

    def _build_engagement_recon_store(self) -> ReconStore | NullReconStore:
        try:
            store = ReconStore(self._engagement_db_path())
            self.trace.write("engagement_recon_enabled", path=str(store.path))
            return store
        except Exception as exc:
            self.trace.write("engagement_recon_disabled", error=f"{type(exc).__name__}: {exc}")
            return NullReconStore()

    def _engagement_db_path(self) -> Path:
        return self.settings.engagement_db_path or self.run_dir.parent / "knowledge.db"

    def _promote_run_memory(self) -> int:
        if isinstance(self.run_recon, NullReconStore) or isinstance(self.engagement_recon, NullReconStore):
            return 0
        return promote_run_facts(self.run_recon, self.engagement_recon, self.run_dir.name)

    def _build_engagement_memory_prompt(self) -> str:
        facts = self.engagement_recon.facts()[:40]
        if not facts:
            return "Curated engagement memory: none yet."
        lines = ["Curated engagement memory from previous runs. Treat it as useful context, not proof by itself:"]
        for fact in facts:
            tags = ",".join(fact.tags) if fact.tags else "-"
            lines.append(
                f"- {fact.kind} {fact.key}: {fact.value} confidence={fact.confidence} status={fact.status} tags={tags}"
            )
        return "\n".join(lines)

    def _build_runner(self) -> LocalWorkspaceRunner:
        if self.settings.runner == "docker":
            return DockerSandboxRunner(self.workspace, self.settings.docker_image, self.settings.docker_env_file)
        return LocalWorkspaceRunner(self.workspace)


def parse_json_action(text: str) -> dict[str, object] | None:
    text = text.strip()
    if not text:
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        value = None
        for index, char in enumerate(text):
            if char != "{":
                continue
            try:
                candidate, _ = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                value = candidate
                break
    if not isinstance(value, dict):
        return None
    action_name = str(value.get("action", "")).strip()
    return value if action_name else None


def _summary_claims_findings(summary: str) -> bool:
    normalized = re.sub(r"\s+", " ", summary.strip().lower())
    if re.search(r"\b(no|zero|0|without)\s+(validated\s+)?(findings?|vulnerabilit(?:y|ies))\b", normalized):
        return False
    return bool(
        re.search(
            r"\b(identified|found|confirmed|recorded|discovered)\b.{0,40}\b(findings?|vulnerabilit(?:y|ies))\b",
            normalized,
        )
    )


def _recon_coverage_gaps(
    history: list[tuple[dict[str, object], object]],
    scope_guard: ScopeGuard,
) -> list[str]:
    search_queries: list[str] = []
    commands: list[str] = []
    written_files: set[str] = set()
    executed_python = False
    hosts: set[str] = set()
    for action, result in history:
        if not getattr(result, "ok", False):
            continue
        action_name = str(action.get("action", ""))
        if action_name == "search":
            search_queries.append(str(action.get("query", "")).lower())
        elif action_name == "write_file":
            written_files.add(str(action.get("path", "")))
        elif action_name == "bash":
            command = str(action.get("command", "")).lower()
            commands.append(command)
            if re.search(r"\bpython3?\b", command):
                executed_python = True
            for host in scope_guard._extract_hosts(command):
                hosts.add(host.lower())

    research_sources = {
        "github": any("github.com" in query for query in search_queries),
        "medium": any("medium.com" in query for query in search_queries),
        "stackoverflow": any("stackoverflow.com" in query or "stack overflow" in query for query in search_queries),
        "cve": any("cvedetails.com" in query or "cve" in query for query in search_queries),
        "snyk": any("snyk.io" in query or "snyk" in query for query in search_queries),
    }
    command_text = "\n".join(commands)
    gaps: list[str] = []
    if len(set(search_queries)) < 4 or sum(research_sources.values()) < 3:
        gaps.append("run at least four distinct public searches covering at least three research sources")
    if not re.search(r"\b(katana|subfinder|waybackurls|gau|assetfinder|amass|ffuf|gobuster|dirsearch)\b", command_text):
        gaps.append("use a discovery tool such as katana, subfinder, waybackurls, ffuf, gobuster, or dirsearch")
    if not re.search(r"\b(httpx|wafw00f|whatweb)\b", command_text):
        gaps.append("use a fingerprinting tool such as httpx or wafw00f")
    if not re.search(r"\b(nuclei|nikto|xsstrike|sqlmap)\b", command_text):
        gaps.append("run one focused low-rate scanner such as nuclei, nikto, XSStrike, or SQLMap")
    if len(hosts) < 3:
        gaps.append("touch at least three distinct in-scope hosts or application surfaces")
    if not written_files or not executed_python:
        gaps.append("write and execute one small Python verification script")
    return gaps


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")[:80] or "target"
