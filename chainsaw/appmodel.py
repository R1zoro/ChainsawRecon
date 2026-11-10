"""Project-wide application model.

The model is a revisioned graph stored in the project's ``knowledge.db``:

    application -> service -> route -> input
    identity -> route (authenticates)
    entity / flow / technology / finding

The journal records *why* something changed; this store records the current
best-known structure with first/last seen and confidence. It is project-wide and
shared across sessions.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _loads(value: str) -> Any:
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def _stable(prefix: str, *parts: str) -> str:
    payload = "\n".join(parts).encode("utf-8", errors="replace")
    return f"{prefix}_{hashlib.sha256(payload).hexdigest()[:14]}"


@dataclass(frozen=True)
class AppEntity:
    id: str
    project_id: str
    kind: str
    name: str
    revision: int
    confidence: str
    first_seen: str
    last_seen: str
    tags: tuple[str, ...]
    meta: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "kind": self.kind,
            "name": self.name,
            "revision": self.revision,
            "confidence": self.confidence,
            "firstSeen": self.first_seen,
            "lastSeen": self.last_seen,
            "stale": False,
            "tags": list(self.tags),
            "meta": self.meta,
        }


@dataclass(frozen=True)
class AppEdge:
    id: str
    source_id: str
    target_id: str
    relation: str
    confidence: str
    trust_boundary: bool
    meta: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sourceId": self.source_id,
            "targetId": self.target_id,
            "relation": self.relation,
            "confidence": self.confidence,
            "trustBoundary": self.trust_boundary,
            "meta": self.meta,
        }


class AppModel:
    def __init__(self, db_path: Path | str, project_id: str) -> None:
        self.db_path = Path(db_path)
        self.project_id = project_id
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._ensure()

    def _ensure(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_entities(
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
                name TEXT NOT NULL, revision INTEGER NOT NULL, confidence TEXT NOT NULL,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
                tags TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_edges(
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL,
                target_id TEXT NOT NULL, relation TEXT NOT NULL, confidence TEXT NOT NULL,
                trust_boundary INTEGER NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_revisions(
                id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL,
                revision INTEGER NOT NULL, changed_at TEXT NOT NULL,
                change TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_notes(
                id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL,
                content TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_app_entities_kind ON app_entities(kind);
            CREATE INDEX IF NOT EXISTS idx_app_entities_last ON app_entities(last_seen);
            CREATE INDEX IF NOT EXISTS idx_app_edges_source ON app_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_app_edges_target ON app_edges(target_id);
            """
        )
        self.conn.commit()

    # ── upserts ──────────────────────────────────────────────────────

    def _upsert(
        self,
        *,
        entity_id: str,
        kind: str,
        name: str,
        meta: dict[str, Any] | None = None,
        confidence: str = "observed",
        tags: Iterable[str] = (),
        source: str = "manual",
    ) -> AppEntity:
        now = _now()
        existing = self.get(entity_id)
        revision = (existing.revision + 1) if existing else 1
        merged_meta = dict(existing.meta or {}) if existing else {}
        merged_meta.update(meta or {})
        merged_meta.setdefault("source", source)
        if existing:
            self.conn.execute(
                "UPDATE app_entities SET name=?, revision=?, confidence=?, last_seen=?, tags=?, meta=? WHERE id=?",
                (name, revision, confidence, now, _json(sorted(set(tags) | set(existing.tags))), _json(merged_meta), entity_id),
            )
        else:
            self.conn.execute(
                "INSERT INTO app_entities(id,project_id,kind,name,revision,confidence,first_seen,last_seen,tags,meta) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (entity_id, self.project_id, kind, name, revision, confidence, now, now, _json(sorted(set(tags))), _json(merged_meta)),
            )
        self.conn.execute(
            "INSERT INTO app_revisions(entity_id,revision,changed_at,change,meta) VALUES(?,?,?,?,?)",
            (entity_id, revision, now, "upsert", _json(merged_meta)),
        )
        self.conn.commit()
        return self.get(entity_id)  # type: ignore[return-value]

    def ensure_application(self, name: str, domains: Iterable[str] = ()) -> AppEntity:
        return self._upsert(
            entity_id=_stable("app", self.project_id, name.lower()),
            kind="application",
            name=name,
            meta={"domains": sorted(set(domains))},
            confidence="confirmed",
            tags=("application",),
            source="project",
        )

    def ensure_service(
        self,
        app_id: str,
        host: str,
        *,
        port: int = 443,
        tls: str = "unknown",
        source: str = "project",
    ) -> AppEntity:
        service = self._upsert(
            entity_id=_stable("svc", self.project_id, host.lower()),
            kind="service",
            name=host.lower(),
            meta={"host": host.lower(), "port": port, "tls": tls, "appId": app_id},
            tags=("service",),
            source=source,
        )
        self.link(app_id, service.id, "exposes", confidence="confirmed", source=source)
        return service

    def ensure_route(
        self,
        service_id: str,
        method: str,
        path: str,
        *,
        auth_boundary: str = "unknown",
        status_codes: Iterable[int] = (),
        content_types: Iterable[str] = (),
        source: str = "observed",
    ) -> AppEntity:
        method = method.upper()
        path = path or "/"
        route = self._upsert(
            entity_id=_stable("rte", self.project_id, service_id, method, path),
            kind="route",
            name=f"{method} {path}",
            meta={
                "serviceId": service_id,
                "method": method,
                "path": path,
                "authBoundary": auth_boundary,
                "statusCodes": sorted(set(status_codes)),
                "contentTypes": sorted(set(content_types)),
            },
            tags=("route",),
            source=source,
        )
        self.link(service_id, route.id, "serves", confidence="observed", source=source)
        return route

    def ensure_input(
        self,
        route_id: str,
        name: str,
        *,
        location: str = "query",
        data_type: str = "string",
        example: str = "",
        source: str = "observed",
    ) -> AppEntity:
        item = self._upsert(
            entity_id=_stable("inp", self.project_id, route_id, name, location),
            kind="input",
            name=name,
            meta={"routeId": route_id, "location": location, "type": data_type, "example": example},
            tags=("input", location),
            source=source,
        )
        self.link(route_id, item.id, "accepts", confidence="observed", source=source)
        return item

    def ensure_identity(
        self,
        label: str,
        *,
        role: str = "",
        tenant: str = "",
        mechanism: str = "cookie",
        source: str = "operator",
    ) -> AppEntity:
        return self._upsert(
            entity_id=_stable("idn", self.project_id, label.lower()),
            kind="identity",
            name=label,
            meta={"role": role, "tenant": tenant, "mechanism": mechanism},
            confidence="confirmed",
            tags=("identity", role, tenant),
            source=source,
        )

    def ensure_technology(
        self,
        name: str,
        *,
        category: str = "unknown",
        version: str = "",
        app_id: str | None = None,
        source: str = "observed",
    ) -> AppEntity:
        tech = self._upsert(
            entity_id=_stable("tech", self.project_id, name.lower()),
            kind="technology",
            name=name,
            meta={"category": category, "version": version},
            tags=("technology", category),
            source=source,
        )
        if app_id:
            self.link(app_id, tech.id, "implements", confidence="observed", source=source)
        return tech

    def ensure_entity(self, name: str, *, object_type: str = "object", source: str = "observed") -> AppEntity:
        return self._upsert(
            entity_id=_stable("ent", self.project_id, name.lower()),
            kind="entity",
            name=name,
            meta={"objectType": object_type},
            tags=("entity", object_type),
            source=source,
        )

    def ensure_flow(self, name: str, *, steps: Iterable[str] = (), source: str = "observed") -> AppEntity:
        return self._upsert(
            entity_id=_stable("flw", self.project_id, name.lower()),
            kind="flow",
            name=name,
            meta={"steps": list(steps)},
            tags=("flow",),
            source=source,
        )

    def upsert_finding(
        self,
        finding_id: str,
        title: str,
        *,
        severity: str,
        state: str,
        asset: str,
        evidence_ids: Iterable[str] = (),
        source: str = "session",
    ) -> AppEntity:
        return self._upsert(
            entity_id=_stable("fnd", self.project_id, finding_id),
            kind="finding",
            name=title,
            meta={"findingId": finding_id, "severity": severity, "state": state, "asset": asset, "evidenceIds": list(evidence_ids)},
            confidence="confirmed" if state == "validated" else "observed",
            tags=("finding", severity, state),
            source=source,
        )

    def link(
        self,
        source_id: str,
        target_id: str,
        relation: str,
        *,
        confidence: str = "observed",
        trust_boundary: bool = False,
        source: str = "manual",
        meta: dict[str, Any] | None = None,
    ) -> AppEdge:
        edge_id = _stable("edge", self.project_id, source_id, target_id, relation)
        payload = {"source": source, **(meta or {})}
        self.conn.execute(
            "INSERT INTO app_edges(id,project_id,source_id,target_id,relation,confidence,trust_boundary,meta) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET confidence=excluded.confidence,"
            "trust_boundary=excluded.trust_boundary,meta=excluded.meta",
            (edge_id, self.project_id, source_id, target_id, relation, confidence, 1 if trust_boundary else 0, _json(payload)),
        )
        self.conn.commit()
        return AppEdge(edge_id, source_id, target_id, relation, confidence, trust_boundary, payload)

    def seed_targets(self, application_name: str, targets: Iterable[str]) -> tuple[AppEntity, list[AppEntity]]:
        domains = []
        hosts = []
        for target in targets:
            value = str(target).strip()
            if not value:
                continue
            parsed = urlparse(value if "://" in value else f"https://{value}")
            host = (parsed.hostname or value).lower()
            if host:
                hosts.append(host)
                domains.append(".".join(host.split(".")[-2:]) if "." in host else host)
        app = self.ensure_application(application_name, domains)
        services = [self.ensure_service(app.id, host) for host in sorted(set(hosts))]
        return app, services

    # ── queries ──────────────────────────────────────────────────────

    def get(self, entity_id: str) -> AppEntity | None:
        row = self.conn.execute(
            "SELECT id,project_id,kind,name,revision,confidence,first_seen,last_seen,tags,meta "
            "FROM app_entities WHERE id=?",
            (entity_id,),
        ).fetchone()
        if not row:
            return None
        return AppEntity(
            id=row[0],
            project_id=row[1],
            kind=row[2],
            name=row[3],
            revision=row[4],
            confidence=row[5],
            first_seen=row[6],
            last_seen=row[7],
            tags=tuple(_loads(row[8])) if _loads(row[8]) else (),
            meta=_loads(row[9]),
        )

    def list_entities(
        self,
        *,
        kind: str | None = None,
        query: str = "",
        stale_only: bool = False,
        older_than_days: int = 30,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses = ["project_id=?"]
        params: list[Any] = [self.project_id]
        if kind:
            clauses.append("kind=?")
            params.append(kind)
        if query:
            clauses.append("(name LIKE ? OR meta LIKE ?)")
            like = f"%{query}%"
            params.extend([like, like])
        if stale_only:
            clauses.append("last_seen < ?")
            params.append(_cutoff(older_than_days))
        sql = (
            "SELECT id,project_id,kind,name,revision,confidence,first_seen,last_seen,tags,meta "
            "FROM app_entities WHERE " + " AND ".join(clauses) + " ORDER BY kind,name LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])
        rows = self.conn.execute(sql, params).fetchall()
        return [self._row_to_dict(row, older_than_days) for row in rows]

    def _row_to_dict(self, row: Any, older_than_days: int) -> dict[str, Any]:
        last_seen = str(row[7])
        return {
            "id": row[0],
            "projectId": row[1],
            "kind": row[2],
            "name": row[3],
            "revision": row[4],
            "confidence": row[5],
            "firstSeen": row[6],
            "lastSeen": last_seen,
            "stale": last_seen < _cutoff(older_than_days),
            "tags": _loads(row[8]) if _loads(row[8]) else [],
            "meta": _loads(row[9]),
        }

    def edges(self, entity_id: str | None = None) -> list[dict[str, Any]]:
        if entity_id:
            rows = self.conn.execute(
                "SELECT id,source_id,target_id,relation,confidence,trust_boundary,meta FROM app_edges "
                "WHERE project_id=? AND (source_id=? OR target_id=?)",
                (self.project_id, entity_id, entity_id),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id,source_id,target_id,relation,confidence,trust_boundary,meta FROM app_edges WHERE project_id=?",
                (self.project_id,),
            ).fetchall()
        return [
            {
                "id": row[0],
                "sourceId": row[1],
                "targetId": row[2],
                "relation": row[3],
                "confidence": row[4],
                "trustBoundary": bool(row[5]),
                "meta": _loads(row[6]),
            }
            for row in rows
        ]

    def graph(self, *, root_id: str | None = None, depth: int = 2, max_nodes: int = 300) -> dict[str, Any]:
        entities = self.list_entities(limit=1000)
        by_id = {item["id"]: item for item in entities}
        edges = self.edges()
        if root_id:
            selected = {root_id}
            frontier = {root_id}
            for _ in range(max(1, depth)):
                next_frontier = set()
                for edge in edges:
                    if edge["sourceId"] in frontier and edge["targetId"] in by_id:
                        next_frontier.add(edge["targetId"])
                    if edge["targetId"] in frontier and edge["sourceId"] in by_id:
                        next_frontier.add(edge["sourceId"])
                selected |= next_frontier
                frontier = next_frontier
            entities = [item for item in entities if item["id"] in selected]
            edges = [edge for edge in edges if edge["sourceId"] in selected and edge["targetId"] in selected]
        truncated = len(entities) > max_nodes
        if truncated:
            entities = entities[:max_nodes]
            ids = {item["id"] for item in entities}
            edges = [edge for edge in edges if edge["sourceId"] in ids and edge["targetId"] in ids]
        return {
            "entities": entities,
            "edges": edges,
            "truncated": truncated,
            "totalEntities": len(by_id),
        }

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for row in self.conn.execute(
            "SELECT kind,COUNT(*) FROM app_entities WHERE project_id=? GROUP BY kind",
            (self.project_id,),
        ):
            counts[str(row[0])] = int(row[1])
        return {
            "projectId": self.project_id,
            "counts": counts,
            "staleAssets": len(self.list_entities(stale_only=True, limit=1000)),
            "edges": len(self.edges()),
        }

    def add_note(self, entity_id: str, content: str) -> dict[str, Any]:
        now = _now()
        cursor = self.conn.execute(
            "INSERT INTO app_notes(entity_id,content,created_at) VALUES(?,?,?)",
            (entity_id, content, now),
        )
        self.conn.commit()
        return {"id": cursor.lastrowid, "entityId": entity_id, "content": content, "createdAt": now}

    def notes(self, entity_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,content,created_at FROM app_notes WHERE entity_id=? ORDER BY id DESC",
            (entity_id,),
        ).fetchall()
        return [{"id": row[0], "entityId": entity_id, "content": row[1], "createdAt": row[2]} for row in rows]

    def close(self) -> None:
        self.conn.close()


def _cutoff(days: int) -> str:
    from datetime import timedelta

    return (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat()


__all__ = ["AppEdge", "AppEntity", "AppModel"]
