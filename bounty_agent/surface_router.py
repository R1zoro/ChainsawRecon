from __future__ import annotations

"""Surface router with fingerprint layer + fallback ladder.

A flat surface-type -> tool matrix breaks on arbitrary surfaces: there are n
surface shapes and each behaves differently. This module instead builds an
ORDERED FALLBACK LADDER per surface: fingerprint the surface (technology +
classification), then emit an ordered list of (tool/tactic) rungs. The agent
walks the ladder top-down; when a rung fails (error, blocked, empty) it drops
to the next rung instead of repeating the dead one.

The ladder composes three signals:
  1. surface classification  (canonical_surface.classify_surface_type)
  2. technology fingerprint  (technologies.detect_technology_observations)
  3. observed tool outcomes  (which rungs already failed for this surface)

It answers: "given this surface, what's the next thing to try, and what did we
already burn?"
"""

from dataclasses import dataclass, field
from typing import Any

from .canonical_surface import classify_surface_type
from .technologies import TechnologyObservation, detect_technology_observations, get_playbook


@dataclass(frozen=True)
class LadderRung:
    """One step in a fallback ladder."""

    tool: str            # tool action name (httpx, katana, nuclei, dalfox, ...) or tactic
    purpose: str         # one-line reason this rung is on the ladder
    requires_browser: bool = False


@dataclass
class SurfaceRoute:
    """Fingerprint + ordered fallback ladder for one surface."""

    host: str
    path: str
    surface_type: str                        # api | graphql | auth | js | upload | redirect | version | web | docs | passive
    technologies: tuple[str, ...] = ()
    ladder: list[LadderRung] = field(default_factory=list)
    burned: list[str] = field(default_factory=list)  # rung tools already failed
    focus: list[str] = field(default_factory=list)   # playbook focus areas

    def next_rung(self) -> LadderRung | None:
        """First ladder rung whose tool has not already failed for this surface."""
        for rung in self.ladder:
            if rung.tool not in self.burned:
                return rung
        return None

    def burn(self, tool: str) -> None:
        """Mark a rung's tool as failed so next_rung skips it."""
        if tool not in self.burned:
            self.burned.append(tool)


# Static fallback ladders keyed by surface classification.  Order matters: the
# first rung is the cheap/passive probe, later rungs are more invasive.
_CLASSIFICATION_LADDERS: dict[str, tuple[tuple[str, str], ...]] = {
    "graphql": (
        ("inql", "introspect GraphQL schema"),
        ("clairvoyance", "recover schema when introspection is off"),
        ("httpx", "probe endpoint directly for auth behaviour"),
        ("browser_map", "map the SPA that fronts this GraphQL API"),
    ),
    "api": (
        ("httpx", "fingerprint status/headers/tech"),
        ("katana", "crawl for linked API routes"),
        ("nuclei", "templated known-vuln checks"),
        ("browser_map", "map the front end when API needs a session"),
    ),
    "auth": (
        ("httpx", "observe auth flow and cookie/redirect behaviour"),
        ("wafw00f", "detect WAF/rate-limit posture"),
        ("browser_map", "drive the login journey"),
        ("nuclei", "check for known auth-bypass templates"),
    ),
    "js": (
        ("httpx", "fetch the bundle"),
        ("katana", "extract JS-linked endpoints"),
        ("browser_map", "render and capture runtime XHR"),
    ),
    "upload": (
        ("httpx", "probe the upload endpoint"),
        ("nuclei", "templated file-upload checks"),
    ),
    "redirect": (
        ("httpx", "follow and classify redirect"),
        ("nuclei", "templated open-redirect checks"),
    ),
    "version": (
        ("httpx", "grab headers/server version"),
        ("whatweb", "fingerprint framework"),
        ("nuclei", "match version to known CVEs"),
    ),
    "web": (
        ("httpx", "fingerprint status/headers/tech"),
        ("katana", "crawl for routes and parameters"),
        ("browser_map", "map interactive flows"),
        ("nuclei", "templated known-vuln checks"),
    ),
    "docs": (("httpx", "pull doc/spec for surface map"),),
    "passive": (("httpx", "fetch the passive file"),),
}

