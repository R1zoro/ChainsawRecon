"""Report drafts derived from the session projection and project model."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .appmodel import AppModel
from .projection import SessionProjection
from .workspace import ProjectMeta, SessionMeta


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cell(value: Any) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ")


def generate_report(
    project: ProjectMeta,
    session: SessionMeta,
    projection: SessionProjection,
    *,
    include_candidates: bool = False,
) -> dict[str, Any]:
    findings = projection.findings()
    hypotheses = projection.hypotheses()
    evidence = projection.evidence()
    tasks = projection.tasks()
    selected = [
        item
        for item in findings
        if item.get("state") == "validated"
        or (include_candidates and item.get("state") == "candidate")
    ]
    selected.sort(
        key=lambda item: (
            {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}.get(
                str(item.get("severity", "info")), 5
            ),
            str(item.get("title", "")),
        )
    )
    evidence_by_id = {str(item["id"]): item for item in evidence}
    coverage: dict[str, Any] = {}
    try:
        model = AppModel(project.path / ".chainsaw" / "knowledge.db", project.id)
        try:
            coverage = model.coverage_summary()
            app_summary = model.summary()
        finally:
            model.close()
    except Exception:
        app_summary = {}

    lines = [
        f"# {project.name} — Security Assessment",
        "",
        f"**Session:** {session.title} (`{session.id}`)",
        f"**Generated:** {_now()}",
        f"**Scope:** {', '.join(project.targets) or 'not recorded'}",
        "",
        "## Summary",
        "",
        f"- Validated findings: {sum(1 for item in findings if item.get('state') == 'validated')}",
        f"- Candidate findings: {sum(1 for item in findings if item.get('state') == 'candidate')}",
        f"- Rejected findings: {sum(1 for item in findings if item.get('state') == 'rejected')}",
        f"- Hypotheses: {len(hypotheses)}",
        f"- Evidence artifacts: {len(evidence)}",
        f"- Tasks: {len(tasks)}",
        f"- Coverage entries: {coverage.get('entries', 0)}",
        f"- Coverage gaps: {len(coverage.get('gaps', []))}",
        "",
        "## Findings",
        "",
    ]
    if not selected:
        lines.append("No validated findings are recorded for this session.")
    else:
        lines.extend(
            [
                "| Severity | Finding | Asset | Evidence |",
                "|---|---|---|---|",
            ]
        )
        for finding in selected:
            lines.append(
                "| "
                + " | ".join(
                    [
                        _cell(str(finding.get("severity", "")).upper()),
                        _cell(finding.get("title", "")),
                        _cell(finding.get("asset", "")),
                        str(len(finding.get("evidenceIds") or [])),
                    ]
                )
                + " |"
            )
        lines.append("")
        for index, finding in enumerate(selected, 1):
            lines.extend(
                [
                    f"### {index}. {finding.get('title', 'Untitled')}",
                    "",
                    f"- **Severity:** {finding.get('severity', 'unknown')}",
                    f"- **State:** {finding.get('state', 'unknown')}",
                    f"- **Asset:** {finding.get('asset', '')}",
                    f"- **Hypothesis:** {finding.get('hypothesisId') or '—'}",
                    f"- **Evidence version:** {finding.get('evidenceVersion', 0)}",
                    "",
                ]
            )
            bindings = {
                str(item["evidenceId"]): item
                for item in projection.finding_evidence(str(finding.get("id", "")))
            }
            for evidence_id in finding.get("evidenceIds") or []:
                item = evidence_by_id.get(str(evidence_id))
                binding = bindings.get(str(evidence_id), {})
                if item:
                    lines.append(
                        f"- **{str(binding.get('role') or 'supporting').title()}** "
                        f"`{evidence_id}`: {item.get('summary', '')} "
                        f"(`{item.get('hash', '')}`)"
                    )
            lines.append("")

    lines.extend(["## Hypotheses", ""])
    if not hypotheses:
        lines.append("No hypotheses recorded.")
    else:
        for hypothesis in hypotheses:
            lines.append(
                f"- **{hypothesis.get('title', 'Untitled')}** — "
                f"{hypothesis.get('state', 'unknown')} — "
                f"{hypothesis.get('securityQuestion', '')}"
            )
    lines.extend(["", "## Coverage", ""])
    outcomes = coverage.get("outcomes") or {}
    if outcomes:
        for outcome, count in sorted(outcomes.items()):
            lines.append(f"- {outcome}: {count}")
    else:
        lines.append("No coverage has been recorded. Absence of a finding is not evidence of a clean target.")
    gaps = coverage.get("gaps") or []
    if gaps:
        lines.extend(["", "### Open coverage gaps", ""])
        for gap in gaps[:50]:
            lines.append(
                f"- {gap.get('kind')}: {gap.get('surface', gap.get('entityId', ''))} "
                f"({gap.get('riskArea', '')})"
            )
    lines.extend(["", "## Evidence Appendix", ""])
    if not evidence:
        lines.append("No evidence artifacts recorded.")
    else:
        for item in evidence:
            lines.append(
                f"- `{item.get('id')}` — {item.get('summary', '')} — "
                f"hash `{item.get('hash', '')}` — artifact `{item.get('artifactId', '')}`"
            )
    lines.extend(
        [
            "",
            "## Limitations",
            "",
            "- This draft is generated from the session projection, not from an independent review.",
            "- Candidate findings are excluded unless explicitly included.",
            "- Absence of a finding does not prove a target is secure; consult the coverage gaps.",
            "",
        ]
    )
    markdown = "\n".join(lines)
    payload = {
        "projectId": project.id,
        "sessionId": session.id,
        "generatedAt": _now(),
        "includeCandidates": include_candidates,
        "markdown": markdown,
        "findings": selected,
        "hypotheses": hypotheses,
        "evidence": evidence,
        "coverage": coverage,
        "appModel": app_summary,
    }
    return payload


def save_report(payload: dict[str, Any], artifacts_dir: Path) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = artifacts_dir / f"report-{stamp}.md"
    path.write_text(str(payload["markdown"]), encoding="utf-8")
    return path


def render_html(payload: dict[str, Any]) -> str:
    try:
        import markdown  # type: ignore[import-untyped]
    except ImportError:
        body = f"<pre>{payload['markdown']}</pre>"
    else:
        body = markdown.markdown(
            str(payload["markdown"]),
            extensions=["tables", "fenced_code", "sane_lists"],
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{payload.get("projectId", "Report")} — {payload.get("sessionId", "")}</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
         max-width: 980px; margin: 3rem auto; padding: 0 1.25rem; color: #1f2937; line-height: 1.55; }}
  h1, h2, h3 {{ line-height: 1.2; }}
  h1 {{ border-bottom: 2px solid #e5e7eb; padding-bottom: .5rem; }}
  code, pre {{ font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }}
  pre {{ background: #f8fafc; border: 1px solid #e5e7eb; padding: 1rem; overflow: auto; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
  th, td {{ border: 1px solid #e5e7eb; padding: .5rem .65rem; text-align: left; vertical-align: top; }}
  th {{ background: #f1f5f9; }}
  blockquote {{ border-left: 3px solid #cbd5e1; margin-left: 0; padding-left: 1rem; color: #475569; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""
