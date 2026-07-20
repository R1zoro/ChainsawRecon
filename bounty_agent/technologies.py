from __future__ import annotations

"""Deterministic technology fingerprints and their testing implications."""

from dataclasses import dataclass
import re
from typing import Any


@dataclass(frozen=True)
class TechnologyObservation:
    name: str
    category: str
    confidence: str
    evidence: tuple[str, ...]
    version: str | None = None


_SIGNATURES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Laravel", "framework", ("laravel", "laravel_session", "illuminate", "_debugbar")),
    ("Spring", "framework", ("springframework", "spring boot", "whitelabel error page")),
    ("Rails", "framework", ("ruby on rails", "_rails_session", "actionpack")),
    ("Django", "framework", ("django", "csrftoken", "__django")),
    ("Flask", "framework", ("flask", "werkzeug")),
    ("ASP.NET", "framework", ("asp.net", "__requestverificationtoken", "aspnet")),
    ("Express", "framework", ("x-powered-by: express", "express-session")),
    ("Next.js", "framework", ("_next/", "__next_data__", "next.js")),
    ("GraphQL", "api", ("graphql", "application/graphql", "__schema")),
    ("Apollo", "graphql", ("apollo-client", "apollo-server", "apollo")),
    ("Hasura", "graphql", ("x-hasura", "hasura")),
    ("Cloudflare", "cdn", ("cf-ray", "cloudflare", "cf-cache-status", "__cf_bm")),
    ("Nginx", "server", ("server: nginx", "nginx/")),
    ("Apache", "server", ("server: apache", "apache/")),
    ("PHP", "language", ("x-powered-by: php", "phpsessid", ".php")),
    ("Node.js", "runtime", ("node.js", "nodejs", "express")),
    ("Python", "language", ("uwsgi", "gunicorn", "wsgi")),
    ("Java", "language", ("jsessionid", "java/", "tomcat")),
    ("React", "frontend", ("reactdom", "react", "__react")),
    ("Vue", "frontend", ("vue.js", "vuejs", "data-v-")),
    ("Angular", "frontend", ("angular", "ng-version")),
    ("WordPress", "cms", ("wp-content", "wp-includes", "wordpress")),
)


_PLAYBOOKS: dict[str, dict[str, Any]] = {
    "Laravel": {"focus": ["route and auth middleware", "debug exposure", "file handling", "API authorization"], "paths": ["/_debugbar", "/api", "/storage"]},
    "Spring": {"focus": ["actuator exposure", "authorization annotations", "error handling", "deserialization boundaries"], "paths": ["/actuator", "/api"]},
    "Rails": {"focus": ["controller authorization", "mass assignment", "active storage", "session handling"], "paths": ["/rails", "/api"]},
    "Django": {"focus": ["CSRF boundaries", "admin exposure", "object authorization", "debug behavior"], "paths": ["/admin", "/api"]},
    "ASP.NET": {"focus": ["anti-forgery protection", "authorization policies", "view state", "debug error handling"], "paths": ["/api"]},
    "Next.js": {"focus": ["server actions", "API routes", "middleware", "source-map and configuration exposure"], "paths": ["/_next", "/api"]},
    "GraphQL": {"focus": ["schema visibility", "field authorization", "object authorization", "mutation authorization"], "paths": ["/graphql", "/api/graphql"]},
    "Apollo": {"focus": ["resolver authorization", "persisted queries", "schema visibility", "mutation authorization"], "paths": ["/graphql"]},
    "Hasura": {"focus": ["role enforcement", "row-level authorization", "metadata exposure", "admin-secret handling"], "paths": ["/v1/graphql", "/console"]},
    "Cloudflare": {"focus": ["cache semantics", "origin exposure", "WAF-aware rate control"], "paths": ["/cdn-cgi/"]},
}


def detect_technology_observations(headers: dict[str, str] | None, body: str, url: str) -> list[TechnologyObservation]:
    normalized_headers = headers or {}
    header_text = "\n".join(f"{key}: {value}" for key, value in normalized_headers.items())
    corpus = f"{header_text}\n{url}\n{body}".lower()
    observations: list[TechnologyObservation] = []
    for name, category, indicators in _SIGNATURES:
        matches = tuple(indicator for indicator in indicators if indicator.lower() in corpus)
        if matches:
            confidence = "confirmed" if len(matches) > 1 else "observed"
            observations.append(TechnologyObservation(name, category, confidence, matches, _extract_version(name, header_text)))
    return _dedupe(observations)


def detect_technologies(headers: dict[str, str], body: str, url: str) -> list[dict[str, str]]:
    """Compatibility adapter used by older callers."""
    return [
        {"name": item.name, "category": item.category, "confidence": item.confidence, "version": item.version or ""}
        for item in detect_technology_observations(headers, body, url)
    ]


def get_playbook(technology: str) -> dict[str, Any]:
    return _PLAYBOOKS.get(technology, {"focus": ["authorization", "input handling", "session behavior"], "paths": []})


def _dedupe(values: list[TechnologyObservation]) -> list[TechnologyObservation]:
    result: dict[str, TechnologyObservation] = {}
    for item in values:
        previous = result.get(item.name)
        if previous is None or item.confidence == "confirmed":
            result[item.name] = item
    return sorted(result.values(), key=lambda item: (item.category, item.name))


def _extract_version(name: str, headers: str) -> str | None:
    if name not in {"Nginx", "Apache", "PHP"}:
        return None
    pattern = rf"{re.escape(name.lower())}[ /]([0-9][A-Za-z0-9._-]+)"
    match = re.search(pattern, headers.lower())
    return match.group(1) if match else None
