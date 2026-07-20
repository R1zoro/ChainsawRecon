from __future__ import annotations

"""Deterministic mapping decisions used to constrain, not replace, the LLM."""

from dataclasses import dataclass
from typing import Iterable

from .recon_db import SurfaceRecord


@dataclass(frozen=True)
class MappingPhase:
    name: str
    complete_when: str
    priority: int


@dataclass(frozen=True)
class MappingSnapshot:
    phase: MappingPhase
    known_hosts: int
    known_routes: int
    api_routes: int
    authenticated_routes: int
    recommended_focus: tuple[str, ...]


class MappingCoordinator:
    """Select the next mapping gap from evidence, not tool history.

    The coordinator deliberately does not execute network actions.  It gives the
    model a compact mission and leaves the model to choose the lawful, scoped
    experiment that fills the gap.
    """

    phases = (
        MappingPhase("asset-discovery", "at least one in-scope host is evidenced", 1),
        MappingPhase("service-fingerprinting", "each selected host has a service or technology observation", 2),
        MappingPhase("route-mapping", "representative application routes are evidenced", 3),
        MappingPhase("auth-and-browser", "guest and available authenticated paths are distinguished", 4),
        MappingPhase("source-correlation", "available source or client evidence is linked to routes", 5),
    )

    def assess(self, surfaces: Iterable[SurfaceRecord], *, technology_count: int = 0,
               browser_capture_count: int = 0, source_asset_count: int = 0) -> MappingSnapshot:
        values = list(surfaces)
        hosts = {item.host for item in values if item.host and item.host != "local"}
        api_routes = sum(item.surface_type in {"api", "graphql"} for item in values)
        authenticated = sum(item.auth_context not in {"", "unknown", "public", "guest"} for item in values)
        if not hosts:
            phase = self.phases[0]
            focus = ("establish in-scope hosts from durable evidence",)
        elif technology_count == 0:
            phase = self.phases[1]
            focus = ("collect one bounded response or local artifact per representative host",)
        elif not values:
            phase = self.phases[2]
            focus = ("map public routes and API entry points before exploit testing",)
        elif browser_capture_count == 0 and authenticated == 0:
            phase = self.phases[3]
            focus = ("separate guest and authorized browser paths when an auth context is available",)
        elif source_asset_count == 0:
            phase = self.phases[4]
            focus = ("inspect available client artifacts or source only; do not infer missing code",)
        else:
            phase = self.phases[4]
            focus = ("correlate source, browser, and observed routes; identify evidence gaps",)
        return MappingSnapshot(phase, len(hosts), len(values), api_routes, authenticated, focus)
