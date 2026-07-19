from __future__ import annotations

from datetime import datetime
import hashlib
import json
import re
import tempfile
from pathlib import Path

from .config import AgentSettings, ProgramScope
from .llm import ChatMessage, LLMClient, NullLLMClient, OpenAICompatibleClient
from .prompts import build_system_prompt, deterministic_recon_plan
from .report import write_engagement_report, write_report
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
        self.session_step_count = 0
        self.priority_targets = self._load_priority_targets()
        self.run_dir = settings.session_run_dir or (runs_dir / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{_slug(target)}")
        self.workspace = self.run_dir / "workspace"
        self.trace = TraceLogger(self.run_dir / "trace.jsonl")
        self.retrieval = self._build_retrieval_store()
        self.run_recon = self._build_run_recon_store()
        self.engagement_recon = self._build_engagement_recon_store()
        # create ScopeGuard with per-run dynamic allowlist and optional allow-all
        dynamic_file = self.workspace / "allowed_hosts.txt"
        self.scope_guard = ScopeGuard(scope, dynamic_allow_file=dynamic_file, allow_all=self.settings.allow_all_hosts)
        self.session_targets = self._sanitize_target_list(self.session_targets)
        self.initial_targets = self._sanitize_target_list(self.initial_targets)
        self.pending_targets = self._sanitize_target_list(self.pending_targets)
        self.priority_targets = self._sanitize_target_list(self.priority_targets)
        self.pending_targets = self._prioritize_targets(self.pending_targets)
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
            allow_search=settings.mode == "assistant",
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
        self._stage_auth_context()
        self._refresh_session_queue()
        self._persist_session_state(effective_mode)

        while self.pending_targets:
            if self.session_step_count >= self.settings.max_steps:
                self.trace.write("session_step_budget_exhausted", used=self.session_step_count, limit=self.settings.max_steps)
                break
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
                ChatMessage("system", self._build_auth_context_prompt()),
                ChatMessage("system", self._build_priority_targets_prompt()),
                ChatMessage("system", self._build_research_focus_prompt()),
                ChatMessage("system", self._build_cluster_prompt()),
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
            # Automated startup pipeline: run discovery tools on the target
            if not self.settings.dry_run and self.settings.model:
                startup_actions = [
                    {"action": "bash", "command": f"waybackurls {current_target} 2>/dev/null | head -50 | httpx -silent -status-code -title -tech-detect -rate-limit 10 2>/dev/null {self.workspace}/startup_endpoints.txt", "timeout_seconds": 60},
                    {"action": "bash", "command": f"katana -u {current_target} -c 1 -rate-limit 5 -silent 2>/dev/null | head -50 | httpx -silent -status-code -title -tech-detect -rate-limit 10 2>/dev/null -a {self.workspace}/startup_endpoints.txt", "timeout_seconds": 60},
                ]
                for sa in startup_actions:
                    sa_result = self.tools.execute(sa)
                    self.retrieval.add(index, sa, sa_result.content, {"type": "bash", "phase": "startup_pipeline", "target": current_target})
                    messages.append(ChatMessage("user", self._format_tool_feedback(sa, sa_result.ok, sa_result.content)))

            # Phase 0: Subdomain discovery before LLM loop
            if not self.settings.dry_run and self.settings.model:
                discovery_actions = [
                    {"action": "bash", "command": f"subfinder -d {current_target} -silent 2>/dev/null | head -100", "timeout_seconds": 60},
                    {"action": "bash", "command": f"subfinder -d {current_target} -silent 2>/dev/null | head -100 | httpx -silent -status-code -title -tech-detect -rate-limit 10 2>/dev/null", "timeout_seconds": 60},
                ]
                for da in discovery_actions:
                    da_result = self.tools.execute(da)
                    self.retrieval.add(index, da, da_result.content, {"type": "bash", "phase": "discovery", "target": current_target})
                    messages.append(ChatMessage("user", self._format_tool_feedback(da, da_result.ok, da_result.content)))

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
        self._write_operator_artifacts()
        promoted = self._promote_run_memory()
        self.trace.write("recon_promoted", count=promoted, engagement_db=str(self._engagement_db_path()))
        self._write_engagement_asset_catalog()
        self._write_engagement_report()
        self.trace.write("finish", report=str(self.run_dir / "report.md"))
        self._persist_session_state(effective_mode, finished=True)
        return self.run_dir

    def _run_llm_loop(self, messages: list[ChatMessage]) -> str:
        final_summary = ""
        invalid_json_count = 0
        repeat_blocks = 0
        finish_rejections = 0
        action_counts: dict[str, int] = {}
        local_step = 0
        consecutive_timeouts = 0
        # Write the early-stop control file on first entry
        self._write_stop_control_file(0)
        while self.session_step_count < self.settings.max_steps:
            step = self.session_step_count

            # Check for early-stop signal at configured interval
            check_interval = max(1, self.settings.early_stop_check_interval)
            if step > 0 and step % check_interval == 0:
                self._write_stop_control_file(step)
                stop_reason = self._check_stop_signal()
                if stop_reason:
                    self.trace.write("early_stop_requested", reason=stop_reason, step=step)
                    return self._handle_early_stop(messages)

            try:
                memory_snippet = self._build_retrieval_context(messages, step)
                coverage_snippet = self._build_coverage_brief(step)
                surface_memory = self._build_surface_memory_prompt()
                progress_hint = self._build_progress_hint(step, action_counts, repeat_blocks)
                all_hints = memory_snippet + coverage_snippet + surface_memory + progress_hint
                response = self.llm.complete(self._prepare_llm_messages(messages, all_hints, [], []))
                consecutive_timeouts = 0  # reset on success
            except Exception as exc:
                consecutive_timeouts += 1
                message = f"LLM call failed: {type(exc).__name__}: {exc}"
                self.trace.write("model_error", step=step, error=message)
                # Auto-reduce timeout after consecutive failures
                if consecutive_timeouts >= 3:
                    return f"LLM repeatedly failed after {consecutive_timeouts} consecutive attempts. Last error: {message}"
                # Let the outer loop retry with the next target
                return message
            self.trace.write("model_response", step=step, content=response)
            action = parse_json_action(response)
            if not action:
                invalid_json_count += 1
                if invalid_json_count >= self.settings.max_malformed_responses:
                    message = f"Stopped after {self.settings.max_malformed_responses} malformed or empty model responses."
                    self.trace.write("model_error", step=step, error=message)
                    return message
                # Tell the LLM exactly what was wrong with its response
                error_detail = ""
                try:
                    parsed = json.loads(response)
                    if isinstance(parsed, dict):
                        keys = list(parsed.keys())
                        if "role" in keys or "content" in keys:
                            error_detail = " Your response has role/content fields but needs action/command fields."
                        elif "name" in keys and "arguments" in keys:
                            error_detail = " Your response has name/arguments fields but needs action/command fields."
                        elif "tool" in keys:
                            error_detail = " Your response has a tool field but needs action/command fields."
                        else:
                            error_detail = f" Your response has keys {keys} but needs action/command fields."
                except Exception:
                    error_detail = " Your response is not valid JSON."
                messages.append(
                    ChatMessage(
                        "user",
                        (
                            f"FORMAT ERROR.{error_detail} Reply with one JSON object only. No explanation or markdown. "
                            'Example: {"action":"finish","summary":"Unable to continue safely."} '
                            f"Malformed response budget remaining: {self.settings.max_malformed_responses - invalid_json_count}."
                        ),
                    )
                )
                continue
            invalid_json_count = 0
            self.session_step_count += 1
            local_step += 1
            if action.get("action") == "finish":
                proposed_summary = str(action.get("summary", "Finished."))
                gaps = _recon_coverage_gaps(self.tools.history, self.scope_guard, self.run_recon.coverage_summary())
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
                        return f"Deferred current target after repeated premature finish attempts. {rejected_reason}"
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
            # Summarize old messages every 50 steps to prevent context bloat
            if len(messages) > 100 and local_step % 50 == 0:
                # Keep first 4 system messages + last 50 tool results
                kept = messages[:4] + messages[-(50):]
                summary = f"[SYSTEM MESSAGE] Step {step}: Messages condensed from {len(messages)} to {len(kept)}. Old tool results have been removed from context. key findings are stored in recon DB."
                messages = kept + [ChatMessage("user", summary)]
            if repeat_blocks >= 5:
                return "Deferred current target because repeated probes were blocked five times. Review trace and choose a different strategy."
        if self.session_step_count >= self.settings.max_steps:
            return final_summary or f"Reached session step limit after {local_step} steps on this target. Preserve current evidence and continue from queue next run."
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
        if mode == "assistant":
            return "assistant"
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
            f"Targets: {_summarize_items([str(target) for target in targets], 6)}",
            f"Hosts: {_summarize_items([str(host) for host in hosts], 8)}",
        ]
        if surfaces:
            lines.append("Surfaces:")
            for surface in surfaces[:5]:
                host = surface.get("host", "")
                path_pattern = surface.get("path_pattern", "")
                surface_type = surface.get("surface_type", "")
                auth_context = surface.get("auth_context", "")
                lines.append(f"- {surface_type} {host}{path_pattern} auth={auth_context}")
        return "\n".join(lines)

    def _build_priority_targets_prompt(self) -> str:
        if not self.priority_targets:
            return "No operator priority deep-test list is supplied for this run."
        lines = [
            "Operator priority deep-test list is active. These targets or endpoints deserve deeper recon and attack attention before broad low-value queue churn:",
        ]
        for item in self.priority_targets[:8]:
            lines.append(f"- {item}")
        return "\n".join(lines)

    def _build_research_focus_prompt(self) -> str:
        if self.settings.mode != "assistant":
            return "Internet research is disabled in autonomous modes. Derive decisions only from observed target evidence and installed tools."
        surfaces = self._merged_surfaces()
        surface_types = sorted({surface.surface_type for surface in surfaces if getattr(surface, "surface_type", "")})
        hosts = sorted({surface.host for surface in surfaces if getattr(surface, "host", "") and surface.host != "local"})
        keywords: list[str] = []
        if "graphql" in surface_types:
            keywords.extend(["graphql authz", "graphql introspection", "graphql idor", "apollo"])
        if "api" in surface_types:
            keywords.extend(["api authorization", "idor", "openapi", "swagger"])
        if "js" in surface_types:
            keywords.extend(["javascript source map", "sdk key exposure", "bundle endpoint extraction"])
        if "auth" in surface_types:
            keywords.extend(["sso", "oauth", "session fixation", "tenant switching"])
        if any("docs" in host for host in hosts):
            keywords.extend(["sdk", "docs generator", "fern", "code snippets", "sample token"])
        if not keywords:
            return "Assistant research focus: use one focused, user-visible query and return cited sources for operator selection."
        return (
            "Assistant research focus: build one focused query from observed technologies and bug classes, then return cited sources for operator selection. "
            f"Current promising terms: {', '.join(dict.fromkeys(keywords))}."
        )

    def _build_cluster_prompt(self) -> str:
        clusters = self._target_clusters(self.pending_targets + self.completed_targets)
        lines = [
            "Campaign cluster view:",
            f"- Current cluster: {self._classify_target_cluster(self.target)}",
            f"- Known clusters: {', '.join(f'{name}={count}' for name, count in sorted(clusters.items())) or '(none)'}",
        ]
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
        elif effective_mode == "assistant":
            lines.append("Assistant mode is operator-led. Use search only when asked, return numbered cited sources, and wait for the operator before opening or acting on a result.")
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

    def _build_auth_context_prompt(self) -> str:
        staged = self.workspace / "auth-context.txt"
        if not staged.exists():
            return "Authenticated context: none supplied. If auth-only surfaces are discovered, keep notes for a future authenticated run."
        try:
            content = staged.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return "Authenticated context file exists but could not be read."
        if not content:
            return "Authenticated context file is empty."
        preview = content[:1200]
        lines = [
            "Authenticated context is available in workspace file `auth-context.txt`.",
            "Use it carefully for authenticated checks, compare unauthenticated and authenticated behavior, and avoid treating normal logged-in access as a finding.",
            "Auth context preview:",
            preview,
        ]
        if len(content) > len(preview):
            lines.append(f"...truncated {len(content) - len(preview)} chars")
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
            "priority_targets": list(self.priority_targets),
            "known_targets": list(dict.fromkeys(self.completed_targets + self.pending_targets)),
            "target_outcomes": dict(self.target_outcomes),
            "session_step_limit": self.settings.max_steps,
            "session_steps_used": self.session_step_count,
            "session_steps_remaining": max(0, self.settings.max_steps - self.session_step_count),
            "artifacts": {
                "report": "report.md",
                "trace": "trace.jsonl",
                "mapping_state": "mapping-state.json",
                "potential_weaknesses": "potential-weaknesses.json",
                "validation_queue": "validation-queue.json",
                "workspace": "workspace",
                "auth_context": "workspace/auth-context.txt" if (self.workspace / "auth-context.txt").exists() else None,
                "engagement_report": str(self._engagement_db_path().with_name("engagement-report.md")),
                "surface_graph": "surface-graph.json",
                "hypotheses": "hypotheses.json",
                "interesting_leads": "interesting-leads.md",
                "auth_surfaces": "auth-surfaces.md",
                "priority_followups": "priority-followups.md",
                "surface_memory": "surface-memory.json",
                "engagement_assets": str(self._engagement_db_path().parent / "assets"),
            },
            "finished": finished,
        }
        path = self.run_dir / "session-state.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _stage_auth_context(self) -> Path | None:
        source = self.settings.auth_context_path
        if not source or not source.exists():
            return None
        target = self.workspace / "auth-context.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_text(encoding="utf-8", errors="replace")
        target.write_text(content, encoding="utf-8")
        self.trace.write("auth_context_staged", source=str(source), target=str(target), bytes=len(content))
        return target

    # ── Early-stop control signal ────────────────────────────────────────

    STOP_SIGNAL_FILE = "stop_signal.json"

    def _write_stop_control_file(self, step: int) -> None:
        """Write a JSON control file that the operator can edit to signal early stop."""
        try:
            path = self.workspace / self.STOP_SIGNAL_FILE
            existing = {}
            if path.exists():
                try:
                    existing = json.loads(path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    pass
            payload = {
                "allow_stop": existing.get("allow_stop", False),
                "current_step": step,
                "instructions": 'Set "allow_stop" to true to gracefully stop the agent on the next checkpoint step. Changes saved here will be picked up automatically.',
                "last_updated": datetime.now().isoformat(),
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass  # Best-effort, never block the agent for this

    def _check_stop_signal(self) -> str | None:
        """Check if the operator set allow_stop=true in the control file."""
        try:
            path = self.workspace / self.STOP_SIGNAL_FILE
            if not path.exists():
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("allow_stop", False) is True:
                # Reset to false immediately to prevent re-triggering
                data["allow_stop"] = False
                data["instructions"] = "Stop acknowledged. Edit 'allow_stop' to true again if you need to re-stop."
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                return "Operator requested early stop via stop_signal.json"
            return None
        except Exception:
            return None

    def _handle_early_stop(self, messages: list[ChatMessage]) -> str:
        """Generate a summary and allow finish without coverage checks."""
        findings_count = len(self.tools.findings)
        surfaces_count = len(self._merged_surfaces())
        targets_count = len(self.completed_targets)
        facts_count = len(self.run_recon.facts())
        lines = [
            f"Early stop at step {self.session_step_count} with {surfaces_count} surfaces, {targets_count} targets completed, {findings_count} findings, {facts_count} recon facts.",
            "Allow finish with current evidence due to operator stop signal.",
        ]
        if findings_count == 0:
            lines.append("No validated findings yet. Review trace and operator artifacts for potential weaknesses.")
        summary = " | ".join(lines)
        self.trace.write("early_stop", summary=summary)
        # Signal the rest of the loop to finish without coverage checks
        return summary

    # ── Surface memory reuse prompt ───────────────────────────────────────

    def _build_surface_memory_prompt(self) -> list[ChatMessage]:
        """Build a prompt showing what's already been discovered so the LLM doesn't repeat work."""
        surfaces = self._merged_surfaces()
        if not surfaces:
            return []
        # Group by cluster for concise display
        clusters: dict[str, list[str]] = {}
        for surface in surfaces[:30]:
            cluster = self._classify_target_cluster(surface.surface_key)
            clusters.setdefault(cluster, []).append(surface.surface_key)
        lines = ["Previously discovered surfaces (avoid re-testing these):"]
        for cluster, items in sorted(clusters.items()):
            sample = items[:5]
            label = ", ".join(sample)
            if len(items) > len(sample):
                label += f" ...(+{len(items) - len(sample)} more {cluster} surfaces)"
            lines.append(f"  [{cluster}] {label}")
        return [ChatMessage("system", "\n".join(lines))]

    def _refresh_session_queue(self) -> None:
        if not self.settings.queue_path:
            return
        queue = list(dict.fromkeys(self.pending_targets))
        queue = self._prioritize_targets(queue)
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
        self.pending_targets = self._prioritize_targets(self.pending_targets)
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
            cleaned = self._sanitize_discovered_url(cleaned)
            if not cleaned:
                return None
            decision = self.scope_guard.validate_target(cleaned)
            return cleaned if decision.allowed else None
        if "/" in cleaned or "?" in cleaned:
            cleaned = f"https://{cleaned.lstrip('/')}"
            cleaned = self._sanitize_discovered_url(cleaned)
            if not cleaned:
                return None
            decision = self.scope_guard.validate_target(cleaned)
            return cleaned if decision.allowed else None
        if any(marker in cleaned for marker in ("*", "FUZZ", "robots.txt", "sitemap.xml")):
            return None
        decision = self.scope_guard.validate_target(cleaned)
        return cleaned if decision.allowed else None

    def _sanitize_discovered_url(self, value: str) -> str | None:
        cleaned = value.strip()
        if any(marker in cleaned for marker in ("*", "FUZZ")):
            return None
        cleaned = re.sub(r"/(?:robots\.txt|sitemap\.xml)(?:/|$)", "/", cleaned, flags=re.I)
        # Fix malformed URLs like "http:/example.com" (single colon) but preserve valid "://"
        cleaned = re.sub(r":/(?!/)", "://", cleaned)  # Fix "http:/example.com" -> "http://example.com"
        cleaned = cleaned.rstrip("/")
        if cleaned.endswith(("robots.txt", "sitemap.xml")):
            return None
        return cleaned

    def _sanitize_target_list(self, targets: list[str]) -> list[str]:
        sanitized: list[str] = []
        for item in targets:
            cleaned = str(item or "").strip()
            if not cleaned:
                continue
            if cleaned.startswith(("http://", "https://")):
                cleaned = self._sanitize_discovered_url(cleaned) or ""
            elif any(marker in cleaned for marker in ("*", "FUZZ", "robots.txt", "sitemap.xml")):
                cleaned = ""
            if cleaned and cleaned not in sanitized:
                sanitized.append(cleaned)
        return sanitized

    def _classify_target_cluster(self, target: str) -> str:
        lowered = target.lower()
        if "docs." in lowered or "/docs" in lowered or "sdk" in lowered:
            return "docs_sdk"
        if "graphql" in lowered:
            return "graphql"
        if any(term in lowered for term in ("/api/", "api.", "swagger", "openapi")):
            return "api"
        if any(term in lowered for term in ("login", "oauth", "sso", "auth", "session")):
            return "auth"
        if any(term in lowered for term in (".js", "bundle", "static", "assets")):
            return "js"
        return "web"

    def _target_clusters(self, targets: list[str]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for item in targets:
            cluster = self._classify_target_cluster(item)
            counts[cluster] = counts.get(cluster, 0) + 1
        return counts

    def _load_priority_targets(self) -> list[str]:
        path = self.settings.priority_targets_path
        if not path or not path.exists():
            return []
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            return []
        items: list[str] = []
        for line in raw.splitlines():
            cleaned = line.strip()
            if not cleaned or cleaned.startswith("#"):
                continue
            items.append(cleaned)
        return items

    def _prioritize_targets(self, targets: list[str]) -> list[str]:
        if not self.priority_targets:
            return self._cluster_sort_targets(list(dict.fromkeys(targets)))
        priority_prefixes = tuple(self.priority_targets)
        ordered = list(dict.fromkeys(targets))
        high = [item for item in ordered if item in self.priority_targets or item.startswith(priority_prefixes)]
        normal = [item for item in ordered if item not in high]
        return self._cluster_sort_targets(high) + self._cluster_sort_targets(normal)

    def _cluster_sort_targets(self, targets: list[str]) -> list[str]:
        weights = {"docs_sdk": 0, "graphql": 1, "api": 2, "auth": 3, "js": 4, "web": 5}
        return sorted(targets, key=lambda item: (weights.get(self._classify_target_cluster(item), 99), item))

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
                "Use a playbook before choosing more probes. Call use_skill with one of: "
                "surface_discovery, fingerprint, scanner_triage, verification_script, finding_triage."
            )
        if step >= 8 and self.settings.mode == "assistant" and action_counts.get("search", 0) == 0:
            hints.append(
                "Assistant research is available only on an explicit operator request. Return concise cited sources and wait for the operator to select one."
            )
        if step >= 12 and action_counts.get("write_file", 0) == 0:
            hints.append(
                "You have not written a verification script yet. If manual curl probes are repeating, write a small Python script in the workspace and run it once."
            )
        remaining_steps = max(0, self.settings.max_steps - self.session_step_count)
        if remaining_steps <= 12:
            hints.append(
                f"Session step budget is running low ({remaining_steps} steps remaining). Focus on the current target, preserve complete artifacts, and finish with a concise high-signal summary rather than opening broad new branches."
            )
        if step and step % 10 == 0:
            hints.append(
                "Progress checkpoint: summarize what is already known, avoid duplicate findings, and move to endpoint discovery, scripted verification, validation, or final report."
            )
        if step >= 3:
            hints.append(
                "Prefer JS-heavy and API-heavy follow-up when such surfaces exist: inspect bundles for endpoints, source maps, GraphQL operations, and parameterized API routes before repeating generic curl checks."
            )
        if any(surface.surface_type == "auth" for surface in self._merged_surfaces()):
            hints.append(
                "Auth-sensitive surfaces exist. Use auth_differential logic: compare anonymous, authenticated, and minimally modified-auth requests on the same surface."
            )
        if any("docs" in getattr(surface, "host", "") for surface in self._merged_surfaces()):
            hints.append(
                "Docs surfaces exist. Use docs_sdk_analysis logic: extract SDK names, sample endpoints, auth headers, and operation names from documentation before broad new probing."
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
        tasks = engagement_summary.get("next_tasks", [])[:3]
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
        for task in tasks[:3]:
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

    def _prepare_llm_messages(
        self,
        messages: list[ChatMessage],
        memory_snippet: list[ChatMessage],
        coverage_snippet: list[ChatMessage],
        progress_hint: list[ChatMessage],
    ) -> list[ChatMessage]:
        system_messages = [msg for msg in messages if msg.role == "system"]
        convo_messages = [msg for msg in messages if msg.role != "system"]
        trimmed_convo = convo_messages[-12:]
        return system_messages + memory_snippet + coverage_snippet + progress_hint + trimmed_convo

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
        facts = [fact for fact in self.engagement_recon.facts() if fact.kind != "research_query"][:15]

        if not facts:
            return "Curated engagement memory: none yet."
        counts = self.engagement_recon.summary_counts()
        lines = [
            "Curated engagement memory from previous runs. Treat it as useful context, not proof by itself:",
            f"Memory counts: {', '.join(f'{key}={value}' for key, value in sorted(counts.items())[:8]) or '(none)'}",
        ]
        for fact in facts:
            tags = ",".join(fact.tags) if fact.tags else "-"
            lines.append(
                f"- {fact.kind} {fact.key}: {_trim_text(fact.value, 120)} confidence={fact.confidence} status={fact.status} tags={tags}"
            )
        return "\n".join(lines)

    def _build_runner(self) -> LocalWorkspaceRunner:
        if self.settings.runner == "docker":
            return DockerSandboxRunner(self.workspace, self.settings.docker_image, self.settings.docker_env_file, settings=self.settings)
        return LocalWorkspaceRunner(self.workspace, settings=self.settings)

    def _write_engagement_report(self) -> Path:
        report_path = self._engagement_db_path().with_name("engagement-report.md")
        write_engagement_report(
            report_path,
            self.scope,
            self.engagement_recon.coverage_summary(),
            [fact for fact in self.engagement_recon.facts() if fact.kind != "research_query"],
            self.engagement_recon.surfaces(),
            self.engagement_recon.attack_results(),
        )
        self.trace.write("engagement_report_written", path=str(report_path))
        return report_path

    def _write_operator_artifacts(self) -> None:
        self._write_surface_graph()
        self._write_hypotheses()
        self._write_validation_queue()
        self._write_interesting_leads()
        self._write_auth_surfaces()
        self._write_priority_followups()
        self._write_surface_memory()

    def _write_engagement_asset_catalog(self) -> Path:
        """Export compact reusable asset lists from curated engagement memory."""
        root = self._engagement_db_path().parent / "assets"
        root.mkdir(parents=True, exist_ok=True)
        surfaces = sorted(
            self.engagement_recon.surfaces(),
            key=lambda item: (item.host, item.path_pattern, item.surface_type),
        )
        attacks = self.engagement_recon.attack_results()
        buckets: dict[str, set[str]] = {
            "all-surfaces.txt": set(),
            "live-hosts.txt": set(),
            "urls.txt": set(),
            "api-endpoints.txt": set(),
            "graphql-endpoints.txt": set(),
            "js-bundles.txt": set(),
            "source-maps.txt": set(),
            "docs-sdk-endpoints.txt": set(),
            "auth-surfaces.txt": set(),
        }
        ids: dict[str, str] = {}
        for surface in surfaces:
            surface_id = self._surface_catalog_id(surface.surface_key)
            ids[surface.surface_key] = surface_id
            url = surface.surface_key if surface.surface_key.startswith(("http://", "https://")) else f"https://{surface.host}{surface.path_pattern}"
            buckets["all-surfaces.txt"].add(
                f"{surface_id}\t{url}\t{surface.surface_type}\t{surface.auth_context}\t{surface.confidence}"
            )
            buckets["urls.txt"].add(url)
            buckets["live-hosts.txt"].add(surface.host)
            kind = surface.surface_type.lower()
            if kind == "api": buckets["api-endpoints.txt"].add(url)
            if kind == "graphql": buckets["graphql-endpoints.txt"].add(url)
            if kind == "js": buckets["js-bundles.txt"].add(url)
            if "source" in surface.tags or "sourcemap" in surface.tags: buckets["source-maps.txt"].add(url)
            if "docs" in surface.host or "sdk" in surface.tags: buckets["docs-sdk-endpoints.txt"].add(url)
            if surface.auth_context != "public": buckets["auth-surfaces.txt"].add(url)
        progress = ["surface_id\tsurface\tattack_type\tauth_context\toutcome\tsource"]
        for attack in attacks:
            progress.append(
                f"{ids.get(attack.surface_key, '-')}\t{attack.surface_key}\t{attack.attack_type}\t{attack.auth_context}\t{attack.outcome}\t{attack.source}"
            )
        (root / "test-progress.tsv").write_text("\n".join(progress) + "\n", encoding="utf-8")
        for name, values in buckets.items():
            (root / name).write_text("\n".join(sorted(values)) + ("\n" if values else ""), encoding="utf-8")
        self.trace.write("engagement_asset_catalog_written", path=str(root), files=len(buckets) + 1)
        return root

    @staticmethod
    def _surface_catalog_id(surface_key: str) -> str:
        digest = hashlib.sha1(surface_key.encode("utf-8", errors="replace")).hexdigest()
        return f"S-{int(digest[:8], 16) % 1_000_000:06d}"

    def _write_surface_graph(self) -> Path:
        surfaces = self.run_recon.surfaces()
        facts = self.run_recon.facts()
        nodes: list[dict[str, object]] = []
        edges: list[dict[str, object]] = []
        for surface in surfaces[:160]:
            nodes.append(
                {
                    "id": surface.surface_key,
                    "kind": "surface",
                    "cluster": self._classify_target_cluster(surface.surface_key),
                    "surface_type": surface.surface_type,
                    "host": surface.host,
                    "path_pattern": surface.path_pattern,
                    "auth_context": surface.auth_context,
                    "tags": list(surface.tags),
                }
            )
        for fact in facts:
            if fact.kind != "endpoint":
                continue
            host = str((fact.meta or {}).get("host", "")).strip()
            path_pattern = str((fact.meta or {}).get("path_pattern", "")).strip()
            if host and path_pattern:
                edges.append({"from": host, "to": f"{host}{path_pattern}", "kind": "hosts"})
        payload = {
            "generated_at": datetime.now().isoformat(),
            "clusters": self._target_clusters(self.session_targets),
            "nodes": nodes,
            "edges": edges[:200],
        }
        path = self.run_dir / "surface-graph.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _write_hypotheses(self) -> Path:
        attacks = self.run_recon.attack_results()
        hypotheses: list[dict[str, object]] = []
        for attack in attacks:
            if attack.outcome not in {"interesting", "confirmed"}:
                continue
            surface = attack.surface_key
            hypotheses.append(
                {
                    "surface": surface,
                    "cluster": self._classify_target_cluster(surface),
                    "hypothesis": self._hypothesis_for_attack(attack.attack_type, surface),
                    "attack_type": attack.attack_type,
                    "validation_state": self._validation_state(attack.outcome),
                    "confidence": "candidate" if attack.outcome == "interesting" else "validated",
                    "why_this_matters": self._why_surface_matters(surface, attack.attack_type),
                    "evidence": _trim_text(attack.evidence, 220),
                    "next_validation": self._next_validation_for_attack(attack.attack_type),
                }
            )
        path = self.run_dir / "hypotheses.json"
        path.write_text(json.dumps({"generated_at": datetime.now().isoformat(), "items": hypotheses[:80]}, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _write_validation_queue(self) -> Path:
        queue = []
        for attack in self.run_recon.attack_results():
            if attack.outcome not in {"interesting", "confirmed"}:
                continue
            queue.append(
                {
                    "surface": attack.surface_key,
                    "attack_type": attack.attack_type,
                    "auth_context": attack.auth_context,
                    "state": self._validation_state(attack.outcome),
                    "evidence": _trim_text(attack.evidence, 500),
                    "required_next": self._next_validation_for_attack(attack.attack_type),
                    "source": attack.source,
                }
            )
        path = self.run_dir / "validation-queue.json"
        path.write_text(json.dumps({"generated_at": datetime.now().isoformat(), "items": queue[:100]}, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    @staticmethod
    def _validation_state(outcome: str) -> str:
        return {
            "interesting": "hypothesis",
            "confirmed": "reproduced",
            "validated": "validated",
            "rejected": "rejected",
            "blocked": "blocked",
        }.get(outcome, "signal")

    def _write_interesting_leads(self) -> Path:
        lines = ["# Interesting Leads", ""]
        for item in self._build_leads()[:40]:
            lines.append(f"## {item['surface']}")
            lines.append(f"- Cluster: {item['cluster']}")
            lines.append(f"- Attack type: {item['attack_type']}")
            lines.append(f"- Why this matters: {item['why']}")
            lines.append(f"- Missing proof: {item['missing']}")
            lines.append(f"- Next step: {item['next']}")
            lines.append("")
        path = self.run_dir / "interesting-leads.md"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def _write_auth_surfaces(self) -> Path:
        lines = ["# Auth Surfaces", ""]
        for surface in self._merged_surfaces():
            if getattr(surface, "auth_context", "public") == "public":
                continue
            lines.append(f"- `{surface.host}{surface.path_pattern}` type={surface.surface_type} auth={surface.auth_context}")
        path = self.run_dir / "auth-surfaces.md"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def _write_priority_followups(self) -> Path:
        lines = ["# Priority Follow-ups", ""]
        tasks = self.run_recon.coverage_summary().get("next_tasks", [])
        for task in tasks[:20]:
            if self.priority_targets and not any(task["surface"].startswith(item) or item.startswith(task["surface"]) for item in self.priority_targets):
                continue
            lines.append(f"- `{task['surface']}` -> `{task['attack_type']}` ({task['reason']})")
        path = self.run_dir / "priority-followups.md"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def _write_surface_memory(self) -> Path:
        surfaces = self.run_recon.surfaces()
        attacks = self.run_recon.attack_results()
        tested_by_surface: dict[str, list[str]] = {}
        for attack in attacks:
            tested_by_surface.setdefault(attack.surface_key, []).append(attack.attack_type)
        payload = {
            "generated_at": datetime.now().isoformat(),
            "surfaces": [
                {
                    "surface": surface.surface_key,
                    "cluster": self._classify_target_cluster(surface.surface_key),
                    "surface_type": surface.surface_type,
                    "auth_context": surface.auth_context,
                    "tested_attacks": sorted(set(tested_by_surface.get(surface.surface_key, []))),
                    "why_this_matters": self._why_surface_matters(surface.surface_key, surface.surface_type),
                }
                for surface in surfaces[:200]
            ],
        }
        path = self.run_dir / "surface-memory.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _build_leads(self) -> list[dict[str, str]]:
        leads: list[dict[str, str]] = []
        for attack in self.run_recon.attack_results():
            if attack.outcome not in {"interesting", "confirmed"}:
                continue
            leads.append(
                {
                    "surface": attack.surface_key,
                    "cluster": self._classify_target_cluster(attack.surface_key),
                    "attack_type": attack.attack_type,
                    "why": self._why_surface_matters(attack.surface_key, attack.attack_type),
                    "missing": self._missing_proof_for_attack(attack.attack_type),
                    "next": self._next_validation_for_attack(attack.attack_type),
                }
            )
        return leads

    def _hypothesis_for_attack(self, attack_type: str, surface: str) -> str:
        return f"Determine whether {surface} demonstrates a real {attack_type} weakness with unauthorized impact."

    def _why_surface_matters(self, surface: str, attack_type: str) -> str:
        lowered = surface.lower()
        if "graphql" in lowered:
            return "GraphQL often exposes schema, object relationships, and authorization boundaries that can lead to tenant-scoped data exposure."
        if "/api/" in lowered or "api." in lowered:
            return "API endpoints often carry tenant identifiers, object references, and authorization checks that are good IDOR and authz candidates."
        if "docs" in lowered or "sdk" in lowered:
            return "Docs and SDK surfaces can reveal real endpoints, sample auth headers, operation names, and integration flows."
        if attack_type in {"auth", "session", "reset"}:
            return "Auth flows are high-value because differences between anonymous and authenticated behavior often expose bypass or tenant-mix bugs."
        return "This surface was elevated because it is likely to expose meaningful application behavior beyond static marketing content."

    def _missing_proof_for_attack(self, attack_type: str) -> str:
        if attack_type in {"auth", "session", "reset", "idor"}:
            return "Need unauthorized or cross-tenant behavior, not only a reachable endpoint or auth error."
        if attack_type in {"graphql", "api", "parameter"}:
            return "Need a response that shows sensitive data exposure, unauthorized object access, or clearly unsafe query handling."
        if attack_type in {"xss", "sqli", "ssrf"}:
            return "Need a controlled input/output effect or other direct evidence, not only a hypothesis."
        return "Need clearer impact and a reproducible request/response pair."

    def _next_validation_for_attack(self, attack_type: str) -> str:
        mapping = {
            "graphql": "Compare anonymous vs authenticated GraphQL requests and test introspection, object access, and variable tampering.",
            "api": "Replay a real request with minimal parameter changes and compare auth contexts.",
            "parameter": "Look for authorization or injection-sensitive parameters and replay with one bounded variation.",
            "auth": "Compare no cookie, valid cookie, and modified cookie behavior on the same surface.",
            "session": "Check whether session-bound endpoints truly enforce the expected auth boundary.",
            "reset": "Trace reset or invite flows for token validation and tenant binding.",
            "xss": "Use one bounded reflected/stored input test and preserve exact output.",
            "sqli": "Use one bounded parameter probe or focused tool run with explicit rate controls.",
            "ssrf": "Look for URL-taking parameters and use one safe outbound target or validation pattern.",
        }
        return mapping.get(attack_type, "Write a small verifier that captures an exact request, exact response, and why the behavior matters.")


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
    if not value.get("action") and isinstance(value.get("tool"), str):
        tool_name = str(value.get("tool", "")).strip().lower()
        if tool_name in {"gau", "subfinder", "katana", "ffuf", "gobuster", "dirsearch", "httpx", "wafw00f", "nuclei", "nikto", "sqlmap", "xsstrike"}:
            query = str(value.get("query") or value.get("target") or value.get("url") or "").strip()
            if query:
                value["action"] = tool_name
                value["target"] = query
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
    coverage_summary: dict[str, object] | None = None,
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
    coverage_summary = coverage_summary or {}
    surface_count = int(coverage_summary.get("surface_count", 0) or 0)
    attack_count = int(coverage_summary.get("attack_count", 0) or 0)
    gaps: list[str] = []
    if len(set(search_queries)) < 4 or sum(research_sources.values()) < 3:
        gaps.append("run at least four distinct public searches covering at least three research sources")
    if surface_count < 8 and not re.search(r"\b(katana|subfinder|waybackurls|gau|assetfinder|amass|ffuf|gobuster|dirsearch)\b", command_text):
        gaps.append("use a discovery tool such as katana, subfinder, waybackurls, ffuf, gobuster, or dirsearch")
    if not re.search(r"\b(httpx|wafw00f|whatweb)\b", command_text):
        gaps.append("use a fingerprinting tool such as httpx or wafw00f")
    if attack_count < 12 and not re.search(r"\b(nuclei|nikto|xsstrike|sqlmap)\b", command_text):
        gaps.append("run one focused low-rate scanner such as nuclei, nikto, XSStrike, or SQLMap")
    if max(len(hosts), surface_count) < 3:
        gaps.append("touch at least three distinct in-scope hosts or application surfaces")
    if not written_files or not executed_python:
        gaps.append("write and execute one small Python verification script")
    return gaps


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")[:80] or "target"


def _trim_text(value: str, limit: int) -> str:
    text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + f"...[trimmed {len(text) - limit} chars]"


def _summarize_items(values: list[str], limit: int) -> str:
    if not values:
        return "(none)"
    sample = values[:limit]
    text = ", ".join(sample)
    if len(values) > limit:
        text += f", ...(+{len(values) - limit} more)"
    return text
