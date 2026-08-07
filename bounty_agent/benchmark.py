"""Milestone 5.2 — Evaluation harness: vulnerable-lab benchmark + scorecard.

Provides a Scorecard that tracks how the agent performs across the gates
that each milestone hardened (M2 7-Question Gate, M4.1 rate limits,
M4.2 cross-model adjudication, M3 skill usage) against a known-vulnerable
target such as OWASP Juice Shop or DVWA. Results are emitted as scorecard.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import json


# Known vulnerability categories present in OWASP Juice Shop (a representative
# benchmark target). Each maps to the finding that should be recorded.
JUICE_SHOP_EXPECTED_FINDINGS = [
    {
        "id": "juice-reflected-xss",
        "title": "Reflected XSS in search",
        "category": "xss",
        "vrt": "P2 Cross-Site Scripting (Reflected)",
        "endpoint": "/rest/product/5/search",
    },
    {
        "id": "juice-idor-rest",
        "title": "IDOR on REST endpoint /rest/basket/:id",
        "category": "idor",
        "vrt": "P2.2 IDOR",
        "endpoint": "/rest/basket/1",
    },
    {
        "id": "juice-ssti",
        "title": "Server-side template injection score",
        "category": "ssti",
        "vrt": "P2 Server-Side Template Injection",
        "endpoint": "/rest/feedback",
    },
    {
        "id": "juice-sql-comment",
        "title": "SQLi in /rest/user/login with SQL comment",
        "category": "sqli",
        "vrt": "P2.1 SQL Injection",
        "endpoint": "/rest/user/login",
    },
    {
        "id": "juice-qs-injection",
        "title": "QS injection / weak password reset",
        "category": "reset",
        "vrt": "P2 Authentication Break",
        "endpoint": "/rest/user/reset-password",
    },
    {
        "id": "juice-secrets",
        "title": "Source code / secrets exposure",
        "category": "secrets",
        "vrt": "P3 Information Disclosure",
        "endpoint": "/etc/passwd",
    },
]


@dataclass
class ScorecardEvent:
    """One measured event during a benchmark run."""
    phase: str            # m2_gate | m3_skill | m4_rate | m4_adjud | m5_proxy
    name: str             # human label
    passed: bool
    detail: str = ""
    metric: str = ""       # e.g. "finding_recorded", "false_positive_blocked"
    value: float | None = None


@dataclass
class Scorecard:
    """Accumulates benchmark measurements and emits a markdown report."""
    target: str
    target_type: str = "juice-shop"  # or "dvwa"
    events: list[ScorecardEvent] = field(default_factory=list)
    expected_findings: list[dict[str, Any]] = field(default_factory=list)
    recorded_findings: list[dict[str, Any]] = field(default_factory=list)
    start_time: str = ""

    def __post_init__(self) -> None:
        if not self.expected_findings:
            self.expected_findings = list(JUICE_SHOP_EXPECTED_FINDINGS)

    def record(self, event: ScorecardEvent) -> None:
        self.events.append(event)

    def record_finding(self, finding: dict[str, Any]) -> None:
        self.recorded_findings.append(finding)

    def _true_positives(self) -> tuple[int, list[str]]:
        matched: list[str] = []
        for finding in self.recorded_findings:
            title = str(finding.get("title", "")).lower()
            for expected in self.expected_findings:
                if expected["category"].lower() in title or expected["endpoint"] in str(finding.get("evidence", "")):
                    if expected["id"] not in matched:
                        matched.append(expected["id"])
                    break
        return len(matched), matched

    def _false_positives_blocked(self) -> int:
        """Count findings that were correctly rejected by gates/adjudication."""
        return sum(
            1 for e in self.events
            if e.metric == "finding_rejected" and e.passed
        )

    def _rate_limit_hits(self) -> int:
        return sum(1 for e in self.events if e.metric == "rate_limit_hit")

    def to_dict(self) -> dict[str, Any]:
        tp, matched = self._true_positives()
        fpr_blocked = self._false_positives_blocked()
        rate_hits = self._rate_limit_hits()
        total_expected = len(self.expected_findings)
        total_events = len(self.events)
        tp_rate = (tp / total_expected * 100.0) if total_expected else 0.0
        return {
            "target": self.target,
            "target_type": self.target_type,
            "started_at": self.start_time,
            "recall": {
                "true_positives": tp,
                "expected_findings": total_expected,
                "matched_ids": matched,
                "recall_pct": round(tp_rate, 1),
            },
            "precision": {
                "false_positives_blocked": fpr_blocked,
                "recorded_findings": len(self.recorded_findings),
            },
            "controls": {
                "rate_limit_hits": rate_hits,
                "total_events": total_events,
            },
            "events": [
                {"phase": e.phase, "name": e.name, "passed": e.passed,
                 "metric": e.metric, "value": e.value, "detail": e.detail}
                for e in self.events
            ],
        }

    def to_markdown(self) -> str:
        d = self.to_dict()
        lines = [
            f"# Benchmark Scorecard — {self.target_type}",
            f"",
            f"**Target:** `{d['target']}`",
            f"**Started:** {d['started_at'] or 'n/a'}",
            "",
            "## Recall (Milestone 2 + 3 gates)",
            f"- Expected findings: {d['recall']['expected_findings']}",
            f"- True positives found: {d['recall']['true_positives']}",
            f"- **Recall: {d['recall']['recall_pct']}%**",
            f"- Matched: {', '.join(d['recall']['matched_ids']) or 'none'}",
            "",
            "## Precision (M4.2 adjudicator + 7-Question Gate)",
            f"- Findings recorded: {d['precision']['recorded_findings']}",
            f"- False positives blocked by gates: {d['precision']['false_positives_blocked']}",
            "",
            "## Controls (M4.1 rate limiting)",
            f"- Rate-limit hits (429/403) observed: {d['controls']['rate_limit_hits']}",
            f"- Total events tracked: {d['controls']['total_events']}",
            "",
            "## Events",
        ]
        if not d["events"]:
            lines.append("_(no events recorded)_")
        for ev in d["events"]:
            mark = "PASS" if ev["passed"] else "FAIL"
            val = f" = {ev['value']}" if ev["value"] is not None else ""
            metric_str = f" ({ev['metric']})" if ev["metric"] else ""
            lines.append(f"- **[{ev['phase']}]** {ev['name']} — {mark}{val}{metric_str}")
        return "\n".join(lines) + "\n"

    def save(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_markdown(), encoding="utf-8")
        json_path = path.with_suffix(".json")
        json_path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path


def run_benchmark(
    target: str,
    scope_path: Path | None = None,
    output_dir: Path | None = None,
    *,
    dry: bool = True,
) -> Scorecard:
    """Run the benchmark harness.

    In dry mode (default) it seeds the scorecard with the expected findings
    and emits a report template without executing the agent. In live mode it
    would drive BountyAgent against the target and measure the gates.

    Args:
        target: The benchmark target URL (e.g. http://localhost:3000 for Juice Shop).
        scope_path: Optional scope JSON to derive allowed domains.
        output_dir: Where to write scorecard.md. Defaults to ./benchmarks.
        dry: If True, emit a scorecard template with expected findings only.
    """
    import datetime

    scorecard = Scorecard(
        target=target,
        target_type="juice-shop" if "juice" in target.lower() else "dvwa",
        expected_findings=list(JUICE_SHOP_EXPECTED_FINDINGS),
        start_time=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    )

    if dry:
        # Seed expected findings as 'not yet found'
        for expected in scorecard.expected_findings:
            scorecard.record(ScorecardEvent(
                phase="m5_harness",
                name=f"expected_finding:{expected['id']}",
                passed=False,
                detail=f"{expected['category']} @ {expected['endpoint']}",
                metric="finding_expected",
                value=0.0,
            ))
    else:
        # Live mode: import and drive the agent
        from .agent import BountyAgent
        from .config import ProgramScope
        scope = ProgramScope.from_file(scope_path) if scope_path else ProgramScope(
            program_name="benchmark", allowed_domains=[_host(target)]
        )
        agent = BountyAgent(scope, target, None, output_dir or Path("benchmarks"))
        agent.run(scorecard=scorecard)

    out_dir = output_dir or Path("benchmarks")
    return scorecard.save(out_dir / "scorecard.md")


def _host(url: str) -> str:
    from urllib.parse import urlparse
    try:
        return urlparse(url).hostname or url
    except Exception:
        return url
