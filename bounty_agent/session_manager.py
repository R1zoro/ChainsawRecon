from __future__ import annotations

"""First-class session and auth-lane management.

A session is a structured entity with state, provenance, validity checks,
role/tenant context, and links to the requests and journeys it enables.
This module replaces the flat auth-context import model with a first-class
session lifecycle: recorded-login, operator-handover, credentials, and none.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


AUTH_MODES = {"none", "recorded-login", "operator-handover", "credentials"}
SESSION_STATUSES = {"pending", "active", "waiting", "stale", "failed", "expired", "deferred"}


@dataclass(frozen=True)
class SessionContext:
    id: str
    alias: str
    engagement_id: str
    source: str
    auth_mechanism: str
    status: str
    domains: tuple[str, ...] = ()
    role: str | None = None
    tenant: str | None = None
    created_at: str = ""
    last_verified_at: str = ""
    validation_request_id: str | None = None
    burp_project_ref: str = ""
    burp_rule_name: str = ""
    secret_policy: str = "never-inline"
    failure_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "alias": self.alias,
            "engagement_id": self.engagement_id,
            "source": self.source,
            "auth_mechanism": self.auth_mechanism,
            "status": self.status,
            "domains": list(self.domains),
            "role": self.role,
            "tenant": self.tenant,
            "created_at": self.created_at,
            "last_verified_at": self.last_verified_at,
            "validation_request_id": self.validation_request_id,
            "burp_project_ref": self.burp_project_ref,
            "burp_rule_name": self.burp_rule_name,
            "secret_policy": self.secret_policy,
            "failure_reason": self.failure_reason,
        }


class SessionManager:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions(
                id TEXT PRIMARY KEY,
                alias TEXT NOT NULL,
                engagement_id TEXT NOT NULL,
                source TEXT NOT NULL,
                auth_mechanism TEXT NOT NULL,
                status TEXT NOT NULL,
                domains TEXT NOT NULL,
                role TEXT,
                tenant TEXT,
                created_at TEXT NOT NULL,
                last_verified_at TEXT,
                validation_request_id TEXT,
                burp_project_ref TEXT,
                burp_rule_name TEXT,
                secret_policy TEXT NOT NULL,
                failure_reason TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS session_validations(
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                outcome TEXT NOT NULL,
                created_at TEXT NOT NULL,
                meta TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_sessions_engagement ON sessions(engagement_id);
            """
        )
        self.conn.commit()

    def create_session(
        self,
        *,
        alias: str,
        engagement_id: str,
        source: str,
        auth_mechanism: str,
        domains: tuple[str, ...] = (),
        role: str | None = None,
        tenant: str | None = None,
        burp_project_ref: str | None = None,
        burp_rule_name: str | None = None,
        secret_policy: str = "keep-inline",
        status: str = "pending",
    ) -> SessionContext:
        payload = "\n".join([alias, engagement_id, source, auth_mechanism]).encode("utf-8", errors="replace")
        session_id = f"SES-{hashlib.sha1(payload).hexdigest()[:12]}"
        now = _now()
        self.conn.execute(
            """INSERT INTO sessions(id,alias,engagement_id,source,auth_mechanism,status,domains,role,tenant,
               created_at,last_verified_at,validation_request_id,burp_project_ref,burp_rule_name,secret_policy,failure_reason)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET status=excluded.status,
                 last_verified_at=excluded.last_verified_at, failure_reason=excluded.failure_reason""",
            (session_id, alias, engagement_id, source, auth_mechanism, status,
             _json(domains), role, tenant, now, now, None, burp_project_ref, burp_rule_name, secret_policy, ""),
        )
        self.conn.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> SessionContext | None:
        row = self.conn.execute(
            "SELECT id,alias,engagement_id,source,auth_mechanism,status,domains,role,tenant,created_at,last_verified_at,validation_request_id,burp_project_ref,burp_rule_name,secret_policy,failure_reason FROM sessions WHERE id=?",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        return _row_to_session(row)

    def list_sessions(self, status: str | None = None, engagement_id: str | None = None) -> list[SessionContext]:
        query = "SELECT id,alias,engagement_id,source,auth_mechanism,status,domains,role,tenant,created_at,last_verified_at,validation_request_id,burp_project_ref,burp_rule_name,secret_policy,failure_reason FROM sessions"
        clauses: list[str] = []
        params: list[Any] = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if engagement_id:
            clauses.append("engagement_id = ?")
            params.append(engagement_id)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY created_at DESC"
        return [_row_to_session(row) for row in self.conn.execute(query, params).fetchall()]

    def update_status(self, session_id: str, status: str, *, failure_reason: str = "") -> None:
        self.conn.execute(
            "UPDATE sessions SET status=?, failure_reason=?, last_verified_at=? WHERE id=?",
            (status, failure_reason, _now(), session_id),
        )
        self.conn.commit()

    def mark_verified(self, session_id: str, validation_request_id: str) -> None:
        self.conn.execute(
            "UPDATE sessions SET status='active', last_verified_at=?, validation_request_id=? WHERE id=?",
            (_now(), validation_request_id, session_id),
        )
        self.conn.commit()

    def record_validation(self, session_id: str, request_id: str, outcome: str, *, meta: dict[str, Any] | None = None) -> str:
        key = f"SV-{hashlib.sha1(f'{session_id}:{request_id}:{_now()}'.encode()).hexdigest()[:12]}"
        self.conn.execute(
            "INSERT INTO session_validations(id,session_id,request_id,outcome,created_at,meta) VALUES (?,?,?,?,?,?)",
            (key, session_id, request_id, outcome, _now(), _json(meta or {})),
        )
        self.conn.commit()
        return key

    def close(self) -> None:
        self.conn.close()


def session_status_prompt(sessions: list[SessionContext]) -> str:
    """Build a compact session-status prompt section.

    Shows only the session lane, not secrets or raw cookies.
    """
    if not sessions:
        return "Session lane: none. Continue unauthenticated work."
    lines = ["Session lane status:"]
    for session in sessions[:5]:
        lines.append(
            f"- {session.alias}: {session.status} ({session.auth_mechanism})"
            + (f" role={session.role}" if session.role else "")
            + (f" tenant={session.tenant}" if session.tenant else "")
            + (f" failure={session.failure_reason}" if session.failure_reason else "")
        )
    return "\n".join(lines)


def _row_to_session(row: tuple[Any, ...]) -> SessionContext:
    return SessionContext(
        id=row[0],
        alias=row[1],
        engagement_id=row[2],
        source=row[3],
        auth_mechanism=row[4],
        status=row[5],
        domains=tuple(json.loads(row[6] or "[]")),
        role=row[7],
        tenant=row[8],
        created_at=row[9],
        last_verified_at=row[10],
        validation_request_id=row[11],
        burp_project_ref=row[12],
        burp_rule_name=row[13],
        secret_policy=row[14],
        failure_reason=row[15] or "",
    )


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()