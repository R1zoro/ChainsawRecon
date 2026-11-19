"""Session runner: provider-backed supervisor and operator loop.

The runner does not make policy decisions itself. It supplies model-backed
decision/action providers to the deterministic controller and executor.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from .context import ContextAssembler, ContextBudget, ContextPacket
from .controller import (
    Controller,
    DecisionKind,
    DecisionProvider,
    ExecuteResult,
    Executor,
    ReplayAction,
    SupervisorDecision,
)
from .governor import RequestGovernor
from .providers import (
    ChatMessage,
    ChatProvider,
    ProviderResponseError,
    extract_json_object,
)
from .runtime import SessionRuntime, TaskSpec
from .workbench import ScopePolicy, WorkbenchStore

ORCHESTRATOR_SYSTEM = (
    "You are the orchestrator for an authorized security engagement. "
    "Choose exactly one action and return only a JSON object. Valid shapes:\n"
    '{"decision":"new_task","reason":"...","task":{'
    '"id":"tsk_short_id","kind":"test.idor","title":"...","target":"https://...",'
    '"objective":"...","doneWhen":"...","risk":"read-only|active|intrusive",'
    '"allowedTools":["http.request"],"dependencies":[],"evidenceRequired":["baseline"],'
    '"basisIds":[],"worker":"operator"}}\n'
    '{"decision":"select_task","taskId":"tsk_existing","reason":"..."}\n'
    '{"decision":"finish","reason":"..."}\n'
    "Do not invent targets outside scope. Do not create more than one task."
)

ACTION_SYSTEM = (
    "You are the operator for one authorized task. Choose exactly one HTTP request from the "
    "provided history and return only a JSON object:\n"
    '{"requestId":"req_...","patch":{"query":{},"header":{},"path":"/...",'
    '"json":null,"form":null},"justification":"required for DELETE/PUT/PATCH",'
    '"observation":"exact observation backed by the response","hypothesisId":""}\n'
    "Never invent a request id. Prefer the smallest mutation that answers the task."
)


class RunnerError(RuntimeError):
    pass


@dataclass(frozen=True)
class RunConfig:
    max_steps: int = 10
    context_window: int = 8192
    max_output_tokens: int = 1024
    temperature: float = 0.1
    noise_profile: str = "balanced"


@dataclass(frozen=True)
class RunResult:
    steps: int
    finished: bool
    reason: str
    ticks: list[dict[str, Any]] = field(default_factory=list)
    executions: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "steps": self.steps,
            "finished": self.finished,
            "reason": self.reason,
            "ticks": self.ticks,
            "executions": self.executions,
        }


class ActionProvider(Protocol):
    def choose(self, task: dict[str, Any]) -> ReplayAction: ...


def parse_decision(payload: dict[str, Any]) -> SupervisorDecision:
    kind_value = str(payload.get("decision") or payload.get("kind") or "").strip()
    reason = str(payload.get("reason") or "")
    if kind_value == "finish":
        return SupervisorDecision(DecisionKind.FINISH, reason=reason)
    if kind_value == "select_task":
        task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
        if not task_id:
            raise RunnerError("select_task requires taskId")
        return SupervisorDecision(DecisionKind.SELECT_TASK, reason=reason, task_id=task_id)
    if kind_value == "new_task":
        raw = payload.get("task")
        if not isinstance(raw, dict):
            raise RunnerError("new_task requires a task object")
        try:
            task = TaskSpec(
                id=str(raw["id"]),
                kind=str(raw["kind"]),
                title=str(raw["title"]),
                target=str(raw["target"]),
                objective=str(raw.get("objective", "")),
                done_when=str(raw.get("doneWhen") or raw.get("done_when") or ""),
                risk=str(raw.get("risk", "read-only")),
                allowed_tools=tuple(str(item) for item in raw.get("allowedTools", [])),
                dependencies=tuple(str(item) for item in raw.get("dependencies", [])),
                evidence_required=tuple(
                    str(item) for item in raw.get("evidenceRequired", [])
                ),
                basis_ids=tuple(str(item) for item in raw.get("basisIds", [])),
                worker=str(raw.get("worker", "operator")),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RunnerError(f"invalid task spec: {exc}") from exc
        return SupervisorDecision(DecisionKind.NEW_TASK, reason=reason, task=task)
    raise RunnerError(f"unknown decision: {kind_value or '(missing)'}")


class LLMDecisionProvider:
    def __init__(
        self,
        provider: ChatProvider,
        *,
        model: str = "",
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ) -> None:
        self.provider = provider
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens

    def decide(self, packet: ContextPacket) -> SupervisorDecision:
        messages = [
            ChatMessage("system", ORCHESTRATOR_SYSTEM),
            ChatMessage("user", packet.render()),
        ]
        last_error: Exception | None = None
        for _ in range(2):
            completion = self.provider.chat(
                messages,
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            try:
                return parse_decision(extract_json_object(completion.text))
            except (ProviderResponseError, RunnerError) as exc:
                last_error = exc
                messages = [
                    ChatMessage("system", ORCHESTRATOR_SYSTEM),
                    ChatMessage(
                        "user",
                        packet.render()
                        + "\n\nYour previous response was invalid. Return only one JSON object.",
                    ),
                ]
        raise RunnerError(f"orchestrator returned an invalid decision: {last_error}")


class LLMActionProvider:
    def __init__(
        self,
        provider: ChatProvider,
        store: WorkbenchStore,
        *,
        model: str = "",
        temperature: float = 0.1,
        max_tokens: int = 1024,
        history_limit: int = 20,
    ) -> None:
        self.provider = provider
        self.store = store
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.history_limit = history_limit

    def choose(self, task: dict[str, Any]) -> ReplayAction:
        flows, _ = self.store.list_flows(limit=self.history_limit, offset=0)
        if not flows:
            raise RunnerError(
                "no captured requests are available; import a HAR or replay a request first"
            )
        history = [
            {
                "id": item["id"],
                "method": item["method"],
                "url": item["url"],
                "status": item["status"],
                "auth": item["authContext"],
                "tags": item["tags"],
            }
            for item in flows
        ]
        prompt = json.dumps(
            {
                "task": {
                    "id": task.get("id"),
                    "kind": task.get("kind"),
                    "title": task.get("title"),
                    "target": task.get("target"),
                    "objective": task.get("objective"),
                    "doneWhen": task.get("doneWhen"),
                    "risk": task.get("risk"),
                },
                "history": history,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        messages = [
            ChatMessage("system", ACTION_SYSTEM),
            ChatMessage("user", prompt),
        ]
        last_error: Exception | None = None
        for _ in range(2):
            completion = self.provider.chat(
                messages,
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            try:
                payload = extract_json_object(completion.text)
                request_id = str(payload.get("requestId") or "").strip()
                known = {item["id"] for item in history}
                if request_id not in known:
                    raise RunnerError(f"unknown request id: {request_id or '(missing)'}")
                patch = payload.get("patch")
                return ReplayAction(
                    request_id=request_id,
                    patch=dict(patch) if isinstance(patch, dict) else {},
                    justification=str(payload.get("justification") or ""),
                    observation=str(payload.get("observation") or ""),
                    hypothesis_id=str(payload.get("hypothesisId") or ""),
                )
            except (ProviderResponseError, RunnerError) as exc:
                last_error = exc
                messages.append(
                    ChatMessage(
                        "user",
                        "Invalid action. Return one JSON object using an id from history.",
                    )
                )
        raise RunnerError(f"operator returned an invalid action: {last_error}")


class Runner:
    """Runs a bounded supervisor/executor loop for one session."""

    def __init__(
        self,
        runtime: SessionRuntime,
        *,
        store: WorkbenchStore,
        policy: ScopePolicy,
        provider: ChatProvider | None = None,
        model: str = "",
        config: RunConfig | None = None,
        decision_provider: DecisionProvider | None = None,
        action_provider: ActionProvider | None = None,
        transport: Any | None = None,
    ) -> None:
        self.runtime = runtime
        self.store = store
        self.policy = policy
        self.provider = provider
        self.model = model
        self.config = config or RunConfig()
        self.decision_provider = decision_provider
        self.action_provider = action_provider
        self.transport = transport

    def run(self) -> RunResult:
        assembler = ContextAssembler(
            ContextBudget(
                context_window=self.config.context_window,
                max_output_tokens=self.config.max_output_tokens,
            )
        )
        decision_provider = self.decision_provider
        if decision_provider is None:
            if self.provider is None:
                raise RunnerError("a provider or decision_provider is required")
            decision_provider = LLMDecisionProvider(
                self.provider,
                model=self.model,
                temperature=self.config.temperature,
            )
        action_provider = self.action_provider
        if action_provider is None:
            if self.provider is None:
                raise RunnerError("a provider or action_provider is required")
            action_provider = LLMActionProvider(
                self.provider,
                self.store,
                model=self.model,
                temperature=self.config.temperature,
            )

        controller = Controller(
            self.runtime,
            provider=decision_provider,
            assembler=assembler,
            model=self.model,
            max_steps=self.config.max_steps,
        )
        executor = Executor(
            self.runtime,
            assembler=assembler,
            model=self.model,
            transport=self.transport,
            governor=RequestGovernor.from_profile(self.config.noise_profile),
        )

        ticks: list[dict[str, Any]] = []
        executions: list[dict[str, Any]] = []
        finished = False
        reason = "max steps reached"
        for _ in range(self.config.max_steps):
            tick = controller.tick()
            ticks.append(tick.to_dict())
            if tick.decision == "finish":
                finished = True
                reason = tick.reason or "finished"
                break
            if tick.status == "budget_exhausted":
                reason = tick.reason
                break
            if not tick.task_id:
                continue
            try:
                action = action_provider.choose(self.runtime.task(tick.task_id))
                result: ExecuteResult = executor.execute(
                    tick.task_id,
                    action,
                    store=self.store,
                    policy=self.policy,
                )
                executions.append(result.to_dict())
            except Exception as exc:  # provider, transport, approval, workbench
                current = self.runtime.task(tick.task_id)
                if current["status"] not in {"completed", "failed", "blocked"}:
                    try:
                        self.runtime.fail_task(tick.task_id, reason=str(exc))
                    except Exception:
                        pass
                executions.append(
                    {
                        "taskId": tick.task_id,
                        "status": "failed",
                        "error": str(exc),
                        "errorType": exc.__class__.__name__,
                    }
                )
        return RunResult(
            steps=len(ticks),
            finished=finished,
            reason=reason,
            ticks=ticks,
            executions=executions,
        )
