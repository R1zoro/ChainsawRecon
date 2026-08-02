"""Endpoint exhaustion tracker and auth-gate classifier for Milestone 2."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SurfaceOutcome:
    surface_key: str
    host: str
    path: str
    outcome: str
    auth_context: str


class EndpointExhaustionTracker:
    """Counts negative outcomes per (host,path) and signals when an endpoint is exhausted."""

    EXHAUSTION_THRESHOLD = 3
    NEGATIVE_OUTCOMES = frozenset({"rejected", "error", "blocked", "auth_gate"})

    def __init__(self) -> None:
        self._counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        self._exhausted: set[tuple[str, str]] = set()

    def record(self, outcome: SurfaceOutcome) -> None:
        key = (outcome.host.lower(), outcome.path.lower())
        if outcome.outcome in self.NEGATIVE_OUTCOMES:
            self._counts[key][outcome.outcome] += 1
            total_negatives = sum(self._counts[key].values())
            if total_negatives >= self.EXHAUSTION_THRESHOLD:
                self._exhausted.add(key)

    def is_exhausted(self, host: str, path: str) -> bool:
        return (host.lower(), path.lower()) in self._exhausted

    def exhaustion_reason(self, host: str, path: str) -> str | None:
        key = (host.lower(), path.lower())
        if key not in self._exhausted:
            return None
        counts = self._counts.get(key, Counter())
        parts = [f"{outcome}={count}" for outcome, count in counts.most_common()]
        return f"ENDPOINT EXHAUSTED: {host}{path} repeated negatives: {'; '.join(parts)}"

    def prune_exhausted(self, surfaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [surface for surface in surfaces if not self.is_exhausted(surface.get("host", ""), surface.get("path_pattern", ""))]


@dataclass
class AuthGateClassifier:
    """Classify auth-gate responses and suggest pivots."""

    AUTH_GATE_MARKERS = frozenset([
        "sign in", "log in", "login", "sign-in", "sign_in",
        "authentication required", "authorization required",
        "access denied", "please log in", "please sign in",
        "session expired", "invalid session", "unauthorized",
        "401 unauthorized", "403 forbidden",
        "sso", "oauth", "saml", "okta", "auth0",
        "cloudflare access", "access challenge",
    ])

    def classify(self, content: str, surface_type: str, auth_context: str) -> str:
        if auth_context and auth_context not in {"public", "unknown"}:
            return auth_context
        lowered = content.lower()
        for marker in self.AUTH_GATE_MARKERS:
            if marker in lowered:
                return "auth_gate"
        if surface_type == "auth":
            return "auth_gate"
        return auth_context or "public"

    def is_auth_gate(self, auth_context: str) -> bool:
        return auth_context == "auth_gate"