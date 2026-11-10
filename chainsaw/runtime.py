"""Deterministic session runtime primitives.

The controller, not the model, owns state. This module is the write side of the
runtime: it appends typed events to the journal and keeps the projection in
sync. A later Supervisor/Executor loop consumes these primitives; no model call
is made here.

This is the seam that turns the UI's empty task/approval/evidence/context states
into real data.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .journal import JournalEvent, JournalWriter
from .projection import SessionProjection
from .workspace import SessionPaths

TASK_TRANSITIONS: dict[str, set[str]] = {
    "proposed": {"ready", "blocked", "deferred"},
    "ready": {"leased", "blocked", "deferred"},
    "leased": {"started", "ready", "blocked", "deferred"},
    "started": {"attempted", "completed", "blocked", "failed"},
    "attempted": {"observed", "completed", "blocked", "failed"},
    "observed": {"completed", "blocked", "failed"},
    "blocked": {"ready", "deferred", "failed"},
    "deferred": {"ready", "failed"},
    "failed": {"ready"},
    "completed": set(),
}

RISK_LEVELS = {"read-only", "active", "intrusive"}


class RuntimeErrorBase(RuntimeError):
    pass


class InvalidTaskTransition(RuntimeErrorBase):
    def __init__(self, task_id: str, current: str, target: str) -> None:
        self.task_id = task_id
        self.current = current
        self.target = target
        super().__init__(
            f"Invalid task transition for {task_id}: {current} -> {target}. "
            f"Allowed: {', '.join(sorted(TASK_TRANSITIONS.get(current, set()))) or '(terminal)'}."
        )


@dataclass(frozen=True)
class TaskSpec:
    id: str
    kind: str
    title: str
    target: str
    objective: str
    done_when: str
    risk: str = "read-only"
    allowed_tools: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    evidence_required: tuple[str, ...] = ()
    basis_ids: tuple[str, ...] = ()
    worker: str = "operator"

    def __post_init__(self) -> None:
        if self.risk not in RISK_LEVELS:
            raise ValueError(f"risk must be one of {sorted(RISK_LEVELS)}")


@dataclass
class SessionRuntime:
    project_root: Any
    session_id: str
    _writer: JournalWriter = field(init=False)
    _paths: SessionPaths = field(init=False)
    _projection: SessionProjection = field(init=False)

    def __post_init__(self) -> None:
        from pathlib import Path

        self.project_root = Path(self.project_root).expanduser().resolve()
        self._paths = SessionPaths(self.project_root / ".chainsaw" / "sessions" / self.session_id)
        if not self._paths.session_file.exists():
            raise FileNotFoundError(f"session not found: {self.session_id}")
        self._writer = JournalWriter(self._paths.journal_file, self.session_id)
        self._projection = SessionProjection(self._paths.root / "state.db", self.session_id)
        self._projection.sync(self._paths.journal_file)

    # ── tasks ─────────────────────────────────────────────────────────

    def create_task(self, spec: TaskSpec) -> dict[str, Any]:
        self._append(
            "task/proposed",
            {
                "id": spec.id,
                "kind": spec.kind,
                "title": spec.title,
                "target": spec.target,
                "objective": spec.objective,
                "doneWhen": spec.done_when,
                "risk": spec.risk,
                "allowedTools": list(spec.allowed_tools),
                "dependencies": list(spec.dependencies),
                "evidenceRequired": list(spec.evidence_required),
                "basisIds": list(spec.basis_ids),
                "worker": spec.worker,
            },
            refs={"task_id": spec.id},
        )
        return self.task(spec.id)

    def lease_task(self, task_id: str, *, worker: str = "operator") -> dict[str, Any]:
        current = self._task_status(task_id)
        if current not in {"proposed", "ready"}:
            raise InvalidTaskTransition(task_id, current, "leased")
        self._append(
            "task/leased",
            {"taskId": task_id, "worker": worker},
            refs={"task_id": task_id},
        )
        return self.task(task_id)

    def start_task(self, task_id: str) -> dict[str, Any]:
        current = self._task_status(task_id)
        if current != "leased":
            raise InvalidTaskTransition(task_id, current, "started")
        self._append("task/started", {"taskId": task_id}, refs={"task_id": task_id})
        return self.task(task_id)

    def transition_task(self, task_id: str, target: str, *, reason: str = "") -> dict[str, Any]:
        current = self._task_status(task_id)
        if target not in TASK_TRANSITIONS.get(current, set()):
            raise InvalidTaskTransition(task_id, current, target)
        self._append(
            "task/transition",
            {"taskId": task_id, "from": current, "to": target, "reason": reason},
            refs={"task_id": task_id},
        )
        return self.task(task_id)

    def complete_task(self, task_id: str, *, reason: str = "") -> dict[str, Any]:
        return self.transition_task(task_id, "completed", reason=reason)

    def fail_task(self, task_id: str, *, reason: str = "") -> dict[str, Any]:
        return self.transition_task(task_id, "failed", reason=reason)

    def task(self, task_id: str) -> dict[str, Any]:
        for item in self._projection.tasks():
            if item["id"] == task_id:
                return item
        raise KeyError(f"task not found: {task_id}")

    def tasks(self) -> list[dict[str, Any]]:
        return self._projection.tasks()

    def approvals(self) -> list[dict[str, Any]]:
        return self._projection.approvals()

    def evidence(self) -> list[dict[str, Any]]:
        return self._projection.evidence()

    def findings(self) -> list[dict[str, Any]]:
        return self._projection.findings()

    def context(self) -> list[dict[str, Any]]:
        return self._projection.context()

    def _task_status(self, task_id: str) -> str:
        return str(self.task(task_id)["status"])

    # ── evidence / observations ───────────────────────────────────────

    def record_observation(
        self,
        *,
        observation_id: str,
        task_id: str,
        statement: str,
        evidence_id: str = "",
        receipt_id: str = "",
        confidence: str = "observed",
    ) -> JournalEvent:
        return self._append(
            "observation",
            {
                "observationId": observation_id,
                "statement": statement,
                "confidence": confidence,
                "evidenceId": evidence_id,
                "receiptId": receipt_id,
            },
            actor="agent",
            refs={"task_id": task_id, "evidence_id": evidence_id},
        )

    def record_evidence(
        self,
        *,
        evidence_id: str,
        kind: str,
        summary: str,
        artifact_id: str,
        content_hash: str,
        task_id: str = "",
        hypothesis_id: str = "",
        request_id: str = "",
        response_id: str = "",
    ) -> JournalEvent:
        return self._append(
            "evidence/recorded",
            {
                "kind": kind,
                "summary": summary,
                "artifactId": artifact_id,
                "hash": content_hash,
                "taskId": task_id or None,
                "hypothesisId": hypothesis_id or None,
                "requestId": request_id or None,
                "responseId": response_id or None,
            },
            actor="tool",
            refs={
                "evidence_id": evidence_id,
                "task_id": task_id,
                "hypothesis_id": hypothesis_id,
            },
        )

    def record_finding(
        self,
        *,
        finding_id: str,
        title: str,
        severity: str,
        state: str,
        asset: str,
        evidence_ids: Iterable[str] = (),
        hypothesis_id: str = "",
    ) -> JournalEvent:
        if state not in {"candidate", "validated", "rejected"}:
            raise ValueError("finding state must be candidate, validated, or rejected")
        evidence_list = [str(item) for item in evidence_ids]
        event_type = f"finding/{state}"
        return self._append(
            event_type,
            {
                "title": title,
                "severity": severity,
                "state": state,
                "asset": asset,
                "evidenceIds": evidence_list,
            },
            actor="agent",
            refs={
                "finding_id": finding_id,
                "hypothesis_id": hypothesis_id,
                **({"evidence_id": evidence_list[0]} if evidence_list else {}),
            },
        )

    def record_context(
        self,
        *,
        role: str,
        model: str,
        budget_tokens: int,
        used_tokens: int,
        fit: bool,
        compression_ratio: float = 1.0,
        warnings: Iterable[str] = (),
        decisions: Iterable[dict[str, Any]] = (),
    ) -> JournalEvent:
        return self._append(
            "context/assembled",
            {
                "role": role,
                "model": model,
                "budgetTokens": budget_tokens,
                "finalTokens": used_tokens,
                "fit": fit,
                "compressionRatio": compression_ratio,
                "warnings": list(warnings),
                "decisions": list(decisions),
            },
            actor="system",
        )

    # ── approvals ─────────────────────────────────────────────────────

    def request_approval(
        self,
        *,
        approval_id: str,
        task_id: str,
        kind: str,
        title: str,
        detail: str,
        risk: str = "high",
    ) -> JournalEvent:
        return self._append(
            "approval/requested",
            {"kind": kind, "title": title, "detail": detail, "risk": risk},
            refs={"approval_id": approval_id, "task_id": task_id},
        )

    def resolve_approval(self, approval_id: str, *, granted: bool, reason: str = "") -> JournalEvent:
        event_type = "approval/granted" if granted else "approval/denied"
        return self._append(
            event_type,
            {"reason": reason},
            actor="operator",
            refs={"approval_id": approval_id},
        )

    # ── lifecycle ─────────────────────────────────────────────────────

    def close_session(self, *, status: str = "completed") -> JournalEvent:
        return self._append("session/ended", {"status": status}, actor="system")

    def snapshot(self) -> dict[str, Any]:
        return self._projection.summary()

    def close(self) -> None:
        self._projection.close()

    def _append(
        self,
        event_type: str,
        data: dict[str, Any],
        *,
        actor: str = "system",
        refs: dict[str, str] | None = None,
    ) -> JournalEvent:
        event = self._writer.append(event_type, data, actor=actor, refs=refs)
        self._projection.sync(self._paths.journal_file)
        return event
