"""Native HTTP workbench: capture store, replay, compare, evidence, import/export.

The workbench is deliberately independent from model reasoning. It stores HTTP
transactions, enforces scope before any transmission, and produces redacted
views for the UI and for evidence artifacts.
"""

from __future__ import annotations

import base64
import difflib
import hashlib
import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx

REDACTED = "\u00abredacted\u00bb"
SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization",
    "api-key",
    "access-token",
}
DESTRUCTIVE_METHODS = {"DELETE", "PUT", "PATCH"}
PREVIEW_LIMIT = 64 * 1024
MAX_STORED_BODY = 5 * 1024 * 1024
DEFAULT_TIMEOUT = 20.0


class WorkbenchError(RuntimeError):
    """Base error for workbench operations."""


class FlowNotFound(WorkbenchError):
    def __init__(self, flow_id: str) -> None:
        self.flow_id = flow_id
        super().__init__(f"request not found: {flow_id}")


class ApprovalRequired(WorkbenchError):
    def __init__(self, method: str) -> None:
        self.method = method
        super().__init__(
            f"destructive method {method} requires an operator justification before replay"
        )


class TransportFailed(WorkbenchError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _loads(value: str | None) -> Any:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


def _clip(value: str, limit: int = PREVIEW_LIMIT) -> tuple[str, bool]:
    if len(value) <= limit:
        return value, False
    return value[:limit], True


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        str(key): REDACTED if str(key).lower() in SENSITIVE_HEADERS else str(value)
        for key, value in headers.items()
    }


def _header_pairs(headers: dict[str, str]) -> list[tuple[str, str]]:
    return [(str(key), str(value)) for key, value in headers.items()]


def _parse_raw_http(raw: str) -> tuple[str, str, dict[str, str], str]:
    """Parse an HTTP/1.x message into (start_line, version, headers, body)."""

    normalized = raw.replace("\r\n", "\n")
    head, _, body = normalized.partition("\n\n")
    lines = head.split("\n")
    start_line = lines[0] if lines else ""
    version = ""
    if start_line.startswith("HTTP/"):
        parts = start_line.split(" ", 1)
        version = parts[0]
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line:
            continue
        key, sep, value = line.partition(":")
        if not sep:
            continue
        headers[key.strip()] = value.strip()
    return start_line, version, headers, body


def _raw_http(
    start_line: str,
    headers: dict[str, str],
    body: str,
    *,
    redact: bool = True,
) -> str:
    visible = redact_headers(headers) if redact else headers
    lines = [start_line, *[f"{key}: {value}" for key, value in visible.items()], "", body]
    return "\r\n".join(lines)


def _split_url(url: str) -> tuple[str, str, str]:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    query = parts.query
    path = parts.path or "/"
    return host, path, query


def _content_type(headers: dict[str, str]) -> str:
    for key, value in headers.items():
        if key.lower() == "content-type":
            return value.split(";", 1)[0].strip()
    return ""


def _auth_context(headers: dict[str, str]) -> str:
    lowered = {key.lower() for key in headers}
    if "authorization" in lowered:
        return "authorization"
    if "cookie" in lowered:
        return "cookie"
    return "unauthenticated"


@dataclass(frozen=True)
class ScopeDecision:
    allowed: bool
    reason: str


