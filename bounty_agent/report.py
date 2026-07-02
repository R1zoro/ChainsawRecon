from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from .config import ProgramScope
from .recon_db import ReconFact
from .tools import Finding


def write_report(
    path: Path,
    scope: ProgramScope,
    target: str,
    findings: list[Finding],
    summary: str,
    history: list[tuple[dict[str, Any], Any]] | None = None,
    run_facts: list[ReconFact] | None = None,
    engagement_facts: list[ReconFact] | None = None,
    run_coverage: dict[str, Any] | None = None,
    engagement_coverage: dict[str, Any] | None = None,
    session_targets: list[str] | None = None,
    potential_weaknesses_path: Path | None = None,
) -> None:
    lines = [
        f"# Bug Bounty Triage Report: {scope.program_name}",
        "",
        f"- Target: `{target}`",
        f"- Session targets: `{', '.join(session_targets or [target])}`",
        f"- Generated: `{datetime.now().isoformat(timespec='seconds')}`",
        f"- Findings recorded: `{len(findings)}`",
        f"- Run recon facts: `{len(run_facts or [])}`",
        f"- Prior engagement facts loaded: `{len(engagement_facts or [])}`",
        f"- Run surfaces: `{(run_coverage or {}).get('surface_count', 0)}`",
        f"- Run attack results: `{(run_coverage or {}).get('attack_count', 0)}`",
        "",
        "## Summary",
        "",
        summary or "No summary provided.",
        "",
        "## Methodology",
        "",
        *_render_methodology(target, scope),
        "",
        "## Scope Notes",
        "",
        f"- Allowed domains: {', '.join(scope.allowed_domains) or '(none)'}",
        f"- Excluded domains: {', '.join(scope.excluded_domains) or '(none)'}",
        f"- Program notes: {scope.notes or '(none)'}",
        "",
        "## Target Map",
        "",
        *_render_target_map(run_facts or []),
        "",
        "## Potential Weaknesses",
        "",
        *_render_potential_weaknesses_note(potential_weaknesses_path),
        "",
        "## Coverage",
        "",
        *_render_coverage_section(run_coverage or {}, engagement_coverage or {}),
        "",
        "## Recommended Next Steps",
        "",
        *_render_recommended_next_steps(run_coverage or {}, summary),
        "",
        "## Findings",
        "",
    ]
    if not findings:
        lines.append("No findings were recorded. Review `trace.jsonl` for recon output and blocked actions.")
        if history:
            lines.extend(["", "## Recon Mapping", "", "The following recon steps were executed during the run:", ""])
            for idx, (action, result) in enumerate(history, start=1):
                if idx > 30:
                    lines.append(f"{idx}. ...additional recon steps omitted from report; see `trace.jsonl`.")
                    break
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


def _render_target_map(facts: list[ReconFact]) -> list[str]:
    if not facts:
        return ["No structured target map facts were recorded."]
    lines: list[str] = []
    hosts = _unique(f.value for f in facts if f.kind == "host")
    endpoints = [f for f in facts if f.kind == "endpoint"]
    tools = _unique(f.key for f in facts if f.kind == "tool")
    research = _unique(f.key for f in facts if f.kind == "research_query")
    if hosts:
        lines.extend(["### Hosts", ""])
        lines.extend(f"- `{host}`" for host in hosts[:50])
        if len(hosts) > 50:
            lines.append(f"- ...{len(hosts) - 50} more omitted")
        lines.append("")
    if endpoints:
        lines.extend(["### Interesting Endpoints", ""])
        for fact in endpoints[:80]:
            tags = ", ".join(fact.tags) or "untagged"
            pattern = (fact.meta or {}).get("path_pattern", "")
            lines.append(f"- `{fact.value}` ({tags}; pattern `{pattern}`)")
        if len(endpoints) > 80:
            lines.append(f"- ...{len(endpoints) - 80} more omitted")
        lines.append("")
    if research:
        lines.extend(["### Research Coverage", ""])
        lines.extend(f"- `{item}`" for item in research[:10])
        lines.append("")
    if tools:
        lines.extend(["### Available Tools", ""])
        lines.append(", ".join(f"`{tool}`" for tool in tools[:40]))
        lines.append("")
    return lines or ["No reportable structured map entries were recorded."]


