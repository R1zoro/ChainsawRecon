from __future__ import annotations

"""Deterministic nuclei vuln-discovery wiring.

nuclei is the deterministic endpoint vuln-discovery engine (the web analog of a
Metasploit-style check library): ~12k templated, low-false-positive probes.  The
model should not have to eyeball a raw nuclei dump and re-derive findings by
hand — this module turns nuclei's JSONL stream into a structured, deduplicated,
severity-sorted result set and renders a record_finding-ready summary.

The model-facing contract:
  - run ``nuclei`` with a target (optionally ``severity`` / ``tags`` to bound noise)
  - get back a compact, deterministic summary plus a suggested record_finding payload
  - never touch raw ``-o`` files or hand-parse stdout.
"""

import json
from typing import Any

SEVERITY_ORDER: dict[str, int] = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 4,
    "unknown": 5,
}

_MAX_RENDERED = 20  # cap the summary to avoid context blowup


def build_nuclei_command(
    url: str,
    *,
    severity: str = "",
    tags: str = "",
    output_path: str = "",
) -> str:
    """Build a deterministic nuclei invocation.

    ``-jsonl -silent`` yields one JSON object per line on stdout (no banner or
    progress noise).  ``-no-interactsh`` keeps the run out-of-band-only and
    avoids waiting on a collaborator round-trip.  Rate/concurrency are pinned
    low so the scan is slow and in-scope.
    """
    sanitized = url.replace("'", "\\'")
    parts = [
        "nuclei",
        "-u", f"'{sanitized}'",
        "-jsonl", "-silent",
        "-rate-limit", "5",
        "-concurrency", "1",
        "-no-interactsh",
    ]
    if severity:
        parts += ["-severity", severity.strip()]
    if tags:
        parts += ["-tags", tags.strip()]
    if output_path:
        parts += ["-o", f"'{output_path}'"]
    return " ".join(parts)


def _severity_of(entry: dict[str, Any]) -> str:
    info = entry.get("info") or {}
    return str(info.get("severity", "unknown")).lower()


def parse_nuclei_jsonl(text: str) -> list[dict[str, Any]]:
    """Parse nuclei JSONL stdout into deduplicated, severity-sorted findings."""
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(obj, dict) or "template-id" not in obj:
            continue
        tid = str(obj.get("template-id", ""))
        matched = str(obj.get("matched-at", obj.get("host", "")))
        key = (tid, matched)
        if key in seen:
            continue
        seen.add(key)
        findings.append(obj)
    findings.sort(key=lambda f: SEVERITY_ORDER.get(_severity_of(f), 5))
    return findings


def _to_record_finding(entry: dict[str, Any]) -> dict[str, Any]:
    """Map one nuclei result onto the Finding contract used by record_finding."""
    info = entry.get("info") or {}
    name = str(info.get("name") or entry.get("template-id", "Unnamed"))
    severity = str(info.get("severity", "unknown"))
    matched = str(entry.get("matched-at", entry.get("host", "")))
    matcher = str(entry.get("matcher-name", ""))
    matched_value = str(entry.get("matched", ""))
    curl = str(entry.get("curl-command", ""))
    extracted = entry.get("extracted-results") or []
    response_hint = str(entry.get("response", "") or (extracted[0] if extracted else ""))
    evidence_parts = [f"template-id: {entry.get('template-id', '')}"]
    if matcher:
        evidence_parts.append(f"matcher: {matcher}")
    if matched_value:
        evidence_parts.append(f"matched: {matched_value[:400]}")
    if extracted:
        evidence_parts.append(f"extracted: {', '.join(str(x) for x in extracted[:5])[:400]}")
    return {
        "title": name,
        "severity": severity,
        "asset": matched,
        "evidence": "; ".join(evidence_parts),
        "impact": str(info.get("description", "") or info.get("tags", "") or ""),
        "next_steps": f"Reproduce with: {curl}" if curl else "",
        "request": curl,
        "response": response_hint[:2000],
    }


def render_nuclei_summary(findings: list[dict[str, Any]], url: str) -> str:
    """Render a compact, record_finding-ready summary of parsed nuclei results."""
    if not findings:
        return f"nuclei: 0 findings on {url}."
    lines = [f"nuclei: {len(findings)} finding(s) on {url} (deduplicated, severity-sorted):", ""]
    for entry in findings[:_MAX_RENDERED]:
        sev = _severity_of(entry)
        info = entry.get("info") or {}
        name = info.get("name") or entry.get("template-id", "Unnamed")
        matched = entry.get("matched-at", entry.get("host", ""))
        matcher = entry.get("matcher-name", "")
        curl = entry.get("curl-command", "")
        lines.append(f"- [{sev}] {name} — {matched}" + (f" (matcher: {matcher})" if matcher else ""))
        if curl:
            lines.append(f"    reproduce: {curl}")
    if len(findings) > _MAX_RENDERED:
        lines.append(f"    ... and {len(findings) - _MAX_RENDERED} more")
    lines.append("")
    lines.append("Record the highest-severity results with record_finding; map fields:")
    example = _to_record_finding(findings[0])
    lines.append(json.dumps(example, ensure_ascii=False))
    return "\n".join(lines)