from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from .config import ProgramScope
from .tools import Finding


def write_report(path: Path, scope: ProgramScope, target: str, findings: list[Finding], summary: str, history: list[tuple[dict[str, Any], Any]] | None = None) -> None:
    lines = [
        f"# Bug Bounty Triage Report: {scope.program_name}",
        "",
        f"- Target: `{target}`",
        f"- Generated: `{datetime.now().isoformat(timespec='seconds')}`",
        f"- Findings recorded: `{len(findings)}`",
        "",
        "## Summary",
        "",
        summary or "No summary provided.",
        "",
        "## Scope Notes",
        "",
        f"- Allowed domains: {', '.join(scope.allowed_domains) or '(none)'}",
        f"- Excluded domains: {', '.join(scope.excluded_domains) or '(none)'}",
        f"- Program notes: {scope.notes or '(none)'}",
        "",
        "## Findings",
        "",
    ]
    if not findings:
        lines.append("No findings were recorded. Review `trace.jsonl` for recon output and blocked actions.")
        if history:
            lines.extend(["", "## Recon Mapping", "", "The following recon steps were executed during the run:", ""])
            for idx, (action, result) in enumerate(history, start=1):
                if action.get("action") == "bash":
                    lines.append(f"{idx}. `{action.get('command')}` -> exit_code={result.ok}")
                elif action.get("action") == "search":
                    lines.append(f"{idx}. search `{action.get('query')}` via {action.get('engine')} -> exit_code={result.ok}")
                else:
                    lines.append(f"{idx}. {action.get('action')} -> exit_code={result.ok}")
    for idx, finding in enumerate(findings, start=1):
        lines.extend(
            [
                f"### {idx}. {finding.title}",
                "",
                f"- Severity: `{finding.severity}`",
                f"- Asset: `{finding.asset}`",
                "",
                "Request:",
                "",
                "```text",
                finding.request.strip() or "(not provided)",
                "```",
                "",
                "Response:",
                "",
                "```text",
                finding.response.strip() or "(not provided)",
                "```",
                "",
                "Evidence:",
                "",
                "```text",
                finding.evidence.strip(),
                "```",
                "",
                "Impact:",
                "",
                finding.impact.strip(),
                "",
                "Next steps:",
                "",
                finding.next_steps.strip() or "Manually verify impact and program eligibility.",
                "",
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
