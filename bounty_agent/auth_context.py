"""Structured per-target authentication context.

Replaces the flat auth.txt approach with target-specific cookie groups,
headers, and linked HAR evidence files.  Each target can have multiple
cookie groups (e.g. "full session", "guest session") that must be used
together as a bundle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class CookieDef:
    name: str
    value: str
    domain: str | None = None
    path: str | None = None


@dataclass(frozen=True)
class CookieGroup:
    group_id: str
    cookies: list[CookieDef] = field(default_factory=list)
    headers: dict[str, str] = field(default_factory=dict)
    description: str = ""


@dataclass(frozen=True)
class TargetAuth:
    target: str
    cookie_groups: list[CookieGroup] = field(default_factory=list)
    har_evidence_paths: list[Path] = field(default_factory=list)
    notes: str = ""


@dataclass(frozen=True)
class AuthContext:
    targets: dict[str, TargetAuth] = field(default_factory=dict)
    notes: str = ""

    @classmethod
    def load(cls, path: Path) -> AuthContext:
        """Load structured auth context from a JSON file."""
        raw = json.loads(path.read_text(encoding="utf-8"))
        targets: dict[str, TargetAuth] = {}
        for target_url, target_raw in raw.get("targets", {}).items():
            groups = []
            for g in target_raw.get("cookie_groups", []):
                cookies = [
                    CookieDef(
                        name=c.get("name", ""),
                        value=c.get("value", ""),
                        domain=c.get("domain"),
                        path=c.get("path"),
                    )
                    for c in g.get("cookies", [])
                ]
                groups.append(
                    CookieGroup(
                        group_id=g.get("group_id", "default"),
                        cookies=cookies,
                        headers=g.get("headers", {}),
                        description=g.get("description", ""),
                    )
                )
            har_paths = [
                Path(p) if Path(p).is_absolute() else path.parent / p
                for p in target_raw.get("har_evidence_paths", [])
            ]
            targets[target_url] = TargetAuth(
                target=target_url,
                cookie_groups=groups,
                har_evidence_paths=har_paths,
                notes=target_raw.get("notes", ""),
            )
        return cls(targets=targets, notes=raw.get("notes", ""))

    def target_urls(self) -> list[str]:
        """Return all target URLs that have auth context."""
        return sorted(self.targets.keys())

    def has_auth_for(self, target: str) -> bool:
        """Check if any target pattern matches the given URL/host."""
        return self._find_target(target) is not None

    def build_prompt_section(self, target: str) -> str:
        """Build a compact prompt section for the given target showing available auth groups."""
        ta = self._find_target(target)
        if not ta:
            return ""
        lines = [
            f"Authenticated context is available for {ta.target}.",
            "Available cookie groups:",
        ]
        for group in ta.cookie_groups:
            cookie_names = ", ".join(c.name for c in group.cookies)
            lines.append(
                f"  - group: {group.group_id} ({len(group.cookies)} cookies: {cookie_names})"
                f" — {group.description}"
            )
        if ta.har_evidence_paths:
            lines.append("Linked HAR evidence files (imported as local observations):")
            for p in ta.har_evidence_paths:
                if p.exists():
                    lines.append(f"  - {p.name} ({p.stat().st_size} bytes)")
                else:
                    lines.append(f"  - {p.name} (file not found)")
        lines.append(
            'To use a specific cookie group include "auth_group": "<group_id>" '
            "in your bash action JSON."
        )
        return "\n".join(lines)

    def cookie_header_for_group(self, target: str, group_id: str) -> str:
        """Build a Cookie header string for a specific group on a target."""
        ta = self._find_target(target)
        if not ta:
            return ""
        for group in ta.cookie_groups:
            if group.group_id == group_id:
                parts = [f"{c.name}={c.value}" for c in group.cookies]
                return "; ".join(parts)
        return ""

    def extra_headers_for_group(self, target: str, group_id: str) -> dict[str, str]:
        """Return extra headers (e.g. Authorization) for a specific group."""
        ta = self._find_target(target)
        if not ta:
            return {}
        for group in ta.cookie_groups:
            if group.group_id == group_id:
                return dict(group.headers)
        return {}

    def _find_target(self, target: str) -> TargetAuth | None:
        target_lower = target.lower().rstrip("/")
        for url, ta in self.targets.items():
            url_lower = url.lower().rstrip("/")
            if url_lower == target_lower:
                return ta
            if target_lower.startswith(url_lower):
                return ta
            target_host = urlparse(target).hostname or ""
            auth_host = urlparse(url).hostname or ""
            if target_host and auth_host and target_host == auth_host:
                return ta
        return None