def _render_methodology(target: str, scope: ProgramScope) -> list[str]:
    lines = [
        "- Validated the requested target against the engagement scope before any probe.",
        "- Collected low-risk baseline evidence such as headers, robots.txt, sitemap.xml, and obvious landing pages when available.",
        "- Prioritized auth-sensitive or tenant-sensitive surfaces before recordable exploitation attempts.",
        "- Used fingerprinting and small verification scripts instead of repeating the same curl probe.",
    ]
    if _looks_like_ip(target):
        lines.append("- Treated the target as a raw service endpoint: inspect HTTP/TLS behavior, auth boundaries, and likely paths rather than assuming hostname-only logic.")
    else:
        lines.append("- Treated the target as a host-based application surface and checked root responses, obvious routes, and auth boundaries.")
    if scope.allowed_urls:
        lines.append(f"- Kept follow-up activity aligned to the explicitly allowed URLs: {', '.join(scope.allowed_urls)}")
    return lines


def _render_recommended_next_steps(run_coverage: dict[str, Any], summary: str) -> list[str]:
    next_tasks = (run_coverage or {}).get("next_tasks", []) or []
    if next_tasks:
        return [
            "- Prioritize the highest-value untested surfaces first.",
            *[f"- {task['surface_type']} {task['surface']} -> {task['attack_type']} ({task['reason']})" for task in next_tasks[:6]],
            "- Validate any promising auth boundary with a small, one-off verification script instead of broad probing.",
        ]
    summary_text = (summary or "").strip()
    if summary_text:
        return [f"- Review the summary and expand authenticated or tenant-scoped checks where the summary mentions an auth boundary or exposed endpoint.", f"- Continue with one low-rate verification script and one focused fingerprinting pass before any broader scan."]
    return ["- Continue with one low-rate verification script and one focused fingerprinting pass before any broader scan."]


def _render_coverage_section(run_coverage: dict[str, Any], engagement_coverage: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if not run_coverage:
        return ["No structured coverage data was recorded."]
    lines.append(
        f"Current run has {run_coverage.get('surface_count', 0)} surfaces and {run_coverage.get('tested_combinations', 0)} tested surface/attack combinations."
    )
    surface_types = run_coverage.get("surface_types", {})
    if surface_types:
        lines.append("Surface types:")
        for surface_type, count in sorted(surface_types.items(), key=lambda item: item[0]):
            lines.append(f"- `{surface_type}`: {count}")
    next_tasks = run_coverage.get("next_tasks", [])[:8]
    if next_tasks:
        lines.append("")
        lines.append("Untested high-value follow-ups:")
        for task in next_tasks:
            lines.append(
                f"- `{task['surface_type']}` `{task['surface']}` -> `{task['attack_type']}` ({task['reason']})"
            )
    if engagement_coverage.get("surface_count", 0):
        lines.append("")
        lines.append(
            f"Engagement memory currently tracks {engagement_coverage.get('surface_count', 0)} surfaces and {engagement_coverage.get('attack_count', 0)} attack results."
        )
    return lines or ["No structured coverage data was recorded."]


def _render_potential_weaknesses_note(path: Path | None) -> list[str]:
    if not path:
        return ["No potential weakness ledger was written."]
    return [
        f"Potential weaknesses and candidate chains were written to `{path.name}`.",
        "- Use that file to review interesting but not yet validated leads across the whole session.",
    ]


def _unique(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _looks_like_ip(value: str) -> bool:
    try:
        from ipaddress import ip_address

        ip_address(value)
        return True
    except ValueError:
        return False