# Technology-driven extra rungs, appended ahead of the generic tail.  Keyed by
# the technology name produced by technologies.detect_technology_observations.
_TECH_LADDERS: dict[str, tuple[tuple[str, str], ...]] = {
    "GraphQL": (("inql", "introspect GraphQL schema"),),
    "Apollo": (("inql", "introspect Apollo GraphQL schema"),),
    "Hasura": (("clairvoyance", "probe Hasura metadata/role exposure"),),
    "WordPress": (("nuclei", "WordPress templated checks"),),
    "Laravel": (("httpx", "probe /_debugbar and storage paths"),),
    "Spring": (("httpx", "probe /actuator exposure"), ("nuclei", "Spring templated checks")),
    "Next.js": (("httpx", "probe /_next buildManifest and API routes"),),
    "Django": (("httpx", "probe /admin exposure"),),
}


def route_surface(
    url: str,
    *,
    response_headers: dict[str, str] | None = None,
    response_body: str = "",
    prior_failures: list[str] | None = None,
) -> SurfaceRoute:
    """Fingerprint a surface and build its ordered fallback ladder.

    Args:
        url: the surface URL.
        response_headers: observed response headers (from an earlier probe), if any.
        response_body: observed response body excerpt, if any.
        prior_failures: tool names that already failed against this surface.

    Returns a SurfaceRoute whose ``next_rung()`` gives the next action to try.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"

    is_docs, is_api, is_graphql, is_passive = classify_surface_type(host, path)
    if is_graphql:
        surface_type = "graphql"
    elif is_api:
        surface_type = "api"
    elif is_docs:
        surface_type = "docs"
    elif is_passive:
        surface_type = "passive"
    elif "/login" in path.lower() or "/signin" in path.lower() or "/auth" in path.lower():
        surface_type = "auth"
    elif "/upload" in path.lower():
        surface_type = "upload"
    elif path.lower().endswith((".js", ".js.map")):
        surface_type = "js"
    else:
        surface_type = "web"

    observations = detect_technology_observations(response_headers, response_body, url)
    tech_names = tuple(o.name for o in observations)

    ladder: list[LadderRung] = []
    for tech in observations:
        for tool, purpose in _TECH_LADDERS.get(tech.name, ()):
            _append_unique(ladder, tool, purpose)
    for tool, purpose in _CLASSIFICATION_LADDERS.get(surface_type, _CLASSIFICATION_LADDERS["web"]):
        _append_unique(ladder, tool, purpose)

    focus: list[str] = []
    for tech in observations:
        focus.extend(get_playbook(tech.name).get("focus", []))

    route = SurfaceRoute(
        host=host,
        path=path,
        surface_type=surface_type,
        technologies=tech_names,
        ladder=ladder,
        burned=list(prior_failures or []),
        focus=list(dict.fromkeys(focus)),
    )
    return route


def render_route(route: SurfaceRoute) -> str:
    """Compact, model-facing rendering of a surface route + fallback ladder."""
    lines = [f"surface: {route.host}{route.path}  type={route.surface_type}"]
    if route.technologies:
        lines.append(f"tech: {', '.join(route.technologies)}")
    if route.focus:
        lines.append(f"focus: {'; '.join(route.focus[:4])}")
    nxt = route.next_rung()
    lines.append(f"next: {nxt.tool} — {nxt.purpose}" if nxt else "next: none (ladder exhausted; escalate or move on)")
    if route.burned:
        lines.append(f"burned: {', '.join(route.burned)}")
    remaining = [r for r in route.ladder if r.tool not in route.burned]
    if len(remaining) > 1:
        lines.append("fallback: " + " -> ".join(r.tool for r in remaining[1:]))
    return "\n".join(lines)


def _append_unique(ladder: list[LadderRung], tool: str, purpose: str) -> None:
    if not any(r.tool == tool for r in ladder):
        ladder.append(LadderRung(tool=tool, purpose=purpose))