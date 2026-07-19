from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import ProgramScope
from .recon_db import AttackResult, ReconFact, SurfaceRecord
from .tools import Finding


_SEVERITY_SORT = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4, "unknown": 5}


def _severity_key(finding: Finding) -> int:
    return _SEVERITY_SORT.get(finding.severity.strip().lower(), 99)


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
    run_coverage = run_coverage or {}
    sorted_findings = sorted(findings, key=_severity_key)

    # Severity summary table
    severity_counts = Counter(f.severity.strip().lower() for f in findings)
    severity_table = [
        "| Severity | Count |",
        "|----------|-------|",
    ]
    for sev in ("critical", "high", "medium", "low", "info"):
        severity_table.append(f"| {sev} | {severity_counts.get(sev, 0)} |")
    if sum(severity_counts.values()) == 0:
        severity_table = ["No findings recorded."]

    lines = [
        f"# Bug Bounty Triage Report: {scope.program_name}",
        "",
        "---",
        "",
        f"**Target:** `{target}`",
        f"**Generated:** `{datetime.now().isoformat(timespec='seconds')}`",
        f"**Session targets:** `{', '.join(session_targets or [target])}`",
        f"**Findings:** `{len(findings)}`",
        f"**Surfaces tested:** `{(run_coverage or {}).get('surface_count', 0)}`",
        f"**Attack combos tested:** `{(run_coverage or {}).get('tested_combinations', 0)}`",
        "",
        "---",
        "",
        "## 📋 Executive Summary",
        "",
        summary or "No summary provided.",
        "",
        "## 🔴 Severity Breakdown",
        "",
        *severity_table,
        "",
        "## 🎯 Scope & Methodology",
        "",
        *_render_methodology(target, scope),
        "",
        "### Scope",
        "",
        f"- **Program:** {scope.program_name}",
        f"- **Allowed domains:** {', '.join(scope.allowed_domains) or '(none)'}",
        f"- **Excluded domains:** {', '.join(scope.excluded_domains) or '(none)'}",
        f"- **Notes:** {scope.notes or '(none)'}",
        "",
        "## 🗺️ Target Map",
        "",
        *_render_target_map(run_facts or []),
        "",
        "## ⚡ Potential Weaknesses",
        "",
        *_render_potential_weaknesses_note(potential_weaknesses_path),
        "",
        "## 📜 Evidence Trail",
        "",
        *_render_evidence_trail(history or []),
        "",
        "## 📊 Coverage Analysis",
        "",
        *_render_coverage_section(run_coverage, engagement_coverage or {}),
        "",
        "## ➡️ Recommended Next Steps",
        "",
        *_render_recommended_next_steps(run_coverage, summary),
        "",
        "---",
        "",
        "## 🔍 Findings Details",
        "",
    ]
    if not sorted_findings:
        lines.append("No findings were recorded. Review `trace.jsonl` for recon output and blocked actions.")
        if history:
            lines.extend(["", "### Recon Mapping (Execution Log)", "", "The following recon steps were executed:", ""])
            for idx, (action, result) in enumerate(history, start=1):
                if idx > 40:
                    lines.append(f"{idx}. ...additional steps omitted; see `trace.jsonl`.")
                    break
                if action.get("action") == "bash":
                    lines.append(f"{idx}. `{action.get('command')}` → exit_code={result.ok}")
                elif action.get("action") == "search":
                    lines.append(f"{idx}. search `{action.get('query')}` via {action.get('engine')} → exit_code={result.ok}")
                else:
                    lines.append(f"{idx}. {action.get('action')} → exit_code={result.ok}")

    for idx, finding in enumerate(sorted_findings, start=1):
        severity_badge = {
            "critical": "🔴 CRITICAL",
            "high": "🟠 HIGH",
            "medium": "🟡 MEDIUM",
            "low": "🟢 LOW",
            "info": "🔵 INFO",
        }.get(finding.severity.strip().lower(), "⚪ UNKNOWN")

        lines.extend(
            [
                f"### {idx}. {finding.title}",
                "",
                f"- **Severity:** `{severity_badge}`",
                f"- **Asset:** `{finding.asset}`",
                f"- **Impact:** {finding.impact.strip()}",
                "",
                "#### Request",
                "",
                "```http",
                finding.request.strip() or "(not provided)",
                "```",
                "",
                "#### Response",
                "",
                "```http",
                finding.response.strip() or "(not provided)",
                "```",
                "",
                "#### Evidence",
                "",
                "```text",
                finding.evidence.strip(),
                "```",
                "",
                "#### Next Steps",
                "",
                finding.next_steps.strip() or "Manually verify impact and program eligibility.",
                "",
                "---",
                "",
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_engagement_report(
    path: Path,
    scope: ProgramScope,
    coverage: dict[str, Any],
    facts: list[ReconFact],
    surfaces: list[SurfaceRecord],
    attacks: list[AttackResult],
) -> None:
    lines = [
        f"# Engagement Recon Report: {scope.program_name}",
        "",
        f"- Generated: `{datetime.now().isoformat(timespec='seconds')}`",
        f"- Known hosts: `{len(_unique(f.value for f in facts if f.kind == 'host'))}`",
        f"- Known endpoints: `{len([fact for fact in facts if fact.kind == 'endpoint'])}`",
        f"- Known surfaces: `{len(surfaces)}`",
        f"- Known attack results: `{len(attacks)}`",
        "",
        "## Program Overview",
        "",
        f"- Program: {scope.program_name}",
        f"- Allowed domains: {', '.join(scope.allowed_domains) or '(none)'}",
        f"- Excluded domains: {', '.join(scope.excluded_domains) or '(none)'}",
        f"- Allowed URLs: {', '.join(scope.allowed_urls) or '(none)'}",
        f"- Notes: {scope.notes or '(none)'}",
        "",
        "## High-Level Map",
        "",
        *_render_target_map(facts),
        "",
        "## Technology and Surface Summary",
        "",
        *_render_surface_summary(surfaces),
        "",
        "## Interesting Historical Checks",
        "",
        *_render_attack_summary(attacks),
        "",
        "## Coverage Gaps",
        "",
        *_render_coverage_section(coverage, coverage),
        "",
        "## Operator Notes",
        "",
        "- This report is engagement-wide memory, not proof that every listed behavior is still live.",
        "- Repeated items are deduplicated by host, endpoint, surface, and attack family where possible.",
        "- Use the per-run report and trace for exact chronological execution details.",
        "",
    ]
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
            *[f"- {task['surface_type']} `{task['surface']}` → `{task['attack_type']}` ({task['reason']})" for task in next_tasks[:6]],
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
        f"Current run has **{run_coverage.get('surface_count', 0)}** surfaces and **{run_coverage.get('tested_combinations', 0)}** tested surface/attack combinations."
    )
    surface_types = run_coverage.get("surface_types", {})
    if surface_types:
        lines.append("")
        lines.append("**Surface type breakdown:**")
        for surface_type, count in sorted(surface_types.items(), key=lambda item: item[0]):
            lines.append(f"- `{surface_type}`: {count}")
    next_tasks = run_coverage.get("next_tasks", [])[:8]
    if next_tasks:
        lines.append("")
        lines.append("**Untested high-value follow-ups:**")
        for task in next_tasks:
            lines.append(
                f"- `{task['surface_type']}` `{task['surface']}` → `{task['attack_type']}` ({task['reason']})"
            )
    if engagement_coverage.get("surface_count", 0):
        lines.append("")
        lines.append(
            f"Engagement memory currently tracks **{engagement_coverage.get('surface_count', 0)}** surfaces and **{engagement_coverage.get('attack_count', 0)}** attack results."
        )
    return lines or ["No structured coverage data was recorded."]


def _render_evidence_trail(history: list[tuple[dict[str, Any], Any]]) -> list[str]:
    if not history:
        return ["No execution history was recorded."]
    lines: list[str] = []
    interesting = 0
    for action, result in history:
        action_name = str(action.get("action", ""))
        if action_name == "finish":
            continue
        text = str(getattr(result, "content", "")).lower()
        if not getattr(result, "ok", False) and action_name not in {"record_finding"}:
            continue
        if action_name == "bash":
            detail = str(action.get("command", "")).strip()
        elif action_name == "search":
            detail = f"search {action.get('query', '')} via {action.get('engine', '')}".strip()
        else:
            detail = str(action.get("path") or action.get("target") or action.get("url") or action_name)
        if not detail:
            continue
        lines.append(f"- `{action_name}` → `{detail}`")
        interesting += 1
        if "graphql" in text or "swagger" in text or "openapi" in text or "sourcemap" in text or "set-cookie" in text:
            lines.append(f"  Evidence: `{_trim_excerpt(getattr(result, 'content', ''))}`")
        if interesting >= 20:
            break
    return lines or ["No high-signal execution trail entries were selected."]


def _render_surface_summary(surfaces: list[SurfaceRecord]) -> list[str]:
    if not surfaces:
        return ["No surfaces have been promoted into engagement memory yet."]
    lines: list[str] = []
    grouped: dict[str, list[SurfaceRecord]] = {}
    for surface in surfaces:
        grouped.setdefault(surface.surface_type, []).append(surface)
    for surface_type in sorted(grouped):
        lines.append(f"### {surface_type}")
        lines.append("")
        for surface in grouped[surface_type][:12]:
            tags = ", ".join(surface.tags) or "untagged"
            lines.append(f"- `{surface.host}{surface.path_pattern}` auth={surface.auth_context} tags={tags}")
        if len(grouped[surface_type]) > 12:
            lines.append(f"- ...{len(grouped[surface_type]) - 12} more omitted")
        lines.append("")
    return lines


def _render_attack_summary(attacks: list[AttackResult]) -> list[str]:
    if not attacks:
        return ["No attack history has been promoted into engagement memory yet."]
    lines: list[str] = []
    seen: set[tuple[str, str]] = set()
    for attack in attacks:
        key = (attack.surface_key, attack.attack_type)
        if key in seen:
            continue
        seen.add(key)
        meta = attack.meta or {}
        detail = str(meta.get("command") or meta.get("query") or meta.get("target") or "").strip()
        lines.append(
            f"- `{attack.attack_type}` on `{attack.surface_key}` outcome=`{attack.outcome}` auth=`{attack.auth_context}`"
        )
        if detail:
            lines.append(f"  Trigger: `{detail[:180]}`")
        if attack.evidence:
            lines.append(f"  Evidence: `{_trim_excerpt(attack.evidence)}`")
        if len(seen) >= 20:
            break
    return lines


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


def _trim_excerpt(text: str, limit: int = 180) -> str:
    value = " ".join(str(text).split())
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _looks_like_ip(value: str) -> bool:
    try:
        from ipaddress import ip_address

        ip_address(value)
        return True
    except ValueError:
        return False