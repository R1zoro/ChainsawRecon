from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class ReconFact:
    kind: str
    key: str
    value: str
    confidence: str
    source: str
    evidence: str = ""
    status: str = "active"
    tags: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class ReconObservation:
    action: str
    target: str
    summary: str
    ok: bool
    source: str
    tags: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class SurfaceRecord:
    surface_key: str
    host: str
    path_pattern: str
    surface_type: str
    source: str
    confidence: str = "observed"
    auth_context: str = "unknown"
    tags: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class AttackResult:
    surface_key: str
    attack_type: str
    auth_context: str
    outcome: str
    source: str
    evidence: str = ""
    tags: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


class ReconStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.execute("PRAGMA journal_mode=OFF")
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS observations(
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                summary TEXT NOT NULL,
                ok INTEGER NOT NULL,
                source TEXT NOT NULL,
                tags TEXT NOT NULL,
                meta TEXT NOT NULL
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS facts(
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                confidence TEXT NOT NULL,
                source TEXT NOT NULL,
                evidence TEXT NOT NULL,
                status TEXT NOT NULL,
                tags TEXT NOT NULL,
                meta TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS surfaces(
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                surface_key TEXT NOT NULL,
                host TEXT NOT NULL,
                path_pattern TEXT NOT NULL,
                surface_type TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence TEXT NOT NULL,
                auth_context TEXT NOT NULL,
                tags TEXT NOT NULL,
                meta TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS attacks(
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                surface_key TEXT NOT NULL,
                attack_type TEXT NOT NULL,
                auth_context TEXT NOT NULL,
                outcome TEXT NOT NULL,
                source TEXT NOT NULL,
                evidence TEXT NOT NULL,
                tags TEXT NOT NULL,
                meta TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE
            )
            """
        )
        # Phase 2 world-model tables. They live beside durable engagement recon
        # data and are intentionally additive for compatibility with old runs.
        self.conn.execute("CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, created_at TEXT NOT NULL)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, framework TEXT, language TEXT, frontend TEXT, cdn_waf TEXT, hosting TEXT, api_style TEXT, graphql_impl TEXT, auth_provider TEXT, version TEXT, confidence TEXT DEFAULT 'observed', created_at TEXT NOT NULL, FOREIGN KEY (org_id) REFERENCES organizations(id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY, app_id TEXT NOT NULL, name TEXT NOT NULL, service_type TEXT NOT NULL, host TEXT NOT NULL, port INTEGER, tls TEXT, created_at TEXT NOT NULL, FOREIGN KEY (app_id) REFERENCES applications(id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY, service_id TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL, auth_required TEXT DEFAULT 'unknown', source TEXT, created_at TEXT NOT NULL, FOREIGN KEY (service_id) REFERENCES services(id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS technologies(id TEXT PRIMARY KEY, app_id TEXT, service_id TEXT, name TEXT NOT NULL, version TEXT, category TEXT, confidence TEXT DEFAULT 'observed', cves TEXT, playbook TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (app_id) REFERENCES applications(id), FOREIGN KEY (service_id) REFERENCES services(id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, context TEXT NOT NULL, token_type TEXT, issuer TEXT, subject TEXT, role TEXT, tenant TEXT, expiry TEXT, cookie_scope TEXT, samesite TEXT, httponly INTEGER, secure INTEGER, replayable TEXT, browser_only INTEGER DEFAULT 0, cookies TEXT, headers TEXT, created_at TEXT NOT NULL)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS evidence_items(id TEXT PRIMARY KEY, hypothesis_id TEXT, experiment_id TEXT, request TEXT, response TEXT, response_headers TEXT, cookies TEXT, authentication_context TEXT, tool_version TEXT, environment TEXT, screenshots TEXT, har_file TEXT, response_excerpt TEXT, replay_script TEXT, evidence_hash TEXT, created_at TEXT NOT NULL)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS hypotheses(id TEXT PRIMARY KEY, engagement_id TEXT, security_question TEXT NOT NULL, affected_surface TEXT NOT NULL, suspected_vulnerability_class TEXT, required_evidence TEXT, proposed_experiments TEXT, authorization_context TEXT, stop_conditions TEXT, confidence TEXT DEFAULT 'low', status TEXT DEFAULT 'observation', next_action TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (engagement_id) REFERENCES engagements(id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS engagements(id TEXT PRIMARY KEY, program_name TEXT NOT NULL, target TEXT NOT NULL, mode TEXT DEFAULT 'attack', status TEXT DEFAULT 'active', budget_model_calls INTEGER DEFAULT 0, budget_commands INTEGER DEFAULT 0, budget_browser_actions INTEGER DEFAULT 0, budget_validations INTEGER DEFAULT 0, budget_artifact_writes INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS relationships(id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, relation TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, confidence TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(source_kind, source_id, relation, target_kind, target_id))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS source_assets(id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, checksum TEXT NOT NULL, language TEXT, framework TEXT, source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(path, checksum))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS browser_captures(id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(path))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS browser_requests(id TEXT PRIMARY KEY, capture_id TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, request_headers TEXT NOT NULL, request_body TEXT NOT NULL, response_status INTEGER, response_headers TEXT NOT NULL, response_body_excerpt TEXT NOT NULL, auth_context TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(capture_id, method, url, request_body))")
        self.conn.execute("CREATE TABLE IF NOT EXISTS world_routes(id TEXT PRIMARY KEY, service_id TEXT NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL, auth_required TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(service_id, path, method))")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_facts_kind_key ON facts(kind, key)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_target ON observations(target)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_surfaces_type ON surfaces(surface_type)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_attacks_surface ON attacks(surface_key)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_org_name ON organizations(name)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_app_org ON applications(org_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_service_app ON services(app_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_route_service ON routes(service_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_tech_app ON technologies(app_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_hypothesis_status ON hypotheses(status)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_evidence_hypothesis ON evidence_items(hypothesis_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_relationship_source ON relationships(source_kind, source_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_relationship_target ON relationships(target_kind, target_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_browser_requests_capture ON browser_requests(capture_id)")
        self.conn.commit()

    def add_observation(self, observation: ReconObservation) -> None:
        self.conn.execute(
            """
            INSERT INTO observations(created_at, action, target, summary, ok, source, tags, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _now(),
                observation.action,
                observation.target,
                observation.summary,
                1 if observation.ok else 0,
                observation.source,
                _json(observation.tags),
                _json(observation.meta or {}),
            ),
        )
        self.conn.commit()

    def upsert_fact(self, fact: ReconFact) -> None:
        fingerprint = _fact_fingerprint(fact.kind, fact.key, fact.value)
        self.conn.execute(
            """
            INSERT INTO facts(
                created_at, kind, key, value, confidence, source, evidence, status, tags, meta, fingerprint
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                created_at=excluded.created_at,
                confidence=excluded.confidence,
                source=excluded.source,
                evidence=excluded.evidence,
                status=excluded.status,
                tags=excluded.tags,
                meta=excluded.meta
            """,
            (
                _now(),
                fact.kind,
                fact.key,
                fact.value,
                fact.confidence,
                fact.source,
                fact.evidence,
                fact.status,
                _json(fact.tags),
                _json(fact.meta or {}),
                fingerprint,
            ),
        )
        self.conn.commit()

    def facts(self, status: str | None = None) -> list[ReconFact]:
        query = "SELECT kind, key, value, confidence, source, evidence, status, tags, meta FROM facts"
        params: tuple[str, ...] = ()
        if status:
            query += " WHERE status = ?"
            params = (status,)
        query += " ORDER BY kind, key, value"
        return [_row_to_fact(row) for row in self.conn.execute(query, params).fetchall()]

    def observations(self, limit: int = 50) -> list[ReconObservation]:
        rows = self.conn.execute(
            """
            SELECT action, target, summary, ok, source, tags, meta
            FROM observations ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            ReconObservation(
                action=row[0],
                target=row[1],
                summary=row[2],
                ok=bool(row[3]),
                source=row[4],
                tags=tuple(json.loads(row[5] or "[]")),
                meta=json.loads(row[6] or "{}"),
            )
            for row in rows
        ]

    def summary_counts(self) -> dict[str, int]:
        rows = self.conn.execute("SELECT kind, status, COUNT(*) FROM facts GROUP BY kind, status").fetchall()
        return {f"{kind}:{status}": count for kind, status, count in rows}

    def upsert_surface(self, record: SurfaceRecord) -> None:
        fingerprint = _surface_fingerprint(record.surface_key, record.surface_type, record.auth_context)
        self.conn.execute(
            """
            INSERT INTO surfaces(
                created_at, surface_key, host, path_pattern, surface_type, source, confidence, auth_context,
                tags, meta, fingerprint
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                created_at=excluded.created_at,
                source=excluded.source,
                confidence=excluded.confidence,
                auth_context=excluded.auth_context,
                tags=excluded.tags,
                meta=excluded.meta,
                host=excluded.host,
                path_pattern=excluded.path_pattern,
                surface_type=excluded.surface_type
            """,
            (
                _now(),
                record.surface_key,
                record.host,
                record.path_pattern,
                record.surface_type,
                record.source,
                record.confidence,
                record.auth_context,
                _json(record.tags),
                _json(record.meta or {}),
                fingerprint,
            ),
        )
        self.conn.commit()

    def upsert_attack_result(self, record: AttackResult) -> None:
        fingerprint = _attack_fingerprint(record.surface_key, record.attack_type, record.auth_context, record.outcome)
        self.conn.execute(
            """
            INSERT INTO attacks(
                created_at, surface_key, attack_type, auth_context, outcome, source, evidence, tags, meta, fingerprint
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                created_at=excluded.created_at,
                source=excluded.source,
                evidence=excluded.evidence,
                tags=excluded.tags,
                meta=excluded.meta,
                outcome=excluded.outcome
            """,
            (
                _now(),
                record.surface_key,
                record.attack_type,
                record.auth_context,
                record.outcome,
                record.source,
                record.evidence,
                _json(record.tags),
                _json(record.meta or {}),
                fingerprint,
            ),
        )
        self.conn.commit()

    def surfaces(self) -> list[SurfaceRecord]:
        rows = self.conn.execute(
            """
            SELECT surface_key, host, path_pattern, surface_type, source, confidence, auth_context, tags, meta
            FROM surfaces ORDER BY surface_type, host, path_pattern
            """
        ).fetchall()
        return [
            SurfaceRecord(
                surface_key=row[0],
                host=row[1],
                path_pattern=row[2],
                surface_type=row[3],
                source=row[4],
                confidence=row[5],
                auth_context=row[6],
                tags=tuple(json.loads(row[7] or "[]")),
                meta=json.loads(row[8] or "{}"),
            )
            for row in rows
        ]

    def attack_results(self) -> list[AttackResult]:
        rows = self.conn.execute(
            """
            SELECT surface_key, attack_type, auth_context, outcome, source, evidence, tags, meta
            FROM attacks ORDER BY attack_type, surface_key
            """
        ).fetchall()
        return [
            AttackResult(
                surface_key=row[0],
                attack_type=row[1],
                auth_context=row[2],
                outcome=row[3],
                source=row[4],
                evidence=row[5],
                tags=tuple(json.loads(row[6] or "[]")),
                meta=json.loads(row[7] or "{}"),
            )
            for row in rows
        ]

    def coverage_summary(self) -> dict[str, Any]:
        surfaces = self.surfaces()
        attacks = self.attack_results()
        tested = {(item.surface_key, item.attack_type, item.auth_context) for item in attacks}
        surface_types: dict[str, int] = {}
        for surface in surfaces:
            surface_types[surface.surface_type] = surface_types.get(surface.surface_type, 0) + 1
        return {
            "surface_count": len(surfaces),
            "attack_count": len(attacks),
            "surface_types": surface_types,
            "tested_combinations": len(tested),
            "next_tasks": suggest_next_tasks(surfaces, attacks, limit=8),
        }

    def close(self) -> None:
        self.conn.close()


class NullReconStore:
    def add_observation(self, observation: ReconObservation) -> None:
        return None

    def upsert_fact(self, fact: ReconFact) -> None:
        return None

    def facts(self, status: str | None = None) -> list[ReconFact]:
        return []

    def observations(self, limit: int = 50) -> list[ReconObservation]:
        return []

    def summary_counts(self) -> dict[str, int]:
        return {}

    def upsert_surface(self, record: SurfaceRecord) -> None:
        return None

    def upsert_attack_result(self, record: AttackResult) -> None:
        return None

    def surfaces(self) -> list[SurfaceRecord]:
        return []

    def attack_results(self) -> list[AttackResult]:
        return []

    def coverage_summary(self) -> dict[str, Any]:
        return {"surface_count": 0, "attack_count": 0, "surface_types": {}, "tested_combinations": 0, "next_tasks": []}

    def close(self) -> None:
        return None


def build_facts_from_action_result(
    action: dict[str, Any],
    ok: bool,
    content: str,
    source: str,
) -> list[ReconFact]:
    name = str(action.get("action", ""))
    facts: list[ReconFact] = []
    if name == "bash":
        command = str(action.get("command", ""))
        for url in _extract_urls(command + "\n" + content):
            parsed = urlparse(url)
            host = parsed.hostname or ""
            path = _path_pattern(parsed.path or "/")
            if host:
                facts.append(ReconFact("host", host, host, "observed" if ok else "tentative", source, _short(content), tags=("run",)))
            facts.append(
                ReconFact(
                    "endpoint",
                    f"{host}{path}",
                    url,
                    "observed" if ok else "tentative",
                    source,
                    _short(content),
                    tags=tuple(_endpoint_tags(url)),
                    meta={"path_pattern": path, "host": host},
                )
            )
        for tool in _present_tools(content):
            facts.append(ReconFact("tool", tool, "present", "observed", source, "Tool inventory command reported presence.", tags=("tooling",)))
    elif name == "search":
        query = str(action.get("query", ""))
        if ok and query:
            family = _research_family(query)
            facts.append(ReconFact("research_query", family, query, "observed", source, _short(content), tags=("research", family)))
    elif name == "record_finding" and ok:
        title = str(action.get("title", "Untitled finding"))
        evidence = _short(" ".join(str(action.get(k, "")) for k in ("request", "response", "evidence")))
        facts.append(
            ReconFact(
                "finding",
                title,
                str(action.get("asset", "")),
                "confirmed",
                source,
                evidence,
                tags=("finding", str(action.get("severity", "")).lower()),
                meta={"severity": action.get("severity", ""), "impact": action.get("impact", "")},
            )
        )
    return facts


def build_surfaces_from_action_result(
    action: dict[str, Any],
    ok: bool,
    content: str,
    source: str,
) -> list[SurfaceRecord]:
    name = str(action.get("action", ""))
    surfaces: list[SurfaceRecord] = []
    if name == "bash":
        command = str(action.get("command", ""))
        text = f"{command}\n{content}"
        primary_url = next(iter(_extract_urls(command)), next(iter(_extract_urls(content)), ""))
        primary_host = urlparse(primary_url).hostname if primary_url else ""
        if primary_url:
            parsed_primary = urlparse(primary_url)
            primary_path = _path_pattern(parsed_primary.path or "/")
            if parsed_primary.hostname and not _is_noise_host(parsed_primary.hostname):
                surfaces.append(
                    SurfaceRecord(
                        surface_key=f"{parsed_primary.hostname}{primary_path}",
                        host=parsed_primary.hostname,
                        path_pattern=primary_path,
                        surface_type=_surface_type_from_text(primary_url, primary_url),
                        source=source,
                        confidence="observed" if ok else "tentative",
                        auth_context=_auth_context_from_text(text),
                        tags=tuple(_surface_tags(primary_url, primary_url)),
                        meta={"url": primary_url, "method": _guess_method(text, "GET"), "primary": True},
                    )
                )
        for url in _extract_urls(text):
            parsed = urlparse(url)
            host = parsed.hostname or ""
            if not host or _is_noise_host(host):
                continue
            path_pattern = _path_pattern(parsed.path or "/")
            surfaces.append(
                SurfaceRecord(
                    surface_key=f"{host}{path_pattern}",
                    host=host,
                    path_pattern=path_pattern,
                    surface_type=_surface_type_from_text(url, text),
                    source=source,
                    confidence="observed" if ok else "tentative",
                    auth_context=_auth_context_from_text(text),
                    tags=tuple(_surface_tags(url, text)),
                    meta={"url": url, "method": _guess_method(text, "GET")},
                )
            )
        for js_url in _extract_js_urls(text):
            parsed = urlparse(js_url)
            if parsed.hostname:
                path_pattern = _path_pattern(parsed.path or "/")
                surfaces.append(
                    SurfaceRecord(
                        surface_key=f"{parsed.hostname}{path_pattern}",
                        host=parsed.hostname,
                        path_pattern=path_pattern,
                        surface_type="js",
                        source=source,
                        confidence="observed" if ok else "tentative",
                        auth_context=_auth_context_from_text(text),
                        tags=("js", "bundle"),
                        meta={"url": js_url, "extracted_from": "js"},
                    )
                )
        for js_path in _extract_js_paths(text):
            if not js_path.startswith("/"):
                continue
            host = primary_host or ""
            if not host:
                continue
            path_pattern = _path_pattern(js_path)
            surfaces.append(
                SurfaceRecord(
                    surface_key=f"{host}{path_pattern}",
                    host=host,
                    path_pattern=path_pattern,
                    surface_type=_surface_type_from_text(js_path, text),
                    source=source,
                    confidence="observed" if ok else "tentative",
                    auth_context=_auth_context_from_text(text),
                    tags=tuple(_surface_tags(js_path, text)),
                    meta={"url": f"https://{host}{js_path}", "extracted_from": "js_relative"},
                )
            )
    elif name == "read_file":
        path = str(action.get("path", ""))
        if path.endswith((".js", ".mjs", ".ts", ".tsx", ".map")):
            surface_type = "js_map" if path.endswith(".map") else "js"
            surfaces.append(
                SurfaceRecord(
                    surface_key=path,
                    host="local",
                    path_pattern=path,
                    surface_type=surface_type,
                    source=source,
                    confidence="observed" if ok else "tentative",
                    auth_context="local",
                    tags=("js", "source" if path.endswith(".map") else "bundle"),
                    meta={"path": path},
                )
            )
    return surfaces


def build_attack_results_from_action_result(
    action: dict[str, Any],
    ok: bool,
    content: str,
    source: str,
) -> list[AttackResult]:
    name = str(action.get("action", ""))
    text = " ".join([str(action.get("command", "")), str(action.get("query", "")), content]).lower()
    results: list[AttackResult] = []
    for surface in build_surfaces_from_action_result(action, ok, content, source):
        attack_type = _attack_type_for_surface(surface, text)
        outcome = _attack_outcome(text, ok, name)
        results.append(
            AttackResult(
                surface_key=surface.surface_key,
                attack_type=attack_type,
                auth_context=surface.auth_context,
                outcome=outcome,
                source=source,
                evidence=_short(content),
                tags=tuple(_attack_tags(text, name, outcome, attack_type)),
                meta={
                    "surface_type": surface.surface_type,
                    "action": name,
                    "command": str(action.get("command", "")),
                    "query": str(action.get("query", "")),
                    "path": str(action.get("path", "")),
                    "target": str(action.get("target", "") or action.get("url", "")),
                },
            )
        )
    if name == "record_finding" and ok:
        asset = str(action.get("asset", ""))
        results.append(
            AttackResult(
                surface_key=asset or str(action.get("title", "finding")),
                attack_type="finding",
                auth_context="verified",
                outcome="confirmed",
                source=source,
                evidence=_short(" ".join(str(action.get(k, "")) for k in ("request", "response", "evidence"))),
                tags=("finding",),
                meta={"severity": action.get("severity", "")},
            )
        )
    return results


def promote_run_facts(run_store: ReconStore, engagement_store: ReconStore, run_id: str) -> int:
    promoted = 0
    for fact in run_store.facts():
        promoted_fact = _promotable_fact(fact, run_id)
        if promoted_fact:
            engagement_store.upsert_fact(promoted_fact)
            promoted += 1
    for surface in run_store.surfaces():
        engagement_store.upsert_surface(
            SurfaceRecord(
                surface_key=surface.surface_key,
                host=surface.host,
                path_pattern=surface.path_pattern,
                surface_type=surface.surface_type,
                source=f"{surface.source}; promoted_from={run_id}",
                confidence=surface.confidence,
                auth_context=surface.auth_context,
                tags=surface.tags,
                meta=surface.meta,
            )
        )
        promoted += 1
    for attack in run_store.attack_results():
        engagement_store.upsert_attack_result(
            AttackResult(
                surface_key=attack.surface_key,
                attack_type=attack.attack_type,
                auth_context=attack.auth_context,
                outcome=attack.outcome,
                source=f"{attack.source}; promoted_from={run_id}",
                evidence=attack.evidence,
                tags=attack.tags,
                meta=attack.meta,
            )
        )
        promoted += 1
    return promoted


def suggest_next_tasks(
    surfaces: list[SurfaceRecord],
    attacks: list[AttackResult],
    limit: int = 8,
) -> list[dict[str, str]]:
    tested = {(item.surface_key, item.attack_type, item.auth_context) for item in attacks}
    tasks: list[dict[str, str]] = []
    for surface in sorted(surfaces, key=_surface_priority, reverse=True):
        for attack_type in _priority_attacks_for_surface(surface):
            combo = (surface.surface_key, attack_type, surface.auth_context)
            if combo in tested:
                continue
            tasks.append(
                {
                    "surface": surface.surface_key,
                    "attack_type": attack_type,
                    "auth_context": surface.auth_context,
                    "surface_type": surface.surface_type,
                    "reason": f"{surface.surface_type} surface with {attack_type} coverage missing",
                }
            )
            if len(tasks) >= limit:
                return tasks
    return tasks


def _promotable_fact(fact: ReconFact, run_id: str) -> ReconFact | None:
    if fact.kind in {"finding", "tool"} and fact.confidence in {"confirmed", "observed"}:
        return _with_source(fact, run_id, "confirmed")
    if fact.kind == "host" and fact.confidence == "observed":
        return _with_source(fact, run_id, "observed")
    if fact.kind == "endpoint" and fact.confidence == "observed" and _is_useful_endpoint(fact):
        return _with_source(fact, run_id, "observed")
    # Public research is intentionally run-local context. It must never become
    # durable engagement memory because search results age quickly and are not
    # evidence about the target.
    if fact.kind == "research_query":
        return None
    if fact.status == "skip" and fact.evidence:
        return _with_source(fact, run_id, fact.confidence)
    return None


def _with_source(fact: ReconFact, run_id: str, confidence: str) -> ReconFact:
    return ReconFact(fact.kind, fact.key, fact.value, confidence, f"{fact.source}; promoted_from={run_id}", fact.evidence, fact.status, fact.tags, fact.meta)


# Known third-party CDN/analytics/saas hosts that are never in scope
_BUILTIN_EXCLUDED_HOSTS: set[str] = {
    "cdn.segment.com",
    "consent.cookiebot.com",
    "client-registry.mutinycdn.com",
    "www.googletagmanager.com",
    "www.sitemaps.org",
    "jqlang.org",
    "127.0.0.1",
    "localhost",
    "host",
}


def _is_noise_host(host: str) -> bool:
    """Filter out known third-party CDN/analytics and localhost noise hosts."""
    if not host:
        return True
    lowered = host.lower().strip(".")
    if lowered in _BUILTIN_EXCLUDED_HOSTS:
        return True
    if lowered.startswith(("192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.")):
        return True
    return False


def _surface_fingerprint(surface_key: str, surface_type: str, auth_context: str) -> str:
    # Deduplicate by surface_key (host+path) only, not by auth_context
    # This prevents the same URL from appearing 3 times (public, authenticated, auth)
    normalized_key = surface_key.lower().rstrip("\\/").replace("\\", "")
    data = "\n".join([normalized_key, surface_type.lower()])
    return hashlib.sha256(data.encode("utf-8", errors="replace")).hexdigest()[:32]


def _attack_fingerprint(surface_key: str, attack_type: str, auth_context: str, outcome: str) -> str:
    data = "\n".join([surface_key.lower(), attack_type.lower(), auth_context.lower(), outcome.lower()])
    return hashlib.sha256(data.encode("utf-8", errors="replace")).hexdigest()[:32]


def _is_useful_endpoint(fact: ReconFact) -> bool:
    tags = set(fact.tags)
    if tags.intersection({"api", "graphql", "auth", "parameter", "js", "version", "redirect", "upload"}):
        return True
    path = str((fact.meta or {}).get("path_pattern", ""))
    return bool(re.search(r"/(api|graphql|auth|login|oauth|admin|docs|v[0-9])\b", path, re.I))


def _surface_type_from_text(url: str, text: str) -> str:
    lowered_url = url.lower()
    if "graphql" in lowered_url:
        return "graphql"
    if any(term in lowered_url for term in ("swagger", "openapi", "/api/", "/api", "api/v", "rest")):
        return "api"
    if lowered_url.endswith(".js") or ".js?" in lowered_url or lowered_url.endswith(".map"):
        return "js"
    if any(term in lowered_url for term in ("login", "oauth", "sso", "session", "auth")):
        return "auth"
    if any(term in lowered_url for term in ("upload", "import", "export")):
        return "upload"
    if any(term in lowered_url for term in ("version", "debug", "health", "status")):
        return "version"
    if any(term in lowered_url for term in ("redirect", "next=", "return=", "url=", "uri=")):
        return "redirect"
    if "sourcemappingurl" in text.lower():
        return "js"
    return "web"


def _surface_tags(url: str, text: str) -> list[str]:
    tags = [_surface_type_from_text(url, text)]
    lowered = text.lower()
    if "js" in url.lower() or "sourcemappingurl" in lowered:
        tags.append("js")
    if "graphql" in lowered:
        tags.append("graphql")
    if any(term in lowered for term in ("url=", "uri=", "next=", "return=", "redirect=")):
        tags.append("parameter")
    return list(dict.fromkeys(tags))


def _extract_js_urls(text: str) -> list[str]:
    urls: list[str] = []
    patterns = [
        r"(?:fetch|axios\.[a-z]+|XMLHttpRequest\(\)|window\.open)\s*\(\s*['\"]([^'\"]+)['\"]",
        r"sourceMappingURL=([^\s]+)",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.I):
            candidate = match.strip().strip("'\"")
            if candidate.startswith(("http://", "https://")) and candidate not in urls:
                urls.append(candidate)
    return urls


def _extract_js_paths(text: str) -> list[str]:
    paths: list[str] = []
    patterns = [
        r"(?:fetch|axios\.[a-z]+|XMLHttpRequest\(\)|window\.open)\s*\(\s*['\"]([^'\"]+)['\"]",
        r"['\"](/(?:api|graphql|v[0-9]|auth|login|oauth|sso|upload|import|export|admin)[^'\"]*)['\"]",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.I):
            candidate = match.strip().strip("'\"")
            if candidate.startswith("/") and candidate not in paths:
                paths.append(candidate)
    return paths


def _guess_method(text: str, default: str) -> str:
    lowered = text.lower()
    if any(term in lowered for term in ("post(", '"method":"post"', "method: 'post'", 'method: "post"')):
        return "POST"
    if any(term in lowered for term in ("put(", "method: 'put'", 'method: "put"')):
        return "PUT"
    if any(term in lowered for term in ("delete(", "method: 'delete'", 'method: "delete"')):
        return "DELETE"
    return default


def _auth_context_from_text(text: str) -> str:
    lowered = text.lower()
    if any(term in lowered for term in ("authorization:", "cookie:", "bearer ", "session=", "ldso=", "ob_ldso=", "pa_ldso=")):
        return "authenticated"
    if any(term in lowered for term in ("login", "sign in", "sso", "session")):
        return "auth"
    return "public"


def _attack_type_for_surface(surface: SurfaceRecord, text: str) -> str:
    if any(term in text for term in ("xsstrike", "dalfox", "xss", "<script", "onerror=", "alert(1)")):
        return "xss"
    if any(term in text for term in ("sqlmap", " union select ", "' or 1=1", "\" or 1=1", "sqli")):
        return "sqli"
    if any(term in text for term in ("ssrf", "burp collaborator", "interactsh", "metadata.google.internal", "169.254.169.254")):
        return "ssrf"
    if surface.surface_type == "graphql":
        return "graphql"
    if surface.surface_type == "js":
        return "js_analysis"
    if surface.surface_type == "auth":
        return "auth"
    if surface.surface_type == "upload":
        return "upload"
    if surface.surface_type == "redirect":
        return "redirect"
    if surface.surface_type == "version":
        return "version"
    if surface.surface_type == "api":
        return "parameter" if "?" in (surface.meta or {}).get("url", "") else "api"
    if "sourcemappingurl" in text:
        return "sourcemap"
    return "probe"


def _priority_attacks_for_surface(surface: SurfaceRecord) -> list[str]:
    if surface.surface_type == "graphql":
        return ["graphql", "auth", "parameter", "xss"]
    if surface.surface_type == "js":
        return ["js_analysis", "sourcemap", "api", "graphql", "xss"]
    if surface.surface_type == "api":
        return ["auth", "parameter", "sqli", "version", "api"]
    if surface.surface_type == "auth":
        return ["auth", "session", "reset", "xss"]
    if surface.surface_type == "upload":
        return ["upload", "content_type", "path"]
    if surface.surface_type == "redirect":
        return ["redirect", "ssrf", "parameter", "xss"]
    if surface.surface_type == "version":
        return ["version", "headers", "debug"]
    if surface.surface_type == "web":
        if "parameter" in surface.tags:
            return ["xss", "sqli", "parameter", "probe"]
        return ["xss", "probe"]
    return ["probe"]


def _attack_outcome(text: str, ok: bool, action_name: str) -> str:
    if action_name == "record_finding" and ok:
        return "confirmed"
    if not ok:
        return "error"
    if any(term in text for term in ("401 unauthorized", "403 forbidden", "404 not found", "authentication required", "access denied")):
        return "rejected"
    if any(term in text for term in ("200 ok", "graphql", "swagger", "openapi", "sourcemap", "sourcemappingurl", "x-powered-by", "set-cookie", "xsstrike", "sqlmap", "interactsh", "burp collaborator")):
        return "interesting"
    return "tested"


def _attack_tags(text: str, action_name: str, outcome: str, attack_type: str) -> list[str]:
    tags = [attack_type, outcome, action_name]
    lowered = text.lower()
    if any(term in lowered for term in ("graphql", "openapi", "swagger")):
        tags.append("schema")
    if any(term in lowered for term in ("sourcemappingurl", ".map")):
        tags.append("js")
    if any(term in lowered for term in ("url=", "uri=", "next=", "return=")):
        tags.append("parameter")
    return list(dict.fromkeys(tag for tag in tags if tag))


def _surface_priority(surface: SurfaceRecord) -> int:
    weights = {
        "graphql": 100,
        "api": 90,
        "js": 85,
        "auth": 80,
        "upload": 75,
        "redirect": 70,
        "version": 60,
        "web": 40,
        "js_map": 35,
    }
    return weights.get(surface.surface_type, 30) + (5 if "parameter" in surface.tags else 0)


def _endpoint_tags(url: str) -> list[str]:
    parsed = urlparse(url)
    text = f"{parsed.path}?{parsed.query}".lower()
    tags: list[str] = []
    if "/api/" in text or re.search(r"/v[0-9]\b", text):
        tags.append("api")
    if "graphql" in text:
        tags.append("graphql")
    if any(term in text for term in ("login", "auth", "oauth", "sso", "session")):
        tags.append("auth")
    if parsed.query:
        tags.append("parameter")
    if text.endswith(".js") or ".js?" in text:
        tags.append("js")
    if any(term in text for term in ("version", "debug", "status", "health")):
        tags.append("version")
    if any(term in parsed.query.lower() for term in ("url=", "uri=", "next=", "redirect=", "return=")):
        tags.append("redirect")
    if any(term in text for term in ("upload", "import", "export")):
        tags.append("upload")
    return tags


def _extract_urls(text: str) -> list[str]:
    urls: list[str] = []
    for value in re.findall(r"https?://[^\s\"'<>]+", text):
        cleaned = value.rstrip(".,);]}")
        if cleaned not in urls:
            urls.append(cleaned)
    return urls[:200]


def _path_pattern(path: str) -> str:
    path = path or "/"
    path = re.sub(r"/[0-9]+(?=/|$)", "/{id}", path)
    return re.sub(r"/[a-f0-9]{8,}(?=/|$)", "/{hex}", path, flags=re.I)


def _present_tools(content: str) -> list[str]:
    return sorted(set(re.findall(r"^([A-Za-z0-9_.-]+)=present$", content, flags=re.M)))


def _research_family(query: str) -> str:
    lowered = query.lower()
    if "github.com" in lowered:
        return "github"
    if "medium.com" in lowered:
        return "medium"
    if "stackoverflow.com" in lowered or "stack overflow" in lowered:
        return "stackoverflow"
    if "cvedetails.com" in lowered or "cve" in lowered:
        return "cve"
    if "snyk.io" in lowered or "snyk" in lowered:
        return "snyk"
    return "general"


def _short(value: str, limit: int = 800) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return value if len(value) <= limit else value[:limit] + f"...[truncated {len(value) - limit} chars]"


def _row_to_fact(row: tuple[Any, ...]) -> ReconFact:
    return ReconFact(row[0], row[1], row[2], row[3], row[4], row[5], row[6], tuple(json.loads(row[7] or "[]")), json.loads(row[8] or "{}"))


def _fact_fingerprint(kind: str, key: str, value: str) -> str:
    data = "\n".join([kind.lower(), key.lower(), value.lower()])
    return hashlib.sha256(data.encode("utf-8", errors="replace")).hexdigest()[:32]


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
