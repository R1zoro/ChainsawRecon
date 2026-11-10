"""Append-only session journal.

One JSON object per line. Each event carries a monotonically increasing ``seq``
and a SHA-256 hash chain. The journal is the durable source of truth; SQLite
projections are rebuildable from it.

Secrets are redacted before write. Callers should still avoid putting raw
credentials in event data; this is a safety net, not a licence.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS_HASH = "genesis"

_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "id_token",
        "password",
        "passwd",
        "secret",
        "client_secret",
    }
)

_HEADER_RE = re.compile(
    r"(?i)\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]+"
)
_REDACTED = "«redacted»"


def redact_payload(value: Any) -> Any:
    """Return a deep copy with structured secret fields and header-like strings redacted."""
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in _SENSITIVE_KEYS:
                result[key] = _REDACTED
            else:
                result[key] = redact_payload(item)
        return result
    if isinstance(value, list):
        return [redact_payload(item) for item in value]
    if isinstance(value, tuple):
        return [redact_payload(item) for item in value]
    if isinstance(value, str):
        return _HEADER_RE.sub(lambda match: f"{match.group(1)}: {_REDACTED}", value)
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class JournalEvent:
    seq: int
    ts: str
    session_id: str
    type: str
    actor: str
    turn: int | None
    step: int | None
    refs: dict[str, str]
    data: Any
    visibility: str
    prev_hash: str
    hash: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "ts": self.ts,
            "session_id": self.session_id,
            "type": self.type,
            "actor": self.actor,
            "turn": self.turn,
            "step": self.step,
            "refs": self.refs,
            "data": self.data,
            "visibility": self.visibility,
            "prev_hash": self.prev_hash,
            "hash": self.hash,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> JournalEvent:
        return cls(
            seq=int(value["seq"]),
            ts=str(value["ts"]),
            session_id=str(value["session_id"]),
            type=str(value["type"]),
            actor=str(value.get("actor", "system")),
            turn=value.get("turn"),
            step=value.get("step"),
            refs=dict(value.get("refs") or {}),
            data=value.get("data"),
            visibility=str(value.get("visibility", "both")),
            prev_hash=str(value["prev_hash"]),
            hash=str(value["hash"]),
        )


@dataclass(frozen=True)
class JournalVerification:
    ok: bool
    count: int
    first_seq: int | None
    last_seq: int | None
    broken_at: int | None = None
    reason: str = ""


class JournalError(ValueError):
    pass


def _hash_event(prev_hash: str, event_without_hash: dict[str, Any]) -> str:
    payload = prev_hash + "\n" + canonical_json(event_without_hash)
    return hashlib.sha256(payload.encode("utf-8", errors="replace")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JournalWriter:
    """Append events to one session journal and maintain the hash chain."""

    def __init__(self, path: Path | str, session_id: str) -> None:
        self.path = Path(path)
        self.session_id = session_id
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._seq = 0
        self._prev_hash = GENESIS_HASH
        if self.path.exists() and self.path.stat().st_size > 0:
            last = _read_last(self.path)
            if last.session_id != self.session_id:
                raise JournalError(
                    f"journal belongs to session '{last.session_id}', not "
                    f"'{self.session_id}'"
                )
            self._seq = last.seq
            self._prev_hash = last.hash

    @property
    def next_seq(self) -> int:
        return self._seq + 1

    def append(
        self,
        event_type: str,
        data: Any = None,
        *,
        actor: str = "system",
        refs: dict[str, str] | None = None,
        turn: int | None = None,
        step: int | None = None,
        visibility: str = "both",
    ) -> JournalEvent:
        if not event_type:
            raise ValueError("event_type is required")
        seq = self._seq + 1
        payload = {
            "seq": seq,
            "ts": _now(),
            "session_id": self.session_id,
            "type": event_type,
            "actor": actor,
            "turn": turn,
            "step": step,
            "refs": {str(k): str(v) for k, v in (refs or {}).items()},
            "data": redact_payload(data if data is not None else {}),
            "visibility": visibility,
            "prev_hash": self._prev_hash,
        }
        digest = _hash_event(self._prev_hash, payload)
        event = JournalEvent(hash=digest, **payload)
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(canonical_json(event.to_dict()) + "\n")
            handle.flush()
        self._seq = seq
        self._prev_hash = digest
        return event


def read_journal(path: Path | str) -> Iterator[JournalEvent]:
    path = Path(path)
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise JournalError(f"invalid JSON at line {line_number}: {exc}") from exc
            if not isinstance(value, dict):
                raise JournalError(f"journal line {line_number} is not an object")
            yield JournalEvent.from_dict(value)


def verify_journal(path: Path | str) -> JournalVerification:
    events = list(read_journal(path))
    if not events:
        return JournalVerification(True, 0, None, None, reason="empty journal")
    expected_prev = GENESIS_HASH
    for index, event in enumerate(events, start=1):
        if event.seq != index:
            return JournalVerification(
                False,
                len(events),
                events[0].seq,
                events[-1].seq,
                broken_at=event.seq,
                reason=f"expected seq {index}, found {event.seq}",
            )
        if event.prev_hash != expected_prev:
            return JournalVerification(
                False,
                len(events),
                events[0].seq,
                events[-1].seq,
                broken_at=event.seq,
                reason=f"prev_hash mismatch at seq {event.seq}",
            )
        payload = event.to_dict()
        claimed_hash = payload.pop("hash")
        if _hash_event(event.prev_hash, payload) != claimed_hash:
            return JournalVerification(
                False,
                len(events),
                events[0].seq,
                events[-1].seq,
                broken_at=event.seq,
                reason=f"hash mismatch at seq {event.seq}",
            )
        expected_prev = event.hash
    return JournalVerification(
        True,
        len(events),
        events[0].seq,
        events[-1].seq,
        reason="ok",
    )


def _read_last(path: Path) -> JournalEvent:
    last_line = ""
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            if raw.strip():
                last_line = raw
    if not last_line:
        raise JournalError(f"journal is empty: {path}")
    try:
        value = json.loads(last_line)
    except json.JSONDecodeError as exc:
        raise JournalError(f"journal tail is not valid JSON: {exc}") from exc
    return JournalEvent.from_dict(value)


__all__ = [
    "GENESIS_HASH",
    "JournalError",
    "JournalEvent",
    "JournalVerification",
    "JournalWriter",
    "canonical_json",
    "read_journal",
    "redact_payload",
    "verify_journal",
]
