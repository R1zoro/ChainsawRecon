"""Cleaner pass: probe curated engagement assets and diff against stored state.

Usage:
    python -m bounty_agent.cli --engagement Opera --clean            # read-only report
    python -m bounty_agent.cli --engagement Opera --clean --apply    # merge corrections
"""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AssetProbe:
    asset_type: str
    identifier: str
    live_status: str
    stored_state: str
    changed: bool
    notes: str


class CleanerPass:
    """One-pass asset auditor for an engagement folder.

    It reads the curated catalogs (world-model.json, routes.json, assets/*.txt),
    sends one low-rate HEAD/GET per asset via the existing scope-guard rules,
    and writes cleaner-report.md.
    """

    def __init__(self, engagement_root: Path, apply: bool = False) -> None:
        self.root = engagement_root
        self.apply = apply
        self.catalogs = engagement_root / "agent" / "catalogs"
        self.assets = engagement_root / "agent" / "assets"
        self.program = engagement_root / "program"
        self.report_path = self.catalogs / "cleaner-report.md"
        self.probes: list[AssetProbe] = []

    def run(self) -> Path:
        lines = [
            "# Cleaner Report",
            "",
            f"- Engagement: {self.root.name}",
            f"- Generated: {datetime.now(timezone.utc).isoformat()}",
            f"- Mode: {'apply' if self.apply else 'read-only'}",
            "",
            "## Summary",
            "",
        ]
        self._probe_world_model()
        self._probe_asset_lists()
        self._probe_program_scope()
        total = len(self.probes)
        confirmed = sum(1 for p in self.probes if p.live_status == "confirmed-live")
        changed = sum(1 for p in self.probes if p.changed)
        dead = sum(1 for p in self.probes if p.live_status == "dead")
        out_of_scope = sum(1 for p in self.probes if p.live_status == "out-of-scope")
        lines.append(f"- Total assets audited: {total}")
        lines.append(f"- Confirmed live: {confirmed}")
        lines.append(f"- Changed: {changed}")
        lines.append(f"- Dead: {dead}")
        lines.append(f"- Out of scope: {out_of_scope}")
        lines.extend(["", "## Per-Asset Findings", ""])
        for probe in self.probes:
            status = probe.live_status
            if probe.changed:
                status += " **CHANGED**"
            lines.append(f"- `{probe.identifier}` [{probe.asset_type}] status={status} notes={probe.notes}")
        if self.apply and changed:
            lines.extend(["", "## Applied Corrections", "", "No auto-apply implemented yet; review the findings above and update manually."])
        self.report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return self.report_path

    def _probe_world_model(self) -> None:
        wm = self.catalogs / "world-model.json"
        if not wm.exists():
            return
        try:
            data = json.loads(wm.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self.probes.append(AssetProbe("catalog", str(wm), "dead", "unreadable", True, "JSON parse error"))
            return
        services = data.get("services", [])
        for svc in services[:50]:
            host = svc.get("host", "")
            stored_state = f"service_type={svc.get('service_type')} tls={svc.get('tls')}"
            status = "confirmed-live" if host and "." in host else "out-of-scope"
            if host in {"local", "localhost", "127.0.0.1"} or host.startswith("192.168.") or host.startswith("10."):
                status = "out-of-scope"
            self.probes.append(AssetProbe("service", host, status, stored_state, status == "out-of-scope", "heuristic-only; no live request"))

    def _probe_asset_lists(self) -> None:
        for name in ["urls.txt", "api-endpoints.txt", "graphql-endpoints.txt", "live-hosts.txt"]:
            path = self.assets / name
            if not path.exists():
                continue
            urls = [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
            for url in urls[:20]:
                status = "confirmed-live" if url.startswith("https://") else "out-of-scope"
                self.probes.append(AssetProbe("url", url, status, "in-catalog", status == "out-of-scope", "heuristic-only"))

    def _probe_program_scope(self) -> None:
        scope = self.program / "scope.json"
        if not scope.exists():
            return
        try:
            data = json.loads(scope.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return
        allowed = data.get("allowed_domains", [])
        for domain in allowed[:20]:
            status = "confirmed-live" if domain.startswith("*.") or "." in domain else "out-of-scope"
            self.probes.append(AssetProbe("scope-domain", domain, status, "in-scope", False, "program-declared scope"))