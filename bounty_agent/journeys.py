from __future__ import annotations

"""Browser journeys and durable request templates.

The model should be able to resume a chain such as: login → dashboard →
settings → save profile → API request.  It must retrieve this chain from
storage, not rely on context-window memory.

Entities:
    BrowserPage, Journey, JourneyStep, CapturedRequest, CapturedResponse,
    RequestTemplate, JourneyRequestLink, RequestMutation
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BrowserPage:
    id: str
    url: str
    title: str = ""
    status: int | None = None
    input_count: int = 0
    artifact_id: str = ""
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class Journey:
    id: str
    name: str
    description: str = ""
    source: str = "browser"
    created_at: str = ""
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class JourneyStep:
    id: str
    journey_id: str
    order: int
    action: str
    page_before: str = ""
    page_after: str = ""
    element_description: str = ""
    screenshot_artifact_id: str = ""
    request_template_ids: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class CapturedRequest:
    id: str
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    body: str = ""
    session_id: str = ""
    source: str = "browser"
    created_at: str = ""
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class CapturedResponse:
    id: str
    request_id: str
    status: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    body_excerpt: str = ""
    artifact_id: str = ""
    created_at: str = ""
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class RequestTemplate:
    id: str
    method: str
    route: str
    content_type: str = ""
    dynamic_fields: tuple[str, ...] = ()
    baseline_response_id: str = ""
    session_id: str = ""
    replay_policy: str = "safe"
    source: str = "browser"
    created_at: str = ""
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class JourneyRequestLink:
    journey_id: str
    step_id: str
    request_id: str
    template_id: str = ""
    relation: str = "caused"


@dataclass(frozen=True)
class RequestMutation:
    id: str
    template_id: str
    mutation_kind: str
    mutation_value: str
    baseline_response_id: str = ""
    candidate_response_id: str = ""
    created_at: str = ""
    meta: dict[str, Any] | None = None


class JourneyStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS browser_pages(
                id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL,
                status INTEGER, input_count INTEGER NOT NULL DEFAULT 0,
                artifact_id TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS journeys(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
                source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS journey_steps(
                id TEXT PRIMARY KEY, journey_id TEXT NOT NULL, step_order INTEGER NOT NULL,
                action TEXT NOT NULL, page_before TEXT NOT NULL, page_after TEXT NOT NULL,
                element_description TEXT NOT NULL, screenshot_artifact_id TEXT NOT NULL DEFAULT '',
                request_template_ids TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS captured_requests(
                id TEXT PRIMARY KEY, method TEXT NOT NULL, url TEXT NOT NULL,
                headers TEXT NOT NULL, body TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS captured_responses(
                id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status INTEGER,
                headers TEXT NOT NULL, body_excerpt TEXT NOT NULL, artifact_id TEXT NOT NULL DEFAULT '',
                meta TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS request_templates(
                id TEXT PRIMARY KEY, method TEXT NOT NULL, route TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT '', dynamic_fields TEXT NOT NULL,
                baseline_response_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '',
                replay_policy TEXT NOT NULL DEFAULT 'safe', source TEXT NOT NULL,
                meta TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS journey_request_links(
                journey_id TEXT NOT NULL, step_id TEXT NOT NULL, request_id TEXT NOT NULL,
                template_id TEXT NOT NULL DEFAULT '', relation TEXT NOT NULL DEFAULT 'caused',
                PRIMARY KEY (journey_id, step_id, request_id)
            );
            CREATE TABLE IF NOT EXISTS request_mutations(
                id TEXT PRIMARY KEY, template_id TEXT NOT NULL, mutation_kind TEXT NOT NULL,
                mutation_value TEXT NOT NULL, baseline_response_id TEXT NOT NULL DEFAULT '',
                candidate_response_id TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_steps_journey ON journey_steps(journey_id);
            CREATE INDEX IF NOT EXISTS idx_requests_url ON captured_requests(url);
            CREATE INDEX IF NOT EXISTS idx_templates_route ON request_templates(route);
            CREATE INDEX IF NOT EXISTS idx_links_request ON journey_request_links(request_id);
            """
        )
        self.conn.commit()

    # ── Pages ──────────────────────────────────────────────────────────

    def upsert_page(self, page: BrowserPage) -> str:
        self.conn.execute(
            """INSERT INTO browser_pages(id,url,title,status,input_count,artifact_id,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,
                 input_count=excluded.input_count,artifact_id=excluded.artifact_id,meta=excluded.meta""",
            (page.id, page.url, page.title, page.status, page.input_count, page.artifact_id,
             _json(page.meta or {}), _now()),
        )
        self.conn.commit()
        return page.id

    def list_pages(self, limit: int = 50) -> list[BrowserPage]:
        rows = self.conn.execute(
            "SELECT id,url,title,status,input_count,artifact_id,meta FROM browser_pages ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_page(row) for row in rows]

    # ── Journeys ───────────────────────────────────────────────────────

    def create_journey(self, name: str, *, description: str = "", source: str = "browser",
                       meta: dict[str, Any] | None = None) -> str:
        journey_id = _stable_id("JNY", name, _now())
        self.conn.execute(
            "INSERT INTO journeys(id,name,description,source,meta,created_at) VALUES (?,?,?,?,?,?)",
            (journey_id, name, description, source, _json(meta or {}), _now()),
        )
        self.conn.commit()
        return journey_id

    def list_journeys(self, limit: int = 50) -> list[Journey]:
        rows = self.conn.execute(
            "SELECT id,name,description,source,meta,created_at FROM journeys ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            Journey(id=r[0], name=r[1], description=r[2], source=r[3], meta=_loads(r[4]), created_at=r[5])
            for r in rows
        ]

    def get_journey(self, journey_id: str) -> Journey | None:
        row = self.conn.execute(
            "SELECT id,name,description,source,meta,created_at FROM journeys WHERE id=?",
            (journey_id,),
        ).fetchone()
        if not row:
            return None
        return Journey(id=row[0], name=row[1], description=row[2], source=row[3], meta=_loads(row[4]), created_at=row[5])

    def add_step(self, journey_id: str, *, action: str, page_before: str = "", page_after: str = "",
                 element_description: str = "", screenshot_artifact_id: str = "",
                 request_template_ids: tuple[str, ...] = (), meta: dict[str, Any] | None = None) -> str:
        order = self.conn.execute(
            "SELECT COALESCE(MAX(step_order), 0) + 1 FROM journey_steps WHERE journey_id=?",
            (journey_id,),
        ).fetchone()[0]
        step_id = _stable_id("JST", journey_id, str(order), action)
        self.conn.execute(
            """INSERT INTO journey_steps(id,journey_id,step_order,action,page_before,page_after,
               element_description,screenshot_artifact_id,request_template_ids,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (step_id, journey_id, order, action, page_before, page_after, element_description,
             screenshot_artifact_id, _json(request_template_ids), _json(meta or {}), _now()),
        )
        self.conn.commit()
        return step_id

    def steps_for_journey(self, journey_id: str) -> list[JourneyStep]:
        rows = self.conn.execute(
            """SELECT id,journey_id,step_order,action,page_before,page_after,element_description,
               screenshot_artifact_id,request_template_ids,meta FROM journey_steps
               WHERE journey_id=? ORDER BY step_order""",
            (journey_id,),
        ).fetchall()
        return [
            JourneyStep(
                id=r[0], journey_id=r[1], order=r[2], action=r[3], page_before=r[4], page_after=r[5],
                element_description=r[6], screenshot_artifact_id=r[7],
                request_template_ids=tuple(json.loads(r[8] or "[]")), meta=_loads(r[9]),
            )
            for r in rows
        ]

    # ── Captured requests/responses ────────────────────────────────────

    def add_captured_request(self, *, method: str, url: str, headers: dict[str, str] | None = None,
                             body: str = "", session_id: str = "", source: str = "browser",
                             meta: dict[str, Any] | None = None) -> str:
        request_id = _stable_id("REQ", method, url, body[:200])
        self.conn.execute(
            """INSERT INTO captured_requests(id,method,url,headers,body,session_id,source,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET headers=excluded.headers,body=excluded.body,
                 session_id=excluded.session_id,meta=excluded.meta""",
            (request_id, method, url, _json(headers or {}), body, session_id, source, _json(meta or {}), _now()),
        )
        self.conn.commit()
        return request_id

    def add_captured_response(self, *, request_id: str, status: int | None = None,
                              headers: dict[str, str] | None = None, body_excerpt: str = "",
                              artifact_id: str = "", meta: dict[str, Any] | None = None) -> str:
        response_id = _stable_id("RES", request_id, str(status), body_excerpt[:100])
        self.conn.execute(
            """INSERT INTO captured_responses(id,request_id,status,headers,body_excerpt,artifact_id,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET status=excluded.status,headers=excluded.headers,
                 body_excerpt=excluded.body_excerpt,artifact_id=excluded.artifact_id,meta=excluded.meta""",
            (response_id, request_id, status, _json(headers or {}), body_excerpt[:4000], artifact_id,
             _json(meta or {}), _now()),
        )
        self.conn.commit()
        return response_id

    def get_captured_request(self, request_id: str) -> CapturedRequest | None:
        row = self.conn.execute(
            "SELECT id,method,url,headers,body,session_id,source,meta,created_at FROM captured_requests WHERE id=?",
            (request_id,),
        ).fetchone()
        if not row:
            return None
        return CapturedRequest(
            id=row[0], method=row[1], url=row[2], headers=_loads(row[3]), body=row[4],
            session_id=row[5], source=row[6], meta=_loads(row[7]), created_at=row[8],
        )

    def get_captured_response(self, request_id: str) -> CapturedResponse | None:
        row = self.conn.execute(
            "SELECT id,request_id,status,headers,body_excerpt,artifact_id,meta,created_at FROM captured_responses WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
            (request_id,),
        ).fetchone()
        if not row:
            return None
        return CapturedResponse(
            id=row[0], request_id=row[1], status=row[2], headers=_loads(row[3]),
            body_excerpt=row[4], artifact_id=row[5], meta=_loads(row[6]), created_at=row[7],
        )

    def search_captured_requests(self, query: str = "", *, limit: int = 50) -> list[CapturedRequest]:
        sql = "SELECT id,method,url,headers,body,session_id,source,meta,created_at FROM captured_requests"
        params: list[Any] = []
        if query:
            sql += " WHERE url LIKE ? OR body LIKE ?"
            params.extend([f"%{query}%", f"%{query}%"])
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(sql, params).fetchall()
        return [
            CapturedRequest(
                id=r[0], method=r[1], url=r[2], headers=_loads(r[3]), body=r[4],
                session_id=r[5], source=r[6], meta=_loads(r[7]), created_at=r[8],
            )
            for r in rows
        ]

    def find_write_requests(self, *, limit: int = 50) -> list[CapturedRequest]:
        rows = self.conn.execute(
            """SELECT id,method,url,headers,body,session_id,source,meta,created_at FROM captured_requests
               WHERE method IN ('POST','PUT','PATCH','DELETE') ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [
            CapturedRequest(
                id=r[0], method=r[1], url=r[2], headers=_loads(r[3]), body=r[4],
                session_id=r[5], source=r[6], meta=_loads(r[7]), created_at=r[8],
            )
            for r in rows
        ]

    def find_requests_by_route(self, route: str, *, limit: int = 50) -> list[CapturedRequest]:
        rows = self.conn.execute(
            "SELECT id,method,url,headers,body,session_id,source,meta,created_at FROM captured_requests WHERE url LIKE ? ORDER BY created_at DESC LIMIT ?",
            (f"%{route}%", limit),
        ).fetchall()
        return [
            CapturedRequest(
                id=r[0], method=r[1], url=r[2], headers=_loads(r[3]), body=r[4],
                session_id=r[5], source=r[6], meta=_loads(r[7]), created_at=r[8],
            )
            for r in rows
        ]

    # ── Request templates ──────────────────────────────────────────────

    def create_request_template(self, *, method: str, route: str, content_type: str = "",
                                dynamic_fields: tuple[str, ...] = (), baseline_response_id: str = "",
                                session_id: str = "", replay_policy: str = "safe",
                                source: str = "browser", meta: dict[str, Any] | None = None) -> str:
        template_id = _stable_id("TPL", method, route)
        self.conn.execute(
            """INSERT INTO request_templates(id,method,route,content_type,dynamic_fields,baseline_response_id,
               session_id,replay_policy,source,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET content_type=excluded.content_type,
                 dynamic_fields=excluded.dynamic_fields,baseline_response_id=excluded.baseline_response_id,
                 session_id=excluded.session_id,replay_policy=excluded.replay_policy,meta=excluded.meta""",
            (template_id, method, route, content_type, _json(dynamic_fields), baseline_response_id,
             session_id, replay_policy, source, _json(meta or {}), _now()),
        )
        self.conn.commit()
        return template_id

    def get_request_template(self, template_id: str) -> RequestTemplate | None:
        row = self.conn.execute(
            "SELECT id,method,route,content_type,dynamic_fields,baseline_response_id,session_id,replay_policy,source,meta,created_at FROM request_templates WHERE id=?",
            (template_id,),
        ).fetchone()
        if not row:
            return None
        return RequestTemplate(
            id=row[0], method=row[1], route=row[2], content_type=row[3],
            dynamic_fields=tuple(json.loads(row[4] or "[]")), baseline_response_id=row[5],
            session_id=row[6], replay_policy=row[7], source=row[8], meta=_loads(row[9]), created_at=row[10],
        )

    def list_request_templates(self, *, limit: int = 50) -> list[RequestTemplate]:
        rows = self.conn.execute(
            "SELECT id,method,route,content_type,dynamic_fields,baseline_response_id,session_id,replay_policy,source,meta,created_at FROM request_templates ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            RequestTemplate(
                id=r[0], method=r[1], route=r[2], content_type=r[3],
                dynamic_fields=tuple(json.loads(r[4] or "[]")), baseline_response_id=r[5],
                session_id=r[6], replay_policy=r[7], source=r[8], meta=_loads(r[9]), created_at=r[10],
            )
            for r in rows
        ]

    # ── Links and mutations ────────────────────────────────────────────

    def link_request_to_step(self, journey_id: str, step_id: str, request_id: str,
                             template_id: str = "", relation: str = "caused") -> None:
        self.conn.execute(
            """INSERT INTO journey_request_links(journey_id,step_id,request_id,template_id,relation)
               VALUES (?,?,?,?,?) ON CONFLICT(journey_id,step_id,request_id) DO UPDATE SET
               template_id=excluded.template_id,relation=excluded.relation""",
            (journey_id, step_id, request_id, template_id, relation),
        )
        self.conn.commit()

    def requests_for_journey_step(self, journey_id: str, step_id: str) -> list[CapturedRequest]:
        rows = self.conn.execute(
            """SELECT r.id,r.method,r.url,r.headers,r.body,r.session_id,r.source,r.meta,r.created_at
               FROM journey_request_links l JOIN captured_requests r ON l.request_id = r.id
               WHERE l.journey_id=? AND l.step_id=?""",
            (journey_id, step_id),
        ).fetchall()
        return [
            CapturedRequest(
                id=r[0], method=r[1], url=r[2], headers=_loads(r[3]), body=r[4],
                session_id=r[5], source=r[6], meta=_loads(r[7]), created_at=r[8],
            )
            for r in rows
        ]

    def add_mutation(self, *, template_id: str, mutation_kind: str, mutation_value: str,
                     baseline_response_id: str = "", candidate_response_id: str = "",
                     meta: dict[str, Any] | None = None) -> str:
        mutation_id = _stable_id("MUT", template_id, mutation_kind, mutation_value)
        self.conn.execute(
            """INSERT INTO request_mutations(id,template_id,mutation_kind,mutation_value,
               baseline_response_id,candidate_response_id,meta,created_at)
               VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
               baseline_response_id=excluded.baseline_response_id,
               candidate_response_id=excluded.candidate_response_id,meta=excluded.meta""",
            (mutation_id, template_id, mutation_kind, mutation_value, baseline_response_id,
             candidate_response_id, _json(meta or {}), _now()),
        )
        self.conn.commit()
        return mutation_id

    def close(self) -> None:
        self.conn.close()


def _row_to_page(row: tuple[Any, ...]) -> BrowserPage:
    return BrowserPage(
        id=row[0], url=row[1], title=row[2], status=row[3], input_count=row[4],
        artifact_id=row[5], meta=_loads(row[6]),
    )


def _stable_id(prefix: str, *parts: str) -> str:
    payload = "\n".join(parts).encode("utf-8", errors="replace")
    return f"{prefix}-{hashlib.sha1(payload).hexdigest()[:12]}"


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