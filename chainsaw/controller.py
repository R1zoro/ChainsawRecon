"""Deterministic supervisor/executor loop.

Models propose; this module validates and commits. It is intentionally small:
one decision per tick, one leased task at a time, one bounded operator action.
Provider adapters and the live capture proxy plug in later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from .context import ContextAssembler, ContextPacket, ContextSection
from .roles import Role
from .runtime import SessionRuntime, TaskSpec
from .workbench import ApprovalRequired, ScopePolicy, WorkbenchStore, replay


class DecisionKind(str, Enum):
    NEW_TASK = "new_task"
    SELECT_TASK = "select_task"
    FINISH = "finish"


@dataclass(frozen=True)
class SupervisorDecision:
    kind: DecisionKind
    reason: str = ""
    task: TaskSpec | None = None
    task_id: str = ""


class DecisionProvider(Protocol):
    def decide(self, packet: ContextPacket) -> SupervisorDecision: ...


@dataclass(frozen=True)
class TickResult:
    decision: str
    task_id: str
    status: str
    reason: str
    context: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "taskId": self.task_id,
            "status": self.status,
            "reason": self.reason,
            "context": self.context,
        }


class Controller:
    """Owns the supervisor tick.

    The provider only chooses. This class validates the choice against the
    current projection, then leases/starts through the runtime primitives.
    """

    def __init__(
        self,
        runtime: SessionRuntime,
        *,
        provider: DecisionProvider,
        assembler: ContextAssembler,
        model: str = "",
        max_steps: int = 100,
    ) -> None:
        self.runtime = runtime
        self.provider = provider
        self.assembler = assembler
        self.model = model
        self.max_steps = max_steps
        self.steps = 0

    def tick(self) -> TickResult:
        if self.steps >= self.max_steps:
            return TickResult("finish", "", "budget_exhausted", "max steps reached", {})
        packet = self.assembler.assemble(Role.ORCHESTRATOR, self._sections())
        decision = self.provider.decide(packet)
        self.steps += 1

        context = self._record_context(Role.ORCHESTRATOR, packet)
        if decision.kind is DecisionKind.FINISH:
            return TickResult("finish", "", "finished", decision.reason, context)

        if decision.kind is DecisionKind.NEW_TASK:
            if decision.task is None:
                raise ValueError("new_task decision requires a task spec")
            existing = {item["id"]: item["status"] for item in self.runtime.tasks()}
            if decision.task.id in existing:
                raise ValueError(f"task already exists: {decision.task.id}")
            unmet = [
                dep
                for dep in decision.task.dependencies
                if existing.get(dep) != "completed"
            ]
            if unmet:
                raise ValueError(
                    f"task {decision.task.id} has unmet dependencies: {', '.join(unmet)}"
                )
            self.runtime.create_task(decision.task)
            self.runtime.lease_task(decision.task.id, worker=decision.task.worker)
            self.runtime.start_task(decision.task.id)
            return TickResult(
                "new_task",
                decision.task.id,
                "started",
                decision.reason,
                context,
            )

        task = self.runtime.task(decision.task_id)
        if task["status"] not in {"proposed", "ready"}:
            raise ValueError(
                f"task {decision.task_id} is {task['status']}, expected proposed or ready"
            )
        self.runtime.lease_task(decision.task_id, worker=str(task.get("worker", "operator")))
        self.runtime.start_task(decision.task_id)
        return TickResult("select_task", decision.task_id, "started", decision.reason, context)

    def _sections(self) -> list[ContextSection]:
        tasks = self.runtime.tasks()
        task_lines = [
            {
                "id": item["id"],
                "kind": item["kind"],
                "title": item["title"],
                "status": item["status"],
                "target": item["target"],
                "risk": item["risk"],
                "dependencies": item.get("dependencies", []),
                "evidenceRequired": item.get("evidenceRequired", []),
            }
            for item in tasks
        ]
        return [
            ContextSection(
                "objective",
                "Choose one next action: propose at most one new task, select one ready task, "
                "or finish the session.",
                priority=100,
                required=True,
                compressible=False,
            ),
            ContextSection(
                "tasks",
                json.dumps(task_lines, ensure_ascii=False, sort_keys=True),
                priority=90,
                required=True,
                summary=f"{len(task_lines)} tasks",
                digest=f"{sum(1 for item in task_lines if item['status'] == 'completed')} completed",
                pointer="tasks",
            ),
            ContextSection(
                "constraints",
                "Do not invent targets. Respect scope, budgets, dependencies, and evidence "
                "requirements. One task per step.",
                priority=80,
                required=True,
                compressible=False,
            ),
        ]

    def _record_context(self, role: Role, packet: ContextPacket) -> dict[str, Any]:
        report = packet.report.to_dict()
        raw_decisions = report.get("decisions")
        decisions: list[dict[str, Any]] = (
            [item for item in raw_decisions if isinstance(item, dict)]
            if isinstance(raw_decisions, list)
            else []
        )
        self.runtime.record_context(
            role=role.value,
            model=self.model,
            budget_tokens=packet.report.budget_tokens,
            used_tokens=packet.report.final_tokens,
            fit=packet.report.fit,
            compression_ratio=packet.report.compression_ratio,
            warnings=packet.report.warnings,
            decisions=decisions,
        )
        return report


@dataclass(frozen=True)
class ReplayAction:
    request_id: str
    patch: dict[str, Any] = field(default_factory=dict)
    justification: str = ""
    observation: str = ""
    hypothesis_id: str = ""

    def __post_init__(self) -> None:
        if not self.request_id:
            raise ValueError("request_id is required")


@dataclass(frozen=True)
class ExecuteResult:
    task_id: str
    status: str
    scope: str
    evidence_id: str
    response_status: int
    context: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "taskId": self.task_id,
            "status": self.status,
            "scope": self.scope,
            "evidenceId": self.evidence_id,
            "responseStatus": self.response_status,
            "context": self.context,
        }


class Executor:
    """Executes one leased task with one bounded HTTP action.

    The action is replayed through the workbench, which enforces scope before
    transport. Evidence and observations are recorded through the runtime.
    """

    def __init__(
        self,
        runtime: SessionRuntime,
        *,
        assembler: ContextAssembler,
        model: str = "",
        transport: Any | None = None,
    ) -> None:
        self.runtime = runtime
        self.assembler = assembler
        self.model = model
        self.transport = transport

    def execute(
        self,
        task_id: str,
        action: ReplayAction,
        *,
        store: WorkbenchStore,
        policy: ScopePolicy,
    ) -> ExecuteResult:
        task = self.runtime.task(task_id)
        if task["status"] not in {"started", "leased"}:
            raise ValueError(f"task {task_id} is {task['status']}, expected started or leased")
        if task["status"] == "leased":
            self.runtime.start_task(task_id)

        packet = self.assembler.assemble(
            Role.OPERATOR,
            [
                ContextSection(
                    "task",
                    json.dumps(
                        {key: task.get(key) for key in ("id", "kind", "title", "target", "risk")},
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    priority=100,
                    required=True,
                    compressible=False,
                ),
                ContextSection(
                    "objective",
                    str(task.get("objective", "")),
                    priority=90,
                    required=True,
                ),
                ContextSection(
                    "done_when",
                    str(task.get("doneWhen", "")),
                    priority=80,
                    required=True,
                ),
                ContextSection(
                    "allowed_tools",
                    ", ".join(str(item) for item in task.get("allowedTools", [])),
                    priority=70,
                ),
            ],
        )
        context = packet.report.to_dict()
        raw_decisions = context.get("decisions")
        decisions: list[dict[str, Any]] = (
            [item for item in raw_decisions if isinstance(item, dict)]
            if isinstance(raw_decisions, list)
            else []
        )
        self.runtime.record_context(
            role=Role.OPERATOR.value,
            model=self.model,
            budget_tokens=packet.report.budget_tokens,
            used_tokens=packet.report.final_tokens,
            fit=packet.report.fit,
            compression_ratio=packet.report.compression_ratio,
            warnings=packet.report.warnings,
            decisions=decisions,
        )

        if str(task.get("risk")) == "intrusive" and not action.justification.strip():
            raise ApprovalRequired("intrusive task requires a justification")

        self.runtime.transition_task(task_id, "attempted", reason="operator action started")
        result = replay(
            store,
            action.request_id,
            patch=action.patch,
            policy=policy,
            justification=action.justification,
            transport=self.transport,
        )

        if not result["scope"]["allowed"]:
            self.runtime.transition_task(
                task_id,
                "blocked",
                reason=str(result["scope"]["reason"]),
            )
            return ExecuteResult(
                task_id=task_id,
                status="blocked",
                scope="blocked",
                evidence_id="",
                response_status=0,
                context=context,
            )

        evidence = store.record_evidence(
            request_id=str(result["request"]["id"]),
            response_id=f"resp_{result['request']['id']}",
            hypothesis_id=action.hypothesis_id,
            task_id=task_id,
            note=action.observation,
            session_id=self.runtime.session_id,
            artifact_dir=Path(store.db_path).parent / "artifacts",
        )
        self.runtime.record_evidence(
            evidence_id=str(evidence["id"]),
            kind=str(evidence["kind"]),
            summary=str(evidence["summary"]),
            artifact_id=str(evidence["artifactId"]),
            content_hash=str(evidence["hash"]),
            task_id=task_id,
            hypothesis_id=action.hypothesis_id,
            request_id=str(result["request"]["id"]),
            response_id=str(evidence["responseId"]),
        )
        if action.observation:
            self.runtime.record_observation(
                observation_id="obs_" + str(evidence["id"])[4:],
                task_id=task_id,
                statement=action.observation,
                evidence_id=str(evidence["id"]),
                confidence="observed",
            )
        self.runtime.transition_task(task_id, "observed", reason="response captured")
        self.runtime.complete_task(task_id, reason="task objective captured evidence")

        return ExecuteResult(
            task_id=task_id,
            status="completed",
            scope="allowed",
            evidence_id=str(evidence["id"]),
            response_status=int(result["response"]["status"]),
            context=context,
        )


class ScriptedProvider:
    """Deterministic decision provider for tests and dry runs."""

    def __init__(self, decisions: list[SupervisorDecision]) -> None:
        self._decisions = list(decisions)
        self.packets: list[ContextPacket] = []

    def decide(self, packet: ContextPacket) -> SupervisorDecision:
        self.packets.append(packet)
        if not self._decisions:
            return SupervisorDecision(DecisionKind.FINISH, reason="no decisions left")
        return self._decisions.pop(0)
