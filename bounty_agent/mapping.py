from __future__ import annotations

"""Model-driven mapping decisions.

The coordinator gives the model a compact mission based on evidence gaps and
leaves the model to choose the lawful, scoped experiment that fills the gap.
Mapping state is stored in the run workspace as artifacts and in the engagement
state store as validated evidence. At end-of-run, validated mapping data is
promoted to the engagement-wide knowledge base.
"""

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
    suggested_actions: tuple[str, ...]


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
            actions = ("browser_map", "httpx", "use_skill:target_mapping")
        elif technology_count == 0:
            phase = self.phases[1]
            focus = ("collect one bounded response or local artifact per representative host",)
            actions = ("httpx", "whatweb", "wafw00f", "browser_map")
        elif not values:
            phase = self.phases[2]
            focus = ("map public routes and API entry points before exploit testing",)
            actions = ("katana", "gau", "waybackurls", "browser_map")
        elif browser_capture_count == 0 and authenticated == 0:
            phase = self.phases[3]
            focus = ("separate guest and authorized browser paths when an auth context is available",)
            actions = ("browser_map", "use_skill:target_mapping")
        elif source_asset_count == 0:
            phase = self.phases[4]
            focus = ("inspect available client artifacts or source only; do not infer missing code",)
            actions = ("katana", "browser_map", "use_skill:source_analysis")
        else:
            phase = self.phases[4]
            focus = ("correlate source, browser, and observed routes; identify evidence gaps",)
            actions = ("search_artifact", "read_artifact_slice", "browser_map")
        return MappingSnapshot(phase, len(hosts), len(values), api_routes, authenticated, focus, tuple(actions))
