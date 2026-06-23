from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RetrievalDocument:
    step: int
    action: dict[str, Any]
    content: str
    meta: dict[str, Any]


class RetrievalStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.execute("PRAGMA journal_mode=DELETE")
        self.use_fts = self._supports_fts()
        self._create_tables()

    def _supports_fts(self) -> bool:
        try:
            self.conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_test USING fts5(content)")
            self.conn.execute("DROP TABLE IF EXISTS _fts_test")
            return True
        except sqlite3.DatabaseError:
            return False

    def _create_tables(self) -> None:
        cursor = self.conn.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, step INTEGER, action TEXT, content TEXT, meta TEXT)"
        )
        if self.use_fts:
            cursor.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(content, action, meta)"
            )
        else:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS docs_fts(id INTEGER PRIMARY KEY, content TEXT, action TEXT, meta TEXT)"
            )
        self.conn.commit()

    def add(self, step: int, action: dict[str, Any], content: str, meta: dict[str, Any] | None = None) -> None:
        meta_data = json.dumps(meta or {}, ensure_ascii=False)
        action_data = json.dumps(action, ensure_ascii=False)
        cursor = self.conn.cursor()
        cursor.execute(
            "INSERT INTO docs(step, action, content, meta) VALUES (?, ?, ?, ?)",
            (step, action_data, content, meta_data),
        )
        rowid = cursor.lastrowid
        if self.use_fts:
            cursor.execute(
                "INSERT INTO docs_fts(rowid, content, action, meta) VALUES (?, ?, ?, ?)",
                (rowid, content, action_data, meta_data),
            )
        else:
            cursor.execute(
                "INSERT INTO docs_fts(id, content, action, meta) VALUES (?, ?, ?, ?)",
                (rowid, content, action_data, meta_data),
            )
        self.conn.commit()

    def search(self, query: str, top_k: int = 5) -> list[RetrievalDocument]:
        if not query or not query.strip():
            return []
        cursor = self.conn.cursor()
        if self.use_fts:
            sanitized = _sanitize_fts_query(query)
            if not sanitized:
                return []
            rows = cursor.execute(
                "SELECT d.step, d.action, d.content, d.meta FROM docs_fts f JOIN docs d ON f.rowid = d.id WHERE docs_fts MATCH ? LIMIT ?",
                (sanitized, top_k),
            ).fetchall()
        else:
            pattern = f"%{query.replace('%', '\\%').replace('_', '\\_')}%"
            rows = cursor.execute(
                "SELECT step, action, content, meta FROM docs_fts WHERE content LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\' LIMIT ?",
                (pattern, pattern, pattern, top_k),
            ).fetchall()
        return [
            RetrievalDocument(step=row[0], action=json.loads(row[1]), content=row[2], meta=json.loads(row[3] or "{}"))
            for row in rows
        ]

    def close(self) -> None:
        self.conn.close()


class NullRetrievalStore:
    def add(self, step: int, action: dict[str, Any], content: str, meta: dict[str, Any] | None = None) -> None:
        return None

    def search(self, query: str, top_k: int = 5) -> list[RetrievalDocument]:
        return []

    def close(self) -> None:
        return None


def _sanitize_fts_query(value: str) -> str:
    # Accept only simple term searches; remove punctuation and special operators.
    cleaned = re.sub(r"[^\w]+", " ", value)
    return " ".join(token for token in cleaned.split() if token)
