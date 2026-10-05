from __future__ import annotations

"""The Phase 2 engagement topology.

The world model is deliberately a small relational graph over the durable
engagement ReconStore.  SQLite is sufficient here: relationships are explicit,
queryable, exportable, and do not impose a graph-server dependency on a laptop.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from .recon_db import ReconStore, SurfaceRecord, is_noise_host


@dataclass(frozen=True)
class Organization:
    id: str
    name: str
    domain: str | None = None


@dataclass(frozen=True)
class Application:
    id: str
    org_id: str
    name: str
    framework: str | None = None
    language: str | None = None
    frontend: str | None = None
    cdn_waf: str | None = None
    hosting: str | None = None
    api_style: str | None = None
    graphql_impl: str | None = None
    auth_provider: str | None = None
    version: str | None = None
    confidence: str = "observed"


@dataclass(frozen=True)
class Service:
    id: str
    app_id: str
    name: str
    host: str
    service_type: str = "web"
    port: int | None = None
    tls: str | None = None


@dataclass(frozen=True)
class Route:
    id: str
    service_id: str
    host: str
    path: str
    method: str = "GET"
    auth_required: str = "unknown"
    source: str = "observed"
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class Technology:
    id: str
    name: str
    category: str
    source: str
    version: str | None = None
    confidence: str = "observed"
    app_id: str | None = None
    service_id: str | None = None
    playbook: dict[str, Any] | None = None


@dataclass(frozen=True)
class Session:
    id: str
    context: str = "guest"
    token_type: str | None = None
    issuer: str | None = None
    subject: str | None = None
    role: str | None = None
    tenant: str | None = None
    expiry: str | None = None
    cookie_scope: str | None = None
    samesite: str | None = None
    httponly: bool = False
    secure: bool = False
    replayable: str = "unknown"
    browser_only: bool = False
    cookies: dict[str, str] | None = None
    headers: dict[str, str] | None = None


@dataclass(frozen=True)
class Relationship:
    source_kind: str
    source_id: str
    relation: str
    target_kind: str
    target_id: str
    source: str
    confidence: str = "observed"
    trust_boundary: bool = False
    attacker_reachable: bool = False
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class SourceAsset:
    path: str
    kind: str
    checksum: str
    source: str
    language: str | None = None
    framework: str | None = None
    meta: dict[str, Any] | None = None


class WorldModel:
    def __init__(self, store: ReconStore, engagement_id: str, *, program_name: str, target: str, mode: str) -> None:
        self.store = store
        self.engagement_id = engagement_id
        self.program_name = program_name
        # Idempotent migration: world asset tables get last_seen for staleness
        # tracking (enterprise ASM pattern: first_seen/last_seen on assets).
        try:
            self.store.ensure_world_freshness_columns()
        except Exception:
            pass
        self._ensure_engagement(target, mode)

    def _ensure_engagement(self, target: str, mode: str) -> None:
        now = _now()
        self.store.conn.execute(
            """INSERT INTO engagements(id,program_name,target,mode,status,created_at,updated_at)
               VALUES (?,?,?,?, 'active', ?, ?)
               ON CONFLICT(id) DO UPDATE SET program_name=excluded.program_name,target=excluded.target,
                   mode=excluded.mode,updated_at=excluded.updated_at""",
            (self.engagement_id, self.program_name, target, mode, now, now),
        )
        self.store.conn.commit()

    def ensure_topology(self, hosts: Iterable[str]) -> tuple[str, dict[str, str]]:
        host_values = sorted({item.lower() for item in hosts if item and _is_valid_service_host(item)})
        org_id = stable_id("org", self.program_name)
        self.store.conn.execute(
            """INSERT INTO organizations(id,name,domain,industry,created_at) VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name,domain=excluded.domain""",
            (org_id, self.program_name, _registrable_domain(host_values[0] if host_values else ""), None, _now()),
        )
        app_id = stable_id("app", self.engagement_id)
        self.store.conn.execute(
            """INSERT INTO applications(id,org_id,name,confidence,created_at) VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET org_id=excluded.org_id,name=excluded.name""",
            (app_id, org_id, self.program_name, "observed", _now()),
        )
        services: dict[str, str] = {}
        for host in host_values:
            service_id = stable_id("svc", app_id, host)
            services[host] = service_id
            self.store.conn.execute(
                """INSERT INTO services(id,app_id,name,service_type,host,port,tls,created_at,last_seen) VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET host=excluded.host,name=excluded.name,last_seen=excluded.last_seen""",
                (service_id, app_id, host, "web", host, None, "unknown", _now(), _now()),
            )
            self.link(Relationship("application", app_id, "exposes", "service", service_id, "topology"))
        self.store.conn.commit()
        return app_id, services

    def ingest_surfaces(self, surfaces: Iterable[SurfaceRecord], *, source: str = "recon") -> None:
        materialized = [item for item in surfaces if item.host and item.host != "local" and _is_valid_service_host(item.host)]
        if not materialized:
            return
        app_id, services = self.ensure_topology(item.host for item in materialized)
        for surface in materialized:
            service_id = services[surface.host.lower()]
            method = str((surface.meta or {}).get("method") or "GET").upper()
            route = Route(
                id=stable_id("route", service_id, method, surface.path_pattern),
                service_id=service_id,
                host=surface.host.lower(),
                path=surface.path_pattern,
                method=method,
                auth_required=surface.auth_context,
                source=source,
                meta={
                    "surface_type": surface.surface_type,
                    "tags": list(surface.tags),
                    "confidence": surface.confidence,
                    **(surface.meta or {}),
                },
            )
            self.upsert_route(route)
            boundary = surface.auth_context in {"auth", "authenticated", "verified"}
            self.link(Relationship(
                "service", service_id, "serves", "route", route.id, source,
                confidence=surface.confidence,
                trust_boundary=boundary,
                attacker_reachable=True,
                meta={
                    "auth_context": surface.auth_context,
                    "surface_type": surface.surface_type,
                    "tags": list(surface.tags),
                    "boundary_kind": _boundary_kind(surface.surface_type, surface.auth_context),
                },
            ))
            if surface.surface_type in {"api", "graphql"}:
                self.link(Relationship("application", app_id, "uses", "api_style", surface.surface_type, source))

    def upsert_technology(self, technology: Technology) -> None:
        self.store.conn.execute(
            """INSERT INTO technologies(id,app_id,service_id,name,version,category,confidence,cves,playbook,source,created_at,last_seen)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET version=excluded.version,confidence=excluded.confidence,
                   playbook=excluded.playbook,source=excluded.source,last_seen=excluded.last_seen""",
            (technology.id, technology.app_id, technology.service_id, technology.name, technology.version,
             technology.category, technology.confidence, "[]", _json(technology.playbook or {}), technology.source, _now(), _now()),
        )
        self.store.conn.commit()

    def set_application_technology_fields(self, app_id: str, technologies: Iterable[Technology]) -> None:
        values = list(technologies)
        fields: dict[str, str] = {}
        for item in values:
            if item.category == "framework": fields.setdefault("framework", item.name)
            elif item.category == "language": fields.setdefault("language", item.name)
            elif item.category == "frontend": fields.setdefault("frontend", item.name)
            elif item.category in {"cdn", "waf"}: fields.setdefault("cdn_waf", item.name)
            elif item.category == "graphql": fields.setdefault("graphql_impl", item.name)
            elif item.category == "api": fields.setdefault("api_style", item.name)
        if fields:
            assignments = ", ".join(f"{column}=?" for column in fields)
            self.store.conn.execute(f"UPDATE applications SET {assignments} WHERE id=?", (*fields.values(), app_id))
            self.store.conn.commit()

    def upsert_route(self, route: Route) -> None:
        self.store.conn.execute(
            """INSERT INTO world_routes(id,service_id,host,path,method,auth_required,source,meta,created_at,last_seen)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(service_id,path,method) DO UPDATE SET auth_required=excluded.auth_required,
                   source=excluded.source,meta=excluded.meta,last_seen=excluded.last_seen""",
            (route.id, route.service_id, route.host, route.path, route.method, route.auth_required,
             route.source, _json(route.meta or {}), _now(), _now()),
        )
        self.store.conn.commit()

    def upsert_session(self, session: Session) -> None:
        self.store.conn.execute(
            """INSERT INTO sessions(id,context,token_type,issuer,subject,role,tenant,expiry,cookie_scope,samesite,
               httponly,secure,replayable,browser_only,cookies,headers,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET context=excluded.context,issuer=excluded.issuer,subject=excluded.subject,
               role=excluded.role,tenant=excluded.tenant,expiry=excluded.expiry,cookies=excluded.cookies,headers=excluded.headers""",
            (session.id, session.context, session.token_type, session.issuer, session.subject, session.role,
             session.tenant, session.expiry, session.cookie_scope, session.samesite, int(session.httponly),
             int(session.secure), session.replayable, int(session.browser_only), _json(session.cookies or {}),
             _json(session.headers or {}), _now()),
        )
        self.store.conn.commit()

    def link(self, relationship: Relationship) -> None:
        relation_id = stable_id("rel", relationship.source_kind, relationship.source_id, relationship.relation,
                                relationship.target_kind, relationship.target_id)
        meta = {
            "trust_boundary": relationship.trust_boundary,
            "attacker_reachable": relationship.attacker_reachable,
            "evidence_source": relationship.source,
            **(relationship.meta or {}),
        }
        self.store.conn.execute(
            """INSERT INTO relationships(id,source_kind,source_id,relation,target_kind,target_id,confidence,source,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_kind,source_id,relation,target_kind,target_id)
               DO UPDATE SET confidence=excluded.confidence,source=excluded.source,meta=excluded.meta""",
            (relation_id, relationship.source_kind, relationship.source_id, relationship.relation,
             relationship.target_kind, relationship.target_id, relationship.confidence, relationship.source,
             _json(meta), _now()),
        )
        self.store.conn.commit()

    def add_source_asset(self, asset: SourceAsset) -> str:
        asset_id = stable_id("source", asset.path, asset.checksum)
        self.store.conn.execute(
            """INSERT INTO source_assets(id,path,kind,checksum,language,framework,source,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(path,checksum) DO UPDATE SET meta=excluded.meta""",
            (asset_id, asset.path, asset.kind, asset.checksum, asset.language, asset.framework, asset.source,
             _json(asset.meta or {}), _now()),
        )
        self.store.conn.commit()
        return asset_id

    def add_browser_capture(self, path: str, title: str, source: str, meta: dict[str, Any]) -> str:
        capture_id = stable_id("browser", path)
        self.store.conn.execute(
            """INSERT INTO browser_captures(id,path,title,source,meta,created_at) VALUES (?,?,?,?,?,?)
               ON CONFLICT(path) DO UPDATE SET title=excluded.title,source=excluded.source,meta=excluded.meta""",
            (capture_id, path, title, source, _json(meta), _now()),
        )
        self.store.conn.commit()
        return capture_id

    def add_browser_request(self, capture_id: str, *, method: str, url: str, request_headers: dict[str, str],
                            request_body: str, response_status: int | None, response_headers: dict[str, str],
                            response_body_excerpt: str, auth_context: str, source: str) -> str:
        request_id = stable_id("browser-request", capture_id, method, url, request_body)
        self.store.conn.execute(
            """INSERT INTO browser_requests(id,capture_id,method,url,request_headers,request_body,response_status,
               response_headers,response_body_excerpt,auth_context,source,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(capture_id,method,url,request_body) DO UPDATE SET
               response_status=excluded.response_status,response_headers=excluded.response_headers,
               response_body_excerpt=excluded.response_body_excerpt,auth_context=excluded.auth_context""",
            (request_id, capture_id, method, url, _json(request_headers), request_body, response_status,
             _json(response_headers), response_body_excerpt[:4000], auth_context, source, _now()),
        )
        self.store.conn.commit()
        return request_id

    def stale_assets(self, *, older_than_days: int = 30) -> dict[str, list[str]]:
        """Assets not re-observed within the staleness window (ASM TTL pattern).

        Returns hosts/routes/technologies whose ``last_seen`` predates the
        cutoff; entries with no ``last_seen`` (pre-migration rows) count as
        stale so the operator is nudged to reconfirm them rather than silently
        trusting legacy map data.
        """
        from datetime import datetime, timedelta, timezone

        cutoff = (datetime.now(timezone.utc) - timedelta(days=older_than_days)).isoformat()

        def _stale(query: str, name_col: int = 0) -> list[str]:
            try:
                rows = self.store.conn.execute(query, (cutoff,)).fetchall()
            except Exception:
                return []
            return [str(row[name_col]) for row in rows]

        return {
            "services": _stale(
                "SELECT host FROM services WHERE last_seen IS NULL OR last_seen < ?"),
            "routes": _stale(
                "SELECT host || ' ' || method || ' ' || path FROM world_routes WHERE last_seen IS NULL OR last_seen < ?"),
            "technologies": _stale(
                "SELECT name || COALESCE(' ' || version, '') FROM technologies WHERE last_seen IS NULL OR last_seen < ?"),
        }

    def architecture_summary(self) -> dict[str, Any]:
        applications = self.store.conn.execute("SELECT id,name,framework,language,frontend,cdn_waf,api_style,graphql_impl,auth_provider FROM applications ORDER BY name").fetchall()
        services = self.store.conn.execute("SELECT id,app_id,name,host,service_type,tls FROM services ORDER BY host").fetchall()
        technologies = self.store.conn.execute("SELECT name,version,category,confidence,source FROM technologies ORDER BY category,name").fetchall()
        routes = self.store.conn.execute("SELECT host,path,method,auth_required,source FROM world_routes ORDER BY host,path,method").fetchall()
        relationships = self.store.conn.execute("SELECT source_kind,source_id,relation,target_kind,target_id,confidence,source,meta FROM relationships ORDER BY source_kind,relation").fetchall()
        source_assets = self.store.conn.execute("SELECT path,kind,language,framework,source FROM source_assets ORDER BY path").fetchall()
        browser_captures = self.store.conn.execute("SELECT path,title,source FROM browser_captures ORDER BY path").fetchall()
        sessions = self.store.conn.execute("SELECT context,cookie_scope,samesite,httponly,secure,browser_only FROM sessions ORDER BY context").fetchall()
        valid_services = [row for row in services if _is_valid_service_host(str(row[3]))]
        valid_hosts = {row[3].lower() for row in valid_services}
        valid_routes = [row for row in routes if _is_valid_service_host(str(row[0])) and row[0].lower() in valid_hosts]
        return {
            "engagement_id": self.engagement_id,
            "applications": [dict(zip(("id", "name", "framework", "language", "frontend", "cdn_waf", "api_style", "graphql_impl", "auth_provider"), row)) for row in applications],
            "services": [dict(zip(("id", "app_id", "name", "host", "service_type", "tls"), row)) for row in valid_services],
            "technologies": [dict(zip(("name", "version", "category", "confidence", "source"), row)) for row in technologies],
            "routes": [dict(zip(("host", "path", "method", "auth_required", "source"), row)) for row in valid_routes],
            "relationships": [
                {**dict(zip(("source_kind", "source_id", "relation", "target_kind", "target_id", "confidence", "source"), row[:-1])), "meta": _loads(row[-1])}
                for row in relationships
            ],
            "source_assets": [dict(zip(("path", "kind", "language", "framework", "source"), row)) for row in source_assets],
            "browser_captures": [dict(zip(("path", "title", "source"), row)) for row in browser_captures],
            "sessions": [dict(zip(("context", "cookie_scope", "samesite", "httponly", "secure", "browser_only"), row)) for row in sessions],
            "stale_assets": self.stale_assets(),
        }

    def attack_surface_summary(self, *, limit: int = 10) -> list[dict[str, Any]]:
        """Return compact, evidence-labelled trust boundaries for planning.

        This reports only externally observable route boundaries. It does not
        infer internal services, databases, or exploitability from topology.
        """
        rows = self.store.conn.execute(
            "SELECT host,path,method,auth_required,source,meta FROM world_routes ORDER BY host,path,method"
        ).fetchall()
        candidates: list[dict[str, Any]] = []
        for host, path, method, auth_context, source, raw_meta in rows:
            if not _is_valid_service_host(str(host)):
                continue
            meta = _loads(raw_meta)
            surface_type = str(meta.get("surface_type", "web"))
            tags = [str(item) for item in meta.get("tags", [])]
            boundary = _boundary_kind(surface_type, str(auth_context or "unknown"))
            high_value = surface_type in {"api", "graphql", "auth", "upload", "redirect"} or "parameter" in tags
            if not high_value:
                continue
            mission = _boundary_mission(surface_type, str(auth_context or "unknown"), tags)
            candidates.append({
                "surface": f"{method} {host}{path}",
                "boundary": boundary,
                "attacker_reachable": True,
                "auth_context": auth_context,
                "surface_type": surface_type,
                "mission": mission,
                "confidence": str(meta.get("confidence", "observed")),
                "evidence_source": source,
            })
        candidates.sort(key=lambda item: (item["mission"] != "auth_boundary_test", item["surface"]))
        return candidates[:max(1, limit)]

    def write_catalogs(self, root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        summary = self.architecture_summary()
        _guard_catalog_sanity(summary)
        (root / "world-model.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        lines = [f"# Engagement Architecture: {self.program_name}", "", "## Applications", ""]
        for app in summary["applications"]:
            lines.append(
                f"- `{app['name']}` framework={app['framework'] or '-'} language={app['language'] or '-'} "
                f"frontend={app['frontend'] or '-'} api={app['api_style'] or '-'} auth={app['auth_provider'] or '-'}"
            )
        lines.extend(["", "## Services", ""])
        lines.extend(f"- `{item['host']}` type={item['service_type']} tls={item['tls'] or 'unknown'}" for item in summary["services"])
        lines.extend(["", "## Technologies", ""])
        lines.extend(f"- `{item['name']}` ({item['category']}, confidence={item['confidence']})" for item in summary["technologies"])
        lines.extend(["", "## Routes", ""])
        lines.extend(f"- `{item['method']} {item['host']}{item['path']}` auth={item['auth_required']} source={item['source']}" for item in summary["routes"][:250])
        lines.extend(["", "## Browser and source evidence", ""])
        lines.append(f"- Browser captures: {len(summary['browser_captures'])}; session contexts: {len(summary['sessions'])}; source assets: {len(summary['source_assets'])}.")
        (root / "architecture.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (root / "technologies.json").write_text(json.dumps(summary["technologies"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (root / "routes.json").write_text(json.dumps(summary["routes"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stable_id(prefix: str, *parts: str) -> str:
    return f"{prefix}-{hashlib.sha1(chr(0).join(parts).encode('utf-8', errors='replace')).hexdigest()[:16]}"


def host_from_url(value: str) -> str:
    parsed = urlparse(value if "://" in value else f"https://{value}")
    return (parsed.hostname or "").lower()


def _boundary_kind(surface_type: str, auth_context: str) -> str:
    auth = auth_context.lower()
    if auth in {"auth", "authenticated", "verified"}:
        return "session_to_protected_route"
    if surface_type in {"api", "graphql"}:
        return "public_to_api_route"
    if surface_type == "upload":
        return "public_to_upload_handler"
    if surface_type == "redirect":
        return "public_to_outbound_request"
    return "public_to_web_route"


def _boundary_mission(surface_type: str, auth_context: str, tags: list[str]) -> str:
    if auth_context.lower() in {"auth", "authenticated", "verified"} and surface_type in {"api", "graphql"}:
        return "auth_boundary_test"
    if surface_type == "graphql":
        return "graphql_authorization_review"
    if surface_type == "api" and "parameter" in tags:
        return "data_flow_trace"
    if surface_type in {"upload", "redirect"}:
        return "input_boundary_test"
    return "endpoint_mapping"


def _is_valid_service_host(value: str) -> bool:
    """Reject non-host garbage that would otherwise pollute the world model.

    The world model's ``ensure_topology`` is the choke point where raw
    observation targets (tool names, python script filenames, shell command
    fragments, workspace file names) can be misparsed as hosts.  This guard
    filters those out before a service row is created.
    """
    if not value or not isinstance(value, str):
        return False
    cleaned = value.strip().lower()
    if not cleaned:
        return False
    # Reject obvious non-hosts: whitespace, shell metacharacters, paths, scripts
    if any(marker in cleaned for marker in (" ", "\t", "/", "\\", ":", "|", "&", ";", "$", "`", "(", ")", "{", "}", "[", "]", "<", ">", "=", "'", '"')):
        return False
    # Reject bare tool/command tokens and workspace file names
    if cleaned in _INVALID_SERVICE_TOKENS:
        return False
    if cleaned.endswith((".py", ".txt", ".md", ".json", ".sh", ".js", ".map")):
        return False
    # Reject single-label hosts (no dot) — real hosts have a registrable domain
    if "." not in cleaned:
        return False
    # Reject private / link-local IP ranges and localhost
    if is_noise_host(cleaned):
        return False
    return True


# Bare tokens that are never valid service hosts (tool names, action names, files)
_INVALID_SERVICE_TOKENS: frozenset[str] = frozenset(
    {
        "ffuf", "httpx", "nuclei", "katana", "subfinder", "dnsx", "naabu", "gobuster",
        "dirsearch", "nikto", "sqlmap", "wafw00f", "xsstrike", "gitjacker", "inql",
        "clairvoyance", "grapeql", "arjun", "feroxbuster", "dalfox", "crtsh", "curl",
        "wget", "python", "python3", "node", "npm", "bash", "sh", "workspace",
        "browser_map", "create_hypothesis", "create_verifier", "create_objective",
        "read_artifact_slice", "read_file", "write_file", "list_files", "use_skill",
        "record_finding", "record_evidence", "save_artifact", "search", "finish",
        "target_mapping", "surface_discovery", "sign_in_required_pattern",
        "auth-context.txt", "target-map.md", "stop_signal.json", "allowed_hosts.txt",
        "local", "localhost", "host", "true", "false", "null", "none", "undefined",
    }
)


def _guard_catalog_sanity(summary: dict[str, Any]) -> None:
    """Raise if the catalog summary contains obvious garbage that would bloat the context window."""
    bad_hosts = [
        svc["host"]
        for svc in summary.get("services", [])
        if not _is_valid_service_host(str(svc.get("host", "")))
    ]
    if bad_hosts:
        raise RuntimeError(
            "Catalog sanity check failed: the following service hosts look like garbage and would bloat the context window: "
            + ", ".join(repr(host) for host in bad_hosts[:20])
        )


def _registrable_domain(host: str) -> str | None:
    labels = host.lower().split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else host or None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _loads(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}