@dataclass
class ScopePolicy:
    allowed_domains: tuple[str, ...] = ()
    excluded_domains: tuple[str, ...] = ()
    allowed_urls: tuple[str, ...] = ()

    @classmethod
    def from_scope(cls, scope: dict[str, Any] | None) -> ScopePolicy:
        scope = scope or {}

        def strings(key: str) -> tuple[str, ...]:
            value = scope.get(key) or []
            if isinstance(value, str):
                value = [value]
            return tuple(str(item).strip() for item in value if str(item).strip())

        return cls(
            allowed_domains=tuple(item.lower().lstrip(".") for item in strings("allowed_domains")),
            excluded_domains=tuple(
                item.lower().lstrip(".") for item in strings("excluded_domains")
            ),
            allowed_urls=strings("allowed_urls"),
        )

    @classmethod
    def from_project(cls, project_path: Path) -> ScopePolicy:
        scope_file = project_path / ".chainsaw" / "scope" / "scope.json"
        try:
            data = json.loads(scope_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        return cls.from_scope(data if isinstance(data, dict) else {})

    def _domain_matches(self, host: str, domain: str) -> bool:
        host = host.lower().split(":", 1)[0]
        return host == domain or host.endswith("." + domain)

    def check(self, url: str) -> ScopeDecision:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        if parts.scheme not in {"http", "https"} or not host:
            return ScopeDecision(False, "invalid or unsupported URL")
        for domain in self.excluded_domains:
            if self._domain_matches(host, domain):
                return ScopeDecision(False, f"{host} matches excluded domain {domain}")
        for domain in self.allowed_domains:
            if self._domain_matches(host, domain):
                return ScopeDecision(True, f"{host} matches allowed domain {domain}")
        for allowed in self.allowed_urls:
            allowed_parts = urlsplit(allowed if "://" in allowed else f"https://{allowed}")
            allowed_host = (allowed_parts.hostname or "").lower()
            if not allowed_host or allowed_host != host:
                continue
            if allowed_parts.scheme and parts.scheme != allowed_parts.scheme:
                continue
            allowed_path = allowed_parts.path or "/"
            if allowed_path == "/" or parts.path.startswith(allowed_path):
                return ScopeDecision(True, f"{url} matches allowed URL {allowed}")
        if not (self.allowed_domains or self.allowed_urls):
            return ScopeDecision(False, "no scope has been defined for this project")
        return ScopeDecision(False, f"{host} is not in the engagement scope")


@dataclass
class Flow:
    id: str
    project_id: str
    method: str
    url: str
    host: str
    path: str
    status: int = 0
    request_headers: dict[str, str] = field(default_factory=dict)
    request_body: str = ""
    response_headers: dict[str, str] = field(default_factory=dict)
    response_body: str = ""
    size_bytes: int = 0
    duration_ms: int = 0
    auth_context: str = ""
    tags: list[str] = field(default_factory=list)
    captured_at: str = ""
    in_scope: bool = False
    parent_id: str | None = None
    source: str = "capture"
    session_id: str = ""

    def __post_init__(self) -> None:
        if not self.host or not self.path:
            host, path, query = _split_url(self.url)
            self.host = self.host or host
            self.path = self.path or (path + (f"?{query}" if query else ""))
        if not self.captured_at:
            self.captured_at = _now()
        if not self.auth_context:
            self.auth_context = _auth_context(self.request_headers)
        if not isinstance(self.tags, list):
            self.tags = []

    def public(self, *, preview_limit: int = PREVIEW_LIMIT) -> dict[str, Any]:
        request_preview, _ = _clip(self.request_body, preview_limit)
        response_preview, _ = _clip(self.response_body, preview_limit)
        return {
            "id": self.id,
            "method": self.method,
            "url": self.url,
            "host": self.host,
            "path": self.path,
            "status": self.status,
            "requestHeaders": redact_headers(self.request_headers),
            "requestBodyPreview": request_preview,
            "responseHeaders": redact_headers(self.response_headers),
            "responseBodyPreview": response_preview,
            "sizeBytes": self.size_bytes,
            "durationMs": self.duration_ms,
            "authContext": self.auth_context,
            "tags": list(self.tags),
            "capturedAt": self.captured_at,
            "inScope": self.in_scope,
            "contentType": _content_type(self.response_headers),
            "parentId": self.parent_id,
            "source": self.source,
        }

    def detail(self, *, preview_limit: int = PREVIEW_LIMIT) -> dict[str, Any]:
        raw_request = _raw_http(
            f"{self.method} {self.path} HTTP/1.1",
            self.request_headers,
            self.request_body,
            redact=True,
        )
        raw_response = _raw_http(
            f"HTTP/1.1 {self.status}",
            self.response_headers,
            self.response_body,
            redact=True,
        )
        _, request_truncated = _clip(self.request_body, preview_limit)
        _, response_truncated = _clip(self.response_body, preview_limit)
        return {
            "requestId": self.id,
            "request": self.public(preview_limit=preview_limit),
            "rawRequest": raw_request,
            "rawResponse": raw_response,
            "truncated": request_truncated or response_truncated,
        }


FLOW_COLUMNS = (
    "id",
    "project_id",
    "session_id",
    "method",
    "url",
    "host",
    "path",
    "status",
    "request_headers",
    "request_body",
    "response_headers",
    "response_body",
    "size_bytes",
    "duration_ms",
    "auth_context",
    "tags",
    "captured_at",
    "in_scope",
    "parent_id",
    "source",
)


class WorkbenchStore:
    """SQLite-backed capture store for one project."""

    def __init__(self, db_path: Path, project_id: str) -> None:
        self.db_path = db_path
        self.project_id = project_id
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path), timeout=10)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=10000")
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS flows(
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT '',
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                host TEXT NOT NULL,
                path TEXT NOT NULL,
                status INTEGER NOT NULL DEFAULT 0,
                request_headers TEXT NOT NULL,
                request_body TEXT NOT NULL,
                response_headers TEXT NOT NULL,
                response_body TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                auth_context TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                in_scope INTEGER NOT NULL DEFAULT 0,
                parent_id TEXT,
                source TEXT NOT NULL DEFAULT 'capture'
            );
            CREATE INDEX IF NOT EXISTS idx_flows_project ON flows(project_id, captured_at);
            CREATE TABLE IF NOT EXISTS evidence(
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT '',
                request_id TEXT NOT NULL,
                response_id TEXT NOT NULL DEFAULT '',
                hypothesis_id TEXT NOT NULL DEFAULT '',
                task_id TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                artifact_id TEXT NOT NULL,
                hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> WorkbenchStore:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ── flows ─────────────────────────────────────────────────────────

    def add_flow(self, flow: Flow) -> dict[str, Any]:
        flow.project_id = flow.project_id or self.project_id
        self.conn.execute(
            "INSERT OR REPLACE INTO flows("
            + ",".join(FLOW_COLUMNS)
            + ") VALUES("
            + ",".join("?" for _ in FLOW_COLUMNS)
            + ")",
            (
                flow.id,
                flow.project_id,
                flow.session_id,
                flow.method.upper(),
                flow.url,
                flow.host,
                flow.path,
                int(flow.status),
                _json(flow.request_headers),
                flow.request_body,
                _json(flow.response_headers),
                flow.response_body,
                int(flow.size_bytes),
                int(flow.duration_ms),
                flow.auth_context,
                _json(flow.tags),
                flow.captured_at,
                1 if flow.in_scope else 0,
                flow.parent_id,
                flow.source,
            ),
        )
        self.conn.commit()
        return flow.public()

    def get_flow(self, flow_id: str) -> Flow | None:
        row = self.conn.execute(
            f"SELECT {','.join(FLOW_COLUMNS)} FROM flows WHERE id=? AND project_id=?",
            (flow_id, self.project_id),
        ).fetchone()
        return self._row_to_flow(row) if row else None

    def require_flow(self, flow_id: str) -> Flow:
        flow = self.get_flow(flow_id)
        if flow is None:
            raise FlowNotFound(flow_id)
        return flow

    def _row_to_flow(self, row: sqlite3.Row) -> Flow:
        return Flow(
            id=row["id"],
            project_id=row["project_id"],
            session_id=row["session_id"],
            method=row["method"],
            url=row["url"],
            host=row["host"],
            path=row["path"],
            status=int(row["status"]),
            request_headers=dict(_loads(row["request_headers"])),
            request_body=row["request_body"],
            response_headers=dict(_loads(row["response_headers"])),
            response_body=row["response_body"],
            size_bytes=int(row["size_bytes"]),
            duration_ms=int(row["duration_ms"]),
            auth_context=row["auth_context"],
            tags=list(_loads(row["tags"]) or []),
            captured_at=row["captured_at"],
            in_scope=bool(row["in_scope"]),
            parent_id=row["parent_id"],
            source=row["source"],
        )

    def list_flows(
        self,
        *,
        q: str = "",
        host: str = "",
        method: str = "",
        status: str = "",
        content_type: str = "",
        auth: str = "",
        tag: str = "",
        in_scope_only: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["project_id=?"]
        params: list[Any] = [self.project_id]
        if host:
            clauses.append("host=?")
            params.append(host)
        if method:
            clauses.append("upper(method)=?")
            params.append(method.upper())
        if status:
            if status.endswith("xx") and status[0].isdigit():
                clauses.append("status>=? AND status<?")
                params.extend([int(status[0]) * 100, (int(status[0]) + 1) * 100])
            elif status.isdigit():
                clauses.append("status=?")
                params.append(int(status))
        if auth:
            clauses.append("auth_context=?")
            params.append(auth)
        if in_scope_only:
            clauses.append("in_scope=1")
        if q:
            needle = f"%{q.lower()}%"
            clauses.append(
                "(lower(url) LIKE ? OR lower(path) LIKE ? OR lower(method) LIKE ? "
                "OR lower(auth_context) LIKE ? OR lower(tags) LIKE ? "
                "OR lower(request_body) LIKE ? OR lower(response_body) LIKE ?)"
            )
            params.extend([needle] * 7)
        if tag:
            clauses.append("lower(tags) LIKE ?")
            params.append(f"%{tag.lower()}%")
        if content_type:
            clauses.append("lower(response_headers) LIKE ?")
            params.append(f"%{content_type.lower()}%")
        where = " AND ".join(clauses)
        total = int(
            self.conn.execute(f"SELECT count(*) FROM flows WHERE {where}", params).fetchone()[0]
        )
        limit = max(1, min(int(limit), 1000))
        offset = max(0, int(offset))
        rows = self.conn.execute(
            f"SELECT {','.join(FLOW_COLUMNS)} FROM flows WHERE {where} "
            "ORDER BY captured_at DESC, rowid DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return [self._row_to_flow(row).public() for row in rows], total

    # ── evidence ──────────────────────────────────────────────────────

    def record_evidence(
        self,
        *,
        request_id: str,
        response_id: str = "",
        hypothesis_id: str = "",
        task_id: str = "",
        note: str = "",
        session_id: str = "",
        artifact_dir: Path,
    ) -> dict[str, Any]:
        flow = self.require_flow(request_id)
        evidence_id = _new_id("evd")
        artifact = {
            "id": evidence_id,
            "requestId": request_id,
            "responseId": response_id or f"resp_{request_id}",
            "hypothesisId": hypothesis_id,
            "taskId": task_id,
            "note": note,
            "capturedAt": _now(),
            "request": {
                "method": flow.method,
                "url": flow.url,
                "headers": redact_headers(flow.request_headers),
                "body": flow.request_body,
            },
            "response": {
                "status": flow.status,
                "headers": redact_headers(flow.response_headers),
                "body": flow.response_body,
            },
        }
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = artifact_dir / f"{evidence_id}.json"
        payload = json.dumps(artifact, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        artifact_path.write_bytes(payload.encode("utf-8"))
        digest = "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
        created_at = _now()
        self.conn.execute(
            "INSERT INTO evidence(id,project_id,session_id,request_id,response_id,"
            "hypothesis_id,task_id,note,artifact_id,hash,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                evidence_id,
                self.project_id,
                session_id,
                request_id,
                response_id or f"resp_{request_id}",
                hypothesis_id,
                task_id,
                note,
                str(artifact_path),
                digest,
                created_at,
            ),
        )
        self.conn.commit()
        return {
            "id": evidence_id,
            "kind": "http_pair",
            "summary": f"{flow.method} {flow.path} -> {flow.status}",
            "artifactId": str(artifact_path),
            "hash": digest,
            "requestId": request_id,
            "responseId": response_id or f"resp_{request_id}",
            "hypothesisId": hypothesis_id,
            "taskId": task_id,
            "note": note,
            "promoted": 0,
            "createdAt": created_at,
        }

    def evidence(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,request_id,response_id,hypothesis_id,task_id,note,artifact_id,hash,created_at "
            "FROM evidence WHERE project_id=? ORDER BY created_at",
            (self.project_id,),
        ).fetchall()
        keys = (
            "id",
            "requestId",
            "responseId",
            "hypothesisId",
            "taskId",
            "note",
            "artifactId",
            "hash",
            "createdAt",
        )
        return [dict(zip(keys, row, strict=False)) for row in rows]

    # ── export ────────────────────────────────────────────────────────

    def export_har(self) -> dict[str, Any]:
        flows, _ = self.list_flows(limit=1000, offset=0)
        entries = []
        for item in flows:
            flow = self.require_flow(item["id"])
            headers = redact_headers(flow.request_headers)
            response_headers = redact_headers(flow.response_headers)
            entries.append(
                {
                    "startedDateTime": flow.captured_at,
                    "time": flow.duration_ms,
                    "request": {
                        "method": flow.method,
                        "url": flow.url,
                        "httpVersion": "HTTP/1.1",
                        "cookies": [],
                        "headers": [
                            {"name": key, "value": value} for key, value in headers.items()
                        ],
                        "queryString": [
                            {"name": key, "value": value}
                            for key, value in parse_qsl(urlsplit(flow.url).query)
                        ],
                        "postData": {"mimeType": _content_type(flow.request_headers), "text": flow.request_body}
                        if flow.request_body
                        else None,
                        "headersSize": -1,
                        "bodySize": len(flow.request_body.encode("utf-8")),
                    },
                    "response": {
                        "status": flow.status,
                        "statusText": "",
                        "httpVersion": "HTTP/1.1",
                        "cookies": [],
                        "headers": [
                            {"name": key, "value": value}
                            for key, value in response_headers.items()
                        ],
                        "content": {
                            "size": flow.size_bytes,
                            "mimeType": _content_type(flow.response_headers),
                            "text": flow.response_body,
                        },
                        "redirectURL": "",
                        "headersSize": -1,
                        "bodySize": flow.size_bytes,
                    },
                    "cache": {},
                    "timings": {"send": 0, "wait": flow.duration_ms, "receive": 0},
                }
            )
        return {
            "log": {
                "version": "1.2",
                "creator": {"name": "ChainsawRecon", "version": "2.0.0-preview"},
                "entries": entries,
            }
        }

    def export_jsonl(self) -> list[dict[str, Any]]:
        flows, _ = self.list_flows(limit=1000, offset=0)
        return [
            {
                "id": item["id"],
                "capturedAt": item["capturedAt"],
                "method": item["method"],
                "url": item["url"],
                "status": item["status"],
                "requestHeaders": item["requestHeaders"],
                "requestBody": item["requestBodyPreview"],
                "responseHeaders": item["responseHeaders"],
                "responseBody": item["responseBodyPreview"],
                "durationMs": item["durationMs"],
                "sizeBytes": item["sizeBytes"],
            }
            for item in flows
        ]


def _merge_headers(base: dict[str, str], override: dict[str, str] | None) -> dict[str, str]:
    merged = {str(key): str(value) for key, value in base.items()}
    for key, value in (override or {}).items():
        # The UI only ever sees redacted sensitive headers. A redacted value means
        # "unchanged", never "replace the secret with the literal marker".
        if str(key).lower() in SENSITIVE_HEADERS and str(value) in {
            REDACTED,
            "\ufffdredacted\ufffd",
            "«redacted»",
        }:
            continue
        for existing in [item for item in merged if item.lower() == key.lower()]:
            merged.pop(existing, None)
        merged[str(key)] = str(value)
    for key in ("host", "content-length", "transfer-encoding", "connection"):
        for existing in [item for item in merged if item.lower() == key]:
            merged.pop(existing, None)
    return merged


def build_replay_url(baseline: Flow, patch: dict[str, Any]) -> str:
    raw = str(patch.get("url") or baseline.url)
    parts = urlsplit(raw)
    path = str(patch.get("path") or parts.path or "/")
    if path.startswith("http://") or path.startswith("https://"):
        parts = urlsplit(path)
        path = parts.path or "/"
    if "query" in patch and patch.get("query") is not None:
        query = urlencode([(str(k), str(v)) for k, v in dict(patch["query"]).items()])
    else:
        query = parts.query
    return urlunsplit((parts.scheme, parts.netloc, path or "/", query, parts.fragment))


def _apply_cookies(headers: dict[str, str], cookies: dict[str, str] | None) -> dict[str, str]:
    if not cookies:
        return headers
    merged: dict[str, str] = {}
    existing: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() == "cookie":
            existing.update(dict(parse_qsl(value, keep_blank_values=True, separator=";")))
        else:
            merged[key] = value
    existing.update(
        {
            str(k): str(v)
            for k, v in cookies.items()
            if str(v) not in {REDACTED, "\ufffdredacted\ufffd", "«redacted»"}
        }
    )
    merged["Cookie"] = "; ".join(f"{key}={value}" for key, value in existing.items())
    return merged


def _replay_body(
    baseline: Flow, patch: dict[str, Any], headers: dict[str, str]
) -> bytes:
    if patch.get("json") is not None:
        headers.setdefault("Content-Type", "application/json")
        return json.dumps(patch["json"], ensure_ascii=False).encode("utf-8")
    if patch.get("form") is not None:
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        return urlencode([(str(k), str(v)) for k, v in dict(patch["form"]).items()]).encode(
            "utf-8"
        )
    return baseline.request_body.encode("utf-8")


def replay(
    store: WorkbenchStore,
    request_id: str,
    *,
    patch: dict[str, Any] | None = None,
    policy: ScopePolicy,
    justification: str = "",
    transport: httpx.BaseTransport | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Replay exactly one request. Scope is checked before transport."""

    patch = dict(patch or {})
    baseline = store.get_flow(request_id)
    scratch = baseline is None
    if baseline is None:
        scratch_url = str(patch.get("url") or "")
        if not scratch_url:
            raise FlowNotFound(request_id)
        baseline = Flow(
            id=request_id or _new_id("raw"),
            project_id=store.project_id,
            method=str(patch.get("method") or "GET").upper(),
            url=scratch_url,
            host="",
            path="",
            request_headers={},
            request_body="",
            source="replay",
        )
    method = str(patch.get("method") or baseline.method).upper()
    url = build_replay_url(baseline, patch)
    decision = policy.check(url)

    headers = _merge_headers(baseline.request_headers, patch.get("header"))
    if patch.get("cookie"):
        headers = _apply_cookies(headers, dict(patch["cookie"]))
    body = _replay_body(baseline, patch, headers)

    transient = Flow(
        id=_new_id("req"),
        project_id=store.project_id,
        session_id=baseline.session_id,
        method=method,
        url=url,
        host="",
        path="",
        request_headers=headers,
        request_body=body.decode("utf-8", errors="replace"),
        auth_context=baseline.auth_context,
        tags=list(baseline.tags),
        in_scope=decision.allowed,
        parent_id=None if scratch else baseline.id,
        source="replay",
    )

    if not decision.allowed:
        return {
            "request": transient.public(),
            "response": {
                "status": 0,
                "headers": {},
                "body": "",
                "rawResponse": "",
                "durationMs": 0,
                "sizeBytes": 0,
            },
            "scope": {"allowed": False, "reason": decision.reason},
            "evidenceId": None,
        }

    if method in DESTRUCTIVE_METHODS and not justification.strip():
        raise ApprovalRequired(method)

    started = time.perf_counter()
    try:
        with httpx.Client(
            follow_redirects=False,
            timeout=timeout,
            trust_env=False,
            transport=transport,
        ) as client:
            response = client.request(method, url, headers=headers, content=body)
    except httpx.HTTPError as exc:
        raise TransportFailed(f"replay transport failed: {exc}") from exc
    duration_ms = int((time.perf_counter() - started) * 1000)

    content = response.content
    size_bytes = len(content)
    stored = content[:MAX_STORED_BODY]
    text = stored.decode(response.encoding or "utf-8", errors="replace")
    response_headers = {str(key): str(value) for key, value in response.headers.items()}

    flow = Flow(
        id=_new_id("req"),
        project_id=store.project_id,
        session_id=baseline.session_id,
        method=method,
        url=url,
        host="",
        path="",
        status=response.status_code,
        request_headers=headers,
        request_body=body.decode("utf-8", errors="replace"),
        response_headers=response_headers,
        response_body=text,
        size_bytes=size_bytes,
        duration_ms=duration_ms,
        auth_context=baseline.auth_context,
        tags=list(baseline.tags),
        in_scope=True,
        parent_id=None if scratch else baseline.id,
        source="replay",
    )
    store.add_flow(flow)
    raw_response = _raw_http(f"HTTP/1.1 {response.status_code}", response_headers, text)
    return {
        "request": flow.public(),
        "response": {
            "status": response.status_code,
            "headers": redact_headers(response_headers),
            "body": text,
            "rawResponse": raw_response,
            "durationMs": duration_ms,
            "sizeBytes": size_bytes,
        },
        "scope": {"allowed": True, "reason": decision.reason},
        "evidenceId": None,
    }


def _diff_lines(baseline: str, candidate: str) -> list[dict[str, Any]]:
    left = baseline.splitlines()
    right = candidate.splitlines()
    matcher = difflib.SequenceMatcher(a=left, b=right, autojunk=False)
    result: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                result.append(
                    {
                        "type": "unchanged",
                        "content": left[i1 + offset],
                        "lineNum": j1 + offset + 1,
                    }
                )
        elif tag == "delete":
            for index in range(i1, i2):
                result.append({"type": "removed", "content": left[index], "lineNum": index + 1})
        elif tag == "insert":
            for index in range(j1, j2):
                result.append({"type": "added", "content": right[index], "lineNum": index + 1})
        else:  # replace
            for index in range(i1, i2):
                result.append({"type": "removed", "content": left[index], "lineNum": index + 1})
            for index in range(j1, j2):
                result.append({"type": "added", "content": right[index], "lineNum": index + 1})
    return result


def _header_lines(headers: dict[str, str]) -> str:
    return "\n".join(f"{key}: {value}" for key, value in redact_headers(headers).items())


def compare(store: WorkbenchStore, baseline_id: str, candidate_id: str) -> dict[str, Any]:
    baseline = store.require_flow(baseline_id)
    candidate = store.require_flow(candidate_id)
    headers_diff = _diff_lines(
        _header_lines(baseline.response_headers),
        _header_lines(candidate.response_headers),
    )
    body_diff = _diff_lines(
        _clip(baseline.response_body)[0],
        _clip(candidate.response_body)[0],
    )
    added = sum(1 for line in body_diff if line["type"] == "added")
    removed = sum(1 for line in body_diff if line["type"] == "removed")
    status_changed = baseline.status != candidate.status
    summary = (
        f"{baseline.status} -> {candidate.status}; "
        f"{added} added, {removed} removed body lines"
    )
    return {
        "statusChanged": status_changed,
        "baselineStatus": baseline.status,
        "candidateStatus": candidate.status,
        "headersDiff": headers_diff,
        "bodyDiff": body_diff,
        "summary": summary,
    }


# ── import ────────────────────────────────────────────────────────────


def _flow_from_har(entry: dict[str, Any], project_id: str, policy: ScopePolicy) -> Flow:
    request = entry.get("request") or {}
    response = entry.get("response") or {}
    url = str(request.get("url", ""))
    headers = {
        str(item.get("name", "")): str(item.get("value", ""))
        for item in request.get("headers", [])
        if item.get("name")
    }
    response_headers = {
        str(item.get("name", "")): str(item.get("value", ""))
        for item in response.get("headers", [])
        if item.get("name")
    }
    post_data = request.get("postData") or {}
    request_body = str(post_data.get("text", ""))
    content = response.get("content") or {}
    response_body = str(content.get("text", ""))
    if content.get("encoding") == "base64" and response_body:
        try:
            response_body = base64.b64decode(response_body).decode("utf-8", errors="replace")
        except (ValueError, UnicodeDecodeError):
            pass
    timings = entry.get("timings") or {}
    duration = entry.get("time")
    if duration is None:
        duration = sum(float(timings.get(key, 0) or 0) for key in ("send", "wait", "receive"))
    size = content.get("size")
    if size is None:
        size = len(response_body.encode("utf-8"))
    return Flow(
        id=_new_id("req"),
        project_id=project_id,
        method=str(request.get("method", "GET")).upper(),
        url=url,
        host="",
        path="",
        status=int(response.get("status", 0) or 0),
        request_headers=headers,
        request_body=request_body,
        response_headers=response_headers,
        response_body=response_body,
        size_bytes=int(size or 0),
        duration_ms=int(duration or 0),
        auth_context="",
        tags=["imported", "har"],
        captured_at=str(entry.get("startedDateTime") or _now()),
        in_scope=policy.check(url).allowed,
        source="import",
    )


def import_har(store: WorkbenchStore, path: Path, policy: ScopePolicy) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkbenchError(f"cannot read HAR file: {exc}") from exc
    entries = ((data.get("log") or {}).get("entries") or []) if isinstance(data, dict) else []
    imported = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        flow = _flow_from_har(entry, store.project_id, policy)
        if not flow.url:
            continue
        store.add_flow(flow)
        imported.append(flow.id)
    return {
        "importId": _new_id("imp"),
        "format": "har",
        "imported": len(imported),
        "skipped": max(0, len(entries) - len(imported)),
        "requestIds": imported,
    }


def _decode_burp(element: ElementTree.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    text = element.text
    if str(element.get("base64", "false")).lower() == "true":
        try:
            return base64.b64decode(text).decode("utf-8", errors="replace")
        except (ValueError, UnicodeDecodeError):
            return ""
    return text


def import_burp_xml(store: WorkbenchStore, path: Path, policy: ScopePolicy) -> dict[str, Any]:
    try:
        root = ElementTree.parse(path).getroot()
    except (OSError, ElementTree.ParseError) as exc:
        raise WorkbenchError(f"cannot read Burp XML file: {exc}") from exc
    items = root.findall(".//item")
    imported: list[str] = []
    for item in items:
        url = (item.findtext("url") or "").strip()
        raw_request = _decode_burp(item.find("request"))
        raw_response = _decode_burp(item.find("response"))
        request_line, _, request_headers, request_body = _parse_raw_http(raw_request)
        response_line, _, response_headers, response_body = _parse_raw_http(raw_response)
        request_parts = request_line.split(" ")
        method = request_parts[0].upper() if request_parts else "GET"
        status_text = (item.findtext("status") or "").strip()
        status = int(status_text) if status_text.isdigit() else 0
        if not status:
            response_parts = response_line.split(" ")
            if len(response_parts) >= 2 and response_parts[1].isdigit():
                status = int(response_parts[1])
        if not url:
            host = next(
                (value for key, value in request_headers.items() if key.lower() == "host"),
                "",
            )
            request_path = request_parts[1] if len(request_parts) > 1 else "/"
            url = f"https://{host}{request_path}" if host else ""
        if not url:
            continue
        flow = Flow(
            id=_new_id("req"),
            project_id=store.project_id,
            method=method,
            url=url,
            host="",
            path="",
            status=status,
            request_headers=request_headers,
            request_body=request_body,
            response_headers=response_headers,
            response_body=response_body,
            size_bytes=len(response_body.encode("utf-8")),
            duration_ms=int((item.findtext("time") or "0").strip() or 0),
            auth_context="",
            tags=["imported", "burp"],
            captured_at=_now(),
            in_scope=policy.check(url).allowed,
            source="import",
        )
        store.add_flow(flow)
        imported.append(flow.id)
    return {
        "importId": _new_id("imp"),
        "format": "burp_xml",
        "imported": len(imported),
        "skipped": max(0, len(items) - len(imported)),
        "requestIds": imported,
    }


def import_file(
    store: WorkbenchStore,
    *,
    fmt: str,
    path: Path,
    policy: ScopePolicy,
) -> dict[str, Any]:
    if fmt == "har":
        return import_har(store, path, policy)
    if fmt == "burp_xml":
        return import_burp_xml(store, path, policy)
    raise WorkbenchError(f"unsupported import format: {fmt}")


def ca_status(home_root: Path) -> dict[str, Any]:
    from .ca import ca_status as _ca_status

    return _ca_status(home_root)
