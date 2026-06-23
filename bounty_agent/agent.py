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
from .sandbox import DockerSandboxRunner, LocalWorkspaceRunner
from .scope import ScopeGuard
from .tools import ToolRegistry
from .trace import TraceLogger


class BountyAgent:
    def __init__(self, scope: ProgramScope, target: str, settings: AgentSettings, runs_dir: Path) -> None:
        self.scope = scope
        self.target = target
        self.settings = settings
        self.run_dir = runs_dir / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{_slug(target)}"
        self.workspace = self.run_dir / "workspace"
        self.trace = TraceLogger(self.run_dir / "trace.jsonl")
        self.retrieval = self._build_retrieval_store()
        # create ScopeGuard with per-run dynamic allowlist and optional allow-all
        dynamic_file = self.workspace / "allowed_hosts.txt"
        self.scope_guard = ScopeGuard(scope, dynamic_allow_file=dynamic_file, allow_all=self.settings.allow_all_hosts)
        self.runner = self._build_runner()
        self.tools = ToolRegistry(
            self.runner,
            self.scope_guard,
            self.trace,
            self.retrieval,
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

    def _run(self) -> Path:
        target_decision = self.scope_guard.validate_target(self.target)
        self.trace.write(
            "start",
            target=self.target,
            scope_allowed=target_decision.allowed,
            reason=target_decision.reason,
            runner=self.settings.runner,
        )
        if not target_decision.allowed:
            write_report(
                self.run_dir / "report.md",
                self.scope,
                self.target,
                [],
                f"Target blocked before recon: {target_decision.reason}",
            )
            return self.run_dir

        messages = [
            ChatMessage("system", build_system_prompt(self.scope, self.target, self.settings)),
            ChatMessage("user", "Begin with safe recon. Record only findings with concrete evidence."),
        ]

        for action in deterministic_recon_plan(self.target):
            if self.settings.dry_run:
                self.trace.write("dry_run_action", action=action)
                result_content = f"Dry run: would execute {action.get('command')}"
                result_ok = True
            else:
                result = self.tools.execute(action)
                result_content = result.content
                result_ok = result.ok
            self.retrieval.add(0, action, result_content, {"type": action.get("action"), "phase": "startup"})
            messages.append(ChatMessage("user", self._format_tool_feedback(action, result_ok, result_content)))

        summary = ""
        if self.settings.model:
            summary = self._run_llm_loop(messages)
        else:
            summary = "Dry run completed without an LLM. Configure --model to enable the JSON action loop."

        write_report(
            self.run_dir / "report.md",
            self.scope,
            self.target,
            self.tools.findings,
            summary,
            self.tools.history,
        )
        self.trace.write("finish", report=str(self.run_dir / "report.md"))
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
                progress_hint = self._build_progress_hint(step, action_counts, repeat_blocks)
                response = self.llm.complete(messages + memory_snippet + progress_hint)
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
                rejected_reason = ""
                if gaps:
                    rejected_reason = "Recon coverage is incomplete: " + "; ".join(gaps)
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
        if not hints:
            return []
        return [ChatMessage("system", "\n".join(hints))]

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
    return value if isinstance(value, dict) else None


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
