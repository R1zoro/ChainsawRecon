from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from html.parser import HTMLParser
import re
import time
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

from .retrieval import RetrievalStore
from .sandbox import SandboxRunner
from .scope import ScopeGuard
from .skills import get_skill
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
        command_delay_seconds: float = 0.0,
        max_commands_per_minute: int = 0,
        max_repeated_commands: int = 2,
    ) -> None:
        self.runner = runner
        self.scope_guard = scope_guard
        self.trace = trace
        self.retrieval = retrieval
        self.findings: list[Finding] = []
        self.history: list[tuple[dict[str, Any], ToolResult]] = []
        self.rate_limiter = CommandRateLimiter(command_delay_seconds, max_commands_per_minute, trace)
        self.max_repeated_commands = max(1, max_repeated_commands)
        self.command_counts: dict[str, int] = {}
        self.finding_fingerprints: set[str] = set()

    def execute(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("action", "")).strip()
        self.trace.write("tool_call", action=action)
        try:
            if name == "bash":
                result = self._bash(action)
            elif name == "search":
                result = self._search(action)
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
            elif name == "finish":
                result = ToolResult(True, "Finished.")
            else:
                result = ToolResult(False, f"Unsupported action: {name}")
        except Exception as exc:
            result = ToolResult(False, f"{type(exc).__name__}: {exc}")
        self.trace.write("tool_result", ok=result.ok, content=_truncate(result.content), meta=result.meta)
        self.history.append((action, result))
        return result

    def _bash(self, action: dict[str, Any]) -> ToolResult:
        command = str(action.get("command", "")).strip()
        timeout = int(action.get("timeout_seconds", 60))
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
        content = (
            f"exit_code={result.exit_code} timed_out={result.timed_out}\n"
            f"--- stdout ---\n{_truncate(result.stdout)}\n"
            f"--- stderr ---\n{_truncate(result.stderr)}"
        )
        return ToolResult(result.exit_code == 0, content)

    def _search(self, action: dict[str, Any]) -> ToolResult:
        query = str(action.get("query", "")).strip()
        engine = str(action.get("engine", "duckduckgo")).strip().lower()
        max_results = int(action.get("max_results", 5))
        if not query:
            return ToolResult(False, "Missing query.")
        if engine not in {"duckduckgo", "bing", "google"}:
            return ToolResult(False, f"Unsupported search engine: {engine}")
        if max_results <= 0 or max_results > 10:
            return ToolResult(False, "max_results must be between 1 and 10.")

        safe_query = _sanitize_search_query(query)
        if engine == "duckduckgo":
            command = f"curl -fsSL 'https://html.duckduckgo.com/html/?q={safe_query}'"
        elif engine == "bing":
            command = f"curl -fsSL 'https://www.bing.com/search?q={safe_query}'"
        else:
            command = f"curl -fsSL 'https://www.google.com/search?q={safe_query}'"

        self.rate_limiter.wait()
        result = self.runner.exec(command, int(action.get("timeout_seconds", 30)))
        content = _format_search_results(result.stdout or "", max_results)
        if result.exit_code != 0 and result.stderr:
            content += f"\n--- tool error ---\n{_truncate(result.stderr)}"
        return ToolResult(result.exit_code == 0, content)

    def _read_file(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", ""))
        return ToolResult(True, self.runner.read_file(path))

    def _write_file(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", ""))
        content = str(action.get("content", ""))
        self.runner.write_file(path, content)
        return ToolResult(True, f"Wrote {len(content)} bytes to {path}.")

    def _list_files(self, action: dict[str, Any]) -> ToolResult:
        path = str(action.get("path", "."))
        return ToolResult(True, "\n".join(self.runner.list_files(path)))

    def _use_skill(self, action: dict[str, Any]) -> ToolResult:
        name = str(action.get("name", ""))
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
        evidence_issue = _validate_finding_evidence(finding)
        if evidence_issue:
            return ToolResult(False, evidence_issue, {"finding_rejected": True})

        fingerprint = _finding_fingerprint(finding)
        if fingerprint in self.finding_fingerprints:
            return ToolResult(
                True,
                "Duplicate finding suppressed. Do not record it again; either add new evidence, write a verification script, search for related CVEs/CWEs, or finish.",
                {"duplicate": True},
            )

        self.finding_fingerprints.add(fingerprint)
        self.findings.append(finding)
        return ToolResult(True, f"Recorded finding: {finding.title}")

    def _check_repeated_command(self, command: str) -> ToolResult | None:
        fingerprint = _command_fingerprint(command)
        count = self.command_counts.get(fingerprint, 0) + 1
        self.command_counts[fingerprint] = count
        if count <= self.max_repeated_commands:
            return None
        return ToolResult(
            False,
            (
                f"Repeated command blocked after {self.max_repeated_commands} runs.\n"
                "Do not run the same probe again. Change strategy now: write a small Python verification script, "
                "search public references for the observed technology/CWE/CVE, enumerate a new endpoint class, "
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


def _validate_finding_evidence(finding: Finding) -> str:
    evidence = finding.evidence.strip().lower()
    combined = " ".join([finding.evidence, finding.request, finding.response]).lower()
    severity = finding.severity.strip().lower()
    if severity in {"", "unknown", "info", "informational"}:
        return "Finding rejected: informational observations belong in recon notes, not the findings section."
    if not finding.request.strip() or not finding.response.strip():
        return "Finding rejected: provide the exact request and response used to reproduce the behavior."
    if not finding.impact.strip():
        return "Finding rejected: describe concrete security impact, not only unexpected behavior."
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
    if re.search(r"\b(401|403|404)\b", combined) and not any(
        term in combined for term in ["bypass", "cross-tenant", "unauthorized data", "sensitive data"]
    ):
        return "Finding rejected: an expected 401, 403, or 404 response is not a vulnerability without bypass impact."
    return ""


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
        "ffuf": [" -rate ", " -t 1", " -t 2", " -t 3", " -t 4", " -t 5"],
        "nuclei": [" -rl ", " -rate-limit ", " -c 1", " -concurrency 1", " -c 2", " -concurrency 2"],
        "httpx": [" -rl ", " -rate-limit ", " -threads 1", " -threads 2", " -threads 3", " -threads 4", " -threads 5"],
        "katana": [" -rl ", " -rate-limit ", " -c 1", " -concurrency 1", " -c 2", " -concurrency 2"],
        "gobuster": [" -t 1", " -t 2", " -t 3", " -t 4", " -t 5", " --delay "],
        "dirsearch": [" --max-rate ", " -t 1", " -t 2", " -t 3", " -t 4", " -t 5"],
        "sqlmap": [" --delay=", " --threads=1", " --safe-url", " --batch"],
    }
    padded = f" {lowered} "
    for tool, required_any in scanner_rate_hints.items():
        if re.search(rf"(^|[;&|]\s*){tool}\b|\s{tool}\b", lowered) and not any(hint in padded for hint in required_any):
            return ToolResult(
                False,
                (
                    f"{tool} command blocked because it lacks explicit low-rate/concurrency controls. "
                    "Add the tool's rate, delay, or low-thread flags according to the program policy."
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
