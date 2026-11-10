"""Rebuildable SQLite projection of a session journal.

The journal is the source of truth. This projection exists so the API/UI can
query tasks, approvals, evidence, findings, and context without scanning JSONL
on every request. It can always be rebuilt from the journal.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .journal import JournalEvent, read_journal


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _loads(value: str) -> Any:
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def _data(event: JournalEvent) -> dict[str, Any]:
    return event.data if isinstance(event.data, dict) else {}


def _ref(event: JournalEvent, key: str) -> str:
    return str((event.refs or {}).get(key, ""))


@dataclass(frozen=True)
class ProjectionStats:
    applied: int
    last_seq: int
    rebuilt: bool = False


class SessionProjection:
    """One session's query projection.

    ``sync`` applies only new journal events. ``rebuild`` drops and replays the
    whole journal. Both are idempotent for the same event sequence.
    """

    def __init__(self, db_path: Path | str, session_id: str) -> None:
        self.db_path = Path(db_path)
        self.session_id = session_id
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._ensure()

    def _ensure(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(
                seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
                actor TEXT NOT NULL, turn INTEGER, step INTEGER, refs TEXT NOT NULL,
                data TEXT NOT NULL, visibility TEXT NOT NULL, hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
                title TEXT NOT NULL, status TEXT NOT NULL, risk TEXT NOT NULL,
                target TEXT NOT NULL, objective TEXT NOT NULL, done_when TEXT NOT NULL,
                allowed_tools TEXT NOT NULL, dependencies TEXT NOT NULL,
                evidence_required TEXT NOT NULL, basis_ids TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
                meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS approvals(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT,
                kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
                risk TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
                expires_at TEXT, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS observations(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT,
                statement TEXT NOT NULL, evidence_id TEXT, receipt_id TEXT,
                confidence TEXT NOT NULL, created_at TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evidence(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
                summary TEXT NOT NULL, artifact_id TEXT NOT NULL, hash TEXT NOT NULL,
                hypothesis_id TEXT, task_id TEXT, request_id TEXT, response_id TEXT,
                promoted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hypotheses(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL,
                security_question TEXT NOT NULL, surface TEXT NOT NULL, state TEXT NOT NULL,
                confidence TEXT NOT NULL, required_evidence TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS findings(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL,
                severity TEXT NOT NULL, state TEXT NOT NULL, asset TEXT NOT NULL,
                hypothesis_id TEXT, evidence_ids TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS context_packets(
                id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL,
                role TEXT NOT NULL, model_id TEXT NOT NULL, budget_tokens INTEGER NOT NULL,
                used_tokens INTEGER NOT NULL, fit INTEGER NOT NULL,
                compression_ratio REAL NOT NULL, warnings TEXT NOT NULL,
                sections TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session_state(
                session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                mode TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
                model TEXT NOT NULL, last_seq INTEGER NOT NULL, updated_at TEXT NOT NULL,
                meta TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, seq);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
            CREATE INDEX IF NOT EXISTS idx_findings_state ON findings(state);
            """
        )
        self.conn.commit()

    # ── sync / rebuild ────────────────────────────────────────────────

    def last_seq(self) -> int:
        row = self.conn.execute("SELECT value FROM meta WHERE key='last_seq'").fetchone()
        try:
            return int(row[0]) if row else 0
        except (TypeError, ValueError):
            return 0

    def sync(self, journal_path: Path | str) -> ProjectionStats:
        last = self.last_seq()
        applied = 0
        for event in read_journal(journal_path):
            if event.seq <= last:
                continue
            self.apply(event)
            last = event.seq
            applied += 1
        self.conn.execute(
            "INSERT INTO meta(key,value) VALUES('last_seq',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(last),),
        )
        self.conn.commit()
        return ProjectionStats(applied=applied, last_seq=last)

    def rebuild(self, journal_path: Path | str) -> ProjectionStats:
        for table in (
            "events",
            "tasks",
            "approvals",
            "observations",
            "evidence",
            "hypotheses",
            "findings",
            "context_packets",
            "session_state",
            "meta",
        ):
            self.conn.execute(f"DELETE FROM {table}")
        self.conn.commit()
        stats = self.sync(journal_path)
        return ProjectionStats(applied=stats.applied, last_seq=stats.last_seq, rebuilt=True)

    # ── event application ────────────────────────────────────────────

    def apply(self, event: JournalEvent) -> None:
        data = _data(event)
        self.conn.execute(
            "INSERT OR REPLACE INTO events(seq,ts,type,actor,turn,step,refs,data,visibility,hash) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                event.seq,
                event.ts,
                event.type,
                event.actor,
                event.turn,
                event.step,
                _json(event.refs),
                _json(data),
                event.visibility,
                event.hash,
            ),
        )
        handler = getattr(self, "_apply_" + event.type.replace("/", "_"), None)
        if handler is not None:
            handler(event, data)
        self._touch_state(event)

    def _touch_state(self, event: JournalEvent) -> None:
        data = _data(event)
        if event.type == "session/created":
            self.conn.execute(
                "INSERT INTO session_state(session_id,project_id,title,mode,status,provider,model,last_seq,updated_at,meta) "
                "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET "
                "title=excluded.title,mode=excluded.mode,provider=excluded.provider,model=excluded.model,"
                "last_seq=excluded.last_seq,updated_at=excluded.updated_at,meta=excluded.meta",
                (
                    self.session_id,
                    _ref(event, "project_id"),
                    str(data.get("title", "Session")),
                    str(data.get("mode", "auto")),
                    "idle",
                    str(data.get("provider", "")),
                    str(data.get("model", "")),
                    event.seq,
                    event.ts,
                    _json(data),
                ),
            )
            return
        self.conn.execute(
            "UPDATE session_state SET last_seq=?, updated_at=? WHERE session_id=?",
            (event.seq, event.ts, self.session_id),
        )
        if event.type == "session/ended":
            self.conn.execute(
                "UPDATE session_state SET status=?, updated_at=? WHERE session_id=?",
                (str(data.get("status", "completed")), event.ts, self.session_id),
            )

    def _apply_task_proposed(self, event: JournalEvent, data: dict[str, Any]) -> None:
        task_id = str(data.get("id") or _ref(event, "task_id"))
        if not task_id:
            return
        self.conn.execute(
            "INSERT INTO tasks(id,session_id,kind,title,status,risk,target,objective,done_when,"
            "allowed_tools,dependencies,evidence_required,basis_ids,created_at,updated_at,attempts,last_error,meta) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "status=excluded.status,updated_at=excluded.updated_at,meta=excluded.meta",
            (
                task_id,
                self.session_id,
                str(data.get("kind", "task")),
                str(data.get("title", task_id)),
                "proposed",
                str(data.get("risk", "read-only")),
                str(data.get("target", "")),
                str(data.get("objective", "")),
                str(data.get("doneWhen", data.get("done_when", ""))),
                _json(data.get("allowedTools", data.get("allowed_tools", []))),
                _json(data.get("dependencies", [])),
                _json(data.get("evidenceRequired", data.get("evidence_required", []))),
                _json(data.get("basisIds", data.get("basis_ids", []))),
                event.ts,
                event.ts,
                int(data.get("attempts", 0)),
                "",
                _json(data),
            ),
        )

    def _apply_task_leased(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._set_task_status(str(data.get("taskId") or _ref(event, "task_id")), "leased", event.ts, data)

    def _apply_task_started(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._set_task_status(str(data.get("taskId") or _ref(event, "task_id")), "started", event.ts, data)

    def _apply_task_completed(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._set_task_status(str(data.get("taskId") or _ref(event, "task_id")), "completed", event.ts, data)

    def _apply_task_transition(self, event: JournalEvent, data: dict[str, Any]) -> None:
        task_id = str(data.get("taskId") or _ref(event, "task_id"))
        status = str(data.get("to") or data.get("status") or "completed")
        self._set_task_status(task_id, status, event.ts, data)

    def _set_task_status(self, task_id: str, status: str, ts: str, data: dict[str, Any]) -> None:
        if not task_id:
            return
        self.conn.execute(
            "UPDATE tasks SET status=?, updated_at=?, meta=? WHERE id=?",
            (status, ts, _json(data), task_id),
        )

    def _apply_approval_requested(self, event: JournalEvent, data: dict[str, Any]) -> None:
        approval_id = str(_ref(event, "approval_id") or data.get("id"))
        if not approval_id:
            return
        self.conn.execute(
            "INSERT INTO approvals(id,session_id,task_id,kind,title,detail,risk,status,created_at,expires_at,meta) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "status=excluded.status,meta=excluded.meta",
            (
                approval_id,
                self.session_id,
                _ref(event, "task_id") or data.get("taskId"),
                str(data.get("kind", "intrusive")),
                str(data.get("title", "Approval required")),
                str(data.get("detail", "")),
                str(data.get("risk", "high")),
                "pending",
                event.ts,
                data.get("expiresAt"),
                _json(data),
            ),
        )

    def _apply_approval_granted(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._set_approval_status(str(_ref(event, "approval_id")), "granted", data)

    def _apply_approval_denied(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._set_approval_status(str(_ref(event, "approval_id")), "denied", data)

    def _set_approval_status(self, approval_id: str, status: str, data: dict[str, Any]) -> None:
        if not approval_id:
            return
        self.conn.execute(
            "UPDATE approvals SET status=?, meta=? WHERE id=?",
            (status, _json(data), approval_id),
        )

    def _apply_observation(self, event: JournalEvent, data: dict[str, Any]) -> None:
        observation_id = str(data.get("observationId") or data.get("id") or _ref(event, "observation_id"))
        if not observation_id:
            return
        self.conn.execute(
            "INSERT INTO observations(id,session_id,task_id,statement,evidence_id,receipt_id,confidence,created_at,meta) "
            "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "statement=excluded.statement,evidence_id=excluded.evidence_id,meta=excluded.meta",
            (
                observation_id,
                self.session_id,
                _ref(event, "task_id") or data.get("taskId"),
                str(data.get("statement", "")),
                _ref(event, "evidence_id") or data.get("evidenceId"),
                data.get("receiptId"),
                str(data.get("confidence", "observed")),
                event.ts,
                _json(data),
            ),
        )

    def _apply_evidence_recorded(self, event: JournalEvent, data: dict[str, Any]) -> None:
        evidence_id = str(_ref(event, "evidence_id") or data.get("evidenceId") or data.get("id"))
        if not evidence_id:
            return
        self.conn.execute(
            "INSERT INTO evidence(id,session_id,kind,summary,artifact_id,hash,hypothesis_id,task_id,"
            "request_id,response_id,promoted,created_at,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,meta=excluded.meta",
            (
                evidence_id,
                self.session_id,
                str(data.get("kind", "evidence")),
                str(data.get("summary", "")),
                str(data.get("artifactId", data.get("artifact_id", ""))),
                str(data.get("hash", "")),
                _ref(event, "hypothesis_id") or data.get("hypothesisId"),
                _ref(event, "task_id") or data.get("taskId"),
                data.get("requestId"),
                data.get("responseId"),
                1 if data.get("promoted") else 0,
                event.ts,
                _json(data),
            ),
        )

    def _apply_hypothesis_created(self, event: JournalEvent, data: dict[str, Any]) -> None:
        hypothesis_id = str(_ref(event, "hypothesis_id") or data.get("id"))
        if not hypothesis_id:
            return
        self.conn.execute(
            "INSERT INTO hypotheses(id,session_id,title,security_question,surface,state,confidence,"
            "required_evidence,created_at,updated_at,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,meta=excluded.meta",
            (
                hypothesis_id,
                self.session_id,
                str(data.get("title", "")),
                str(data.get("securityQuestion", data.get("security_question", ""))),
                str(data.get("surface", "")),
                str(data.get("state", "suspected")),
                str(data.get("confidence", "candidate")),
                _json(data.get("requiredEvidence", data.get("required_evidence", []))),
                event.ts,
                event.ts,
                _json(data),
            ),
        )

    def _apply_hypothesis_transition(self, event: JournalEvent, data: dict[str, Any]) -> None:
        hypothesis_id = str(_ref(event, "hypothesis_id") or data.get("hypothesisId"))
        if not hypothesis_id:
            return
        self.conn.execute(
            "UPDATE hypotheses SET state=?, updated_at=?, meta=? WHERE id=?",
            (str(data.get("to", data.get("state", "suspected"))), event.ts, _json(data), hypothesis_id),
        )

    def _apply_finding_candidate(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._upsert_finding(event, data, "candidate")

    def _apply_finding_validated(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._upsert_finding(event, data, "validated")

    def _apply_finding_rejected(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self._upsert_finding(event, data, "rejected")

    def _upsert_finding(self, event: JournalEvent, data: dict[str, Any], default_state: str) -> None:
        finding_id = str(_ref(event, "finding_id") or data.get("id") or data.get("findingId"))
        if not finding_id:
            return
        self.conn.execute(
            "INSERT INTO findings(id,session_id,title,severity,state,asset,hypothesis_id,evidence_ids,"
            "created_at,updated_at,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,meta=excluded.meta",
            (
                finding_id,
                self.session_id,
                str(data.get("title", "Untitled finding")),
                str(data.get("severity", "unknown")),
                str(data.get("state", default_state)),
                str(data.get("asset", "")),
                _ref(event, "hypothesis_id") or data.get("hypothesisId"),
                _json(data.get("evidenceIds", [])),
                event.ts,
                event.ts,
                _json(data),
            ),
        )

    def _apply_context_assembled(self, event: JournalEvent, data: dict[str, Any]) -> None:
        self.conn.execute(
            "INSERT INTO context_packets(seq,role,model_id,budget_tokens,used_tokens,fit,"
            "compression_ratio,warnings,sections,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                event.seq,
                str(data.get("role", "")),
                str(data.get("model", data.get("modelId", ""))),
                int(data.get("budgetTokens", 0)),
                int(data.get("finalTokens", data.get("usedTokens", 0))),
                1 if data.get("fit", True) else 0,
                float(data.get("compressionRatio", 1.0)),
                _json(data.get("warnings", [])),
                _json(data.get("decisions", data.get("sections", []))),
                event.ts,
            ),
        )

    # ── queries ──────────────────────────────────────────────────────

    def events(self, *, after_seq: int = 0, limit: int = 100, types: Iterable[str] | None = None) -> list[dict[str, Any]]:
        query = "SELECT seq,ts,type,actor,turn,step,refs,data,visibility,hash FROM events WHERE seq>?"
        params: list[Any] = [after_seq]
        types = list(types or [])
        if types:
            query += " AND type IN (" + ",".join("?" for _ in types) + ")"
            params.extend(types)
        query += " ORDER BY seq LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [
            {
                "seq": row[0],
                "ts": row[1],
                "type": row[2],
                "actor": row[3],
                "turn": row[4],
                "step": row[5],
                "refs": _loads(row[6]),
                "data": _loads(row[7]),
                "visibility": row[8],
                "hash": row[9],
            }
            for row in rows
        ]

    def tasks(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,kind,title,status,risk,target,objective,done_when,allowed_tools,dependencies,"
            "evidence_required,basis_ids,created_at,updated_at,attempts,last_error FROM tasks ORDER BY created_at"
        ).fetchall()
        keys = (
            "id", "kind", "title", "status", "risk", "target", "objective", "doneWhen",
            "allowedTools", "dependencies", "evidenceRequired", "basisIds", "createdAt",
            "updatedAt", "attempts", "lastError",
        )
        return [
            {
                **dict(zip(keys, row, strict=False)),
                "allowedTools": _loads(row[8]),
                "dependencies": _loads(row[9]),
                "evidenceRequired": _loads(row[10]),
                "basisIds": _loads(row[11]),
            }
            for row in rows
        ]

    def approvals(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,task_id,kind,title,detail,risk,status,created_at,expires_at FROM approvals ORDER BY created_at"
        ).fetchall()
        keys = ("id", "taskId", "kind", "title", "detail", "risk", "status", "createdAt", "expiresAt")
        return [dict(zip(keys, row, strict=False)) for row in rows]

    def evidence(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,kind,summary,artifact_id,hash,hypothesis_id,task_id,promoted,created_at FROM evidence ORDER BY created_at"
        ).fetchall()
        keys = ("id", "kind", "summary", "artifactId", "hash", "hypothesisId", "taskId", "promoted", "createdAt")
        return [dict(zip(keys, row, strict=False)) for row in rows]

    def findings(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,title,severity,state,asset,hypothesis_id,evidence_ids,created_at,updated_at FROM findings ORDER BY created_at"
        ).fetchall()
        keys = ("id", "title", "severity", "state", "asset", "hypothesisId", "evidenceIds", "createdAt", "updatedAt")
        return [
            {
                **dict(zip(keys, row, strict=False)),
                "evidenceIds": _loads(row[6]),
            }
            for row in rows
        ]

    def hypotheses(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id,title,security_question,surface,state,confidence,required_evidence,created_at,updated_at FROM hypotheses ORDER BY created_at"
        ).fetchall()
        keys = ("id", "title", "securityQuestion", "surface", "state", "confidence", "requiredEvidence", "createdAt", "updatedAt")
        return [
            {
                **dict(zip(keys, row, strict=False)),
                "requiredEvidence": _loads(row[6]),
            }
            for row in rows
        ]

    def context(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT seq,role,model_id,budget_tokens,used_tokens,fit,compression_ratio,warnings,sections,created_at "
            "FROM context_packets ORDER BY id DESC LIMIT 20"
        ).fetchall()
        return [
            {
                "seq": row[0],
                "role": row[1],
                "modelId": row[2],
                "budgetTokens": row[3],
                "usedTokens": row[4],
                "fit": bool(row[5]),
                "compressionRatio": row[6],
                "warnings": _loads(row[7]),
                "sections": _loads(row[8]),
                "createdAt": row[9],
            }
            for row in rows
        ]

    def summary(self) -> dict[str, Any]:
        state = self.conn.execute(
            "SELECT title,mode,status,provider,model,last_seq FROM session_state WHERE session_id=?",
            (self.session_id,),
        ).fetchone()
        return {
            "title": state[0] if state else "",
            "mode": state[1] if state else "",
            "status": state[2] if state else "idle",
            "provider": state[3] if state else "",
            "model": state[4] if state else "",
            "lastSeq": state[5] if state else self.last_seq(),
            "tasks": len(self.tasks()),
            "approvals": len(self.approvals()),
            "evidence": len(self.evidence()),
            "findings": len(self.findings()),
        }

    def close(self) -> None:
        self.conn.close()


__all__ = ["ProjectionStats", "SessionProjection"]
