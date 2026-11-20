"""Typed tool registry and tool-calling agent loop.

Models propose tool calls; this layer validates arguments and executes only the
tools in the registry. Every HTTP action still passes through scope, approval,
and the request governor.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .appmodel import AppModel
from .governor import RequestGovernor
from .providers import ChatProvider
from .runtime import SessionRuntime, TaskSpec
from .sandbox import SandboxRunner
from .webui import parse_tool_calls
from .workbench import (
    DESTRUCTIVE_METHODS,
    MAX_STORED_BODY,
    ApprovalRequired,
    Flow,
    FlowNotFound,
    ScopePolicy,
    TransportFailed,
    WorkbenchStore,
    replay,
)

MAX_TOOL_OUTPUT = 8000


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]

    def to_openai(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_prompt(self) -> str:
        return (
            f"Tool: {self.name}\n"
            f"Description: {self.description}\n"
            f"Parameters: {json.dumps(self.parameters, ensure_ascii=False, sort_keys=True)}"
        )


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


class ToolRegistry:
    def __init__(
        self,
        *,
        project_path: Path,
        project_id: str,
        runtime: SessionRuntime,
        store: WorkbenchStore,
        policy: ScopePolicy,
        governor: RequestGovernor | None = None,
        transport: Any | None = None,
        auth_headers: dict[str, str] | None = None,
        auth_cookies: dict[str, str] | None = None,
        sandbox: SandboxRunner | None = None,
        allow_shell: bool = False,
        verify_tls: bool = True,
    ) -> None:
        self.project_path = project_path
        self.project_id = project_id
        self.runtime = runtime
        self.store = store
        self.policy = policy
        self.governor = governor
        self.transport = transport
        self.auth_headers = auth_headers or {}
        self.auth_cookies = auth_cookies or {}
        self.sandbox = sandbox
        self.allow_shell = bool(allow_shell and sandbox is not None and sandbox.available)
        self.verify_tls = verify_tls
        self._handlers: dict[str, Callable[[dict[str, Any], str], dict[str, Any]]] = {
            "http.replay": self._http_replay,
            "http.request": self._http_request,
            "workbench.search": self._workbench_search,
            "appmodel.query": self._appmodel_query,
            "coverage.record": self._coverage_record,
            "evidence.record": self._evidence_record,
            "task.complete": self._task_complete,
        }
        self._definitions = {
            "http.replay": ToolDefinition(
                "http.replay",
                "Replay one captured request with an optional patch. Scope and destructive-method "
                "approval are enforced. A successful response records evidence.",
                _schema(
                    {
                        "requestId": {"type": "string"},
                        "patch": {"type": "object"},
                        "justification": {"type": "string"},
                        "observation": {"type": "string"},
                        "hypothesisId": {"type": "string"},
                    },
                    ["requestId"],
                ),
            ),
            "http.request": ToolDefinition(
                "http.request",
                "Send one new in-scope HTTP request discovered during recon. Scope and destructive-"
                "method approval are enforced. The request/response is captured as a flow.",
                _schema(
                    {
                        "method": {"type": "string"},
                        "url": {"type": "string"},
                        "headers": {"type": "object"},
                        "body": {"type": "string"},
                        "justification": {"type": "string"},
                        "observation": {"type": "string"},
                        "hypothesisId": {"type": "string"},
                        "recordEvidence": {"type": "boolean"},
                    },
                    ["method", "url"],
                ),
            ),
            "workbench.search": ToolDefinition(
                "workbench.search",
                "Search captured HTTP flows. Returns redacted summaries only.",
                _schema(
                    {
                        "q": {"type": "string"},
                        "method": {"type": "string"},
                        "status": {"type": "string"},
                        "limit": {"type": "integer"},
                    }
                ),
            ),
            "appmodel.query": ToolDefinition(
                "appmodel.query",
                "Query the application model entities, coverage, and finding count.",
                _schema(
                    {
                        "kind": {"type": "string"},
                        "q": {"type": "string"},
                        "limit": {"type": "integer"},
                    }
                ),
            ),
            "coverage.record": ToolDefinition(
                "coverage.record",
                "Record what was tested on one entity for one risk area. Negative results must be "
                "recorded so absence of a finding is not treated as clean.",
                _schema(
                    {
                        "entityId": {"type": "string"},
                        "riskArea": {"type": "string"},
                        "outcome": {"type": "string"},
                        "evidenceId": {"type": "string"},
                        "reason": {"type": "string"},
                        "surface": {"type": "string"},
                    },
                    ["entityId", "riskArea", "outcome"],
                ),
            ),
            "evidence.record": ToolDefinition(
                "evidence.record",
                "Pin a captured request/response as hashed evidence linked to the current task.",
                _schema(
                    {
                        "requestId": {"type": "string"},
                        "note": {"type": "string"},
                        "hypothesisId": {"type": "string"},
                    },
                    ["requestId"],
                ),
            ),
            "task.complete": ToolDefinition(
                "task.complete",
                "Mark the current task complete. Only call when the objective is satisfied or the "
                "result is explicitly negative and recorded.",
                _schema({"reason": {"type": "string"}}),
            ),
        }
        if self.allow_shell:
            self._handlers["shell.exec"] = self._shell_exec
            self._definitions["shell.exec"] = ToolDefinition(
                "shell.exec",
                "Run one shell command inside the native sandbox workspace. Use only for the "
                "leased task. Network is governed by the engagement scope.",
                _schema(
                    {
                        "command": {"type": "string"},
                        "cwd": {"type": "string"},
                        "timeout": {"type": "integer"},
                    },
                    ["command"],
                ),
            )

    def definitions(self) -> list[ToolDefinition]:
        return list(self._definitions.values())

    def openai_tools(self) -> list[dict[str, Any]]:
        return [definition.to_openai() for definition in self.definitions()]

    def prompt_block(self) -> str:
        return "\n\n".join(definition.to_prompt() for definition in self.definitions())

    def execute(self, name: str, arguments: dict[str, Any], task_id: str) -> dict[str, Any]:
        handler = self._handlers.get(name)
        if handler is None:
            return {"ok": False, "error": f"unknown tool: {name}"}
        try:
            return handler(arguments, task_id)
        except (KeyError, TypeError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:
            return {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"}

    def _http_replay(self, args: dict[str, Any], task_id: str) -> dict[str, Any]:
        request_id = str(args.get("requestId") or "").strip()
        if not request_id:
            return {"ok": False, "error": "requestId is required"}
        patch = args.get("patch")
        if patch is not None and not isinstance(patch, dict):
            return {"ok": False, "error": "patch must be an object"}
        try:
            result = replay(
                self.store,
                request_id,
                patch=dict(patch or {}),
                policy=self.policy,
                justification=str(args.get("justification") or ""),
                transport=self.transport,
                governor=self.governor,
                auth_headers=self.auth_headers,
                auth_cookies=self.auth_cookies,
            )
        except FlowNotFound as exc:
            return {"ok": False, "error": str(exc)}
        except ApprovalRequired as exc:
            return {"ok": False, "error": str(exc)}
        except TransportFailed as exc:
            return {"ok": False, "error": str(exc)}
        if not result["scope"]["allowed"]:
            return {
                "ok": False,
                "error": f"scope blocked: {result['scope']['reason']}",
                "scope": result["scope"],
                "request": result["request"],
            }
        evidence = self.store.record_evidence(
            request_id=str(result["request"]["id"]),
            response_id=f"resp_{result['request']['id']}",
            hypothesis_id=str(args.get("hypothesisId") or ""),
            task_id=task_id,
            note=str(args.get("observation") or ""),
            session_id=self.runtime.session_id,
            artifact_dir=self.project_path / ".chainsaw" / "artifacts",
        )
        self.runtime.record_evidence(
            evidence_id=str(evidence["id"]),
            kind=str(evidence["kind"]),
            summary=str(evidence["summary"]),
            artifact_id=str(evidence["artifactId"]),
            content_hash=str(evidence["hash"]),
            task_id=task_id,
            hypothesis_id=str(args.get("hypothesisId") or ""),
            request_id=str(result["request"]["id"]),
            response_id=str(evidence["responseId"]),
        )
        observation = str(args.get("observation") or "")
        if observation:
            self.runtime.record_observation(
                observation_id="obs_" + uuid.uuid4().hex[:12],
                task_id=task_id,
                statement=observation,
                evidence_id=str(evidence["id"]),
            )
        body = str(result["response"].get("body", ""))
        return {
            "ok": True,
            "request": result["request"],
            "response": {
                "status": result["response"]["status"],
                "headers": result["response"]["headers"],
                "bodyPreview": body[:MAX_TOOL_OUTPUT],
                "truncated": len(body) > MAX_TOOL_OUTPUT,
            },
            "evidenceId": evidence["id"],
            "scope": result["scope"],
        }

    def _http_request(self, args: dict[str, Any], task_id: str) -> dict[str, Any]:
        method = str(args.get("method") or "").strip().upper()
        url = str(args.get("url") or "").strip()
        if method not in {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"}:
            return {"ok": False, "error": f"unsupported method: {method}"}
        if not url:
            return {"ok": False, "error": "url is required"}
        decision = self.policy.check(url)
        if not decision.allowed:
            return {"ok": False, "error": f"scope blocked: {decision.reason}"}
        justification = str(args.get("justification") or "")
        if method in DESTRUCTIVE_METHODS and not justification.strip():
            return {"ok": False, "error": f"{method} requires a justification"}
        headers = {
            str(key): str(value)
            for key, value in dict(args.get("headers") or {}).items()
        }
        headers.update(self.auth_headers)
        if self.auth_cookies:
            existing = headers.get("Cookie", "")
            cookie = "; ".join(f"{key}={value}" for key, value in self.auth_cookies.items())
            headers["Cookie"] = f"{existing}; {cookie}".strip("; ") if existing else cookie
        for key in list(headers):
            if key.lower() in {"host", "content-length", "transfer-encoding", "connection"}:
                headers.pop(key, None)
        body_text = str(args.get("body") or "")
        body = body_text.encode("utf-8") if body_text else None
        started = time.perf_counter()
        if self.governor is not None:
            try:
                self.governor.acquire(url, method=method)
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
        try:
            with httpx.Client(
                follow_redirects=False,
                timeout=30,
                trust_env=False,
                transport=self.transport,
                verify=self.verify_tls,
            ) as client:
                response = client.request(method, url, headers=headers, content=body)
        except httpx.HTTPError as exc:
            return {"ok": False, "error": f"request failed: {exc.__class__.__name__}"}
        finally:
            if self.governor is not None:
                self.governor.release(url)
        if self.governor is not None:
            self.governor.observe(url, response.status_code)
        duration_ms = int((time.perf_counter() - started) * 1000)
        full_content = response.content
        stored = full_content[:MAX_STORED_BODY]
        response_headers = {str(key): str(value) for key, value in response.headers.items()}
        text = stored.decode(response.encoding or "utf-8", errors="replace")
        flow = Flow(
            id="req_" + uuid.uuid4().hex[:24],
            project_id=self.project_id,
            session_id=self.runtime.session_id,
            method=method,
            url=url,
            host="",
            path="",
            status=response.status_code,
            request_headers=headers,
            request_body=body_text[:MAX_STORED_BODY],
            response_headers=response_headers,
            response_body=text,
            size_bytes=len(full_content),
            duration_ms=duration_ms,
            tags=["agent"],
            in_scope=True,
            source="agent",
        )
        self.store.add_flow(flow)
        evidence_id = ""
        if bool(args.get("recordEvidence")) or str(args.get("observation") or "").strip():
            evidence = self.store.record_evidence(
                request_id=flow.id,
                response_id=f"resp_{flow.id}",
                hypothesis_id=str(args.get("hypothesisId") or ""),
                task_id=task_id,
                note=str(args.get("observation") or ""),
                session_id=self.runtime.session_id,
                artifact_dir=self.project_path / ".chainsaw" / "artifacts",
            )
            self.runtime.record_evidence(
                evidence_id=str(evidence["id"]),
                kind=str(evidence["kind"]),
                summary=str(evidence["summary"]),
                artifact_id=str(evidence["artifactId"]),
                content_hash=str(evidence["hash"]),
                task_id=task_id,
                hypothesis_id=str(args.get("hypothesisId") or ""),
                request_id=flow.id,
                response_id=str(evidence["responseId"]),
            )
            evidence_id = str(evidence["id"])
            if str(args.get("observation") or "").strip():
                self.runtime.record_observation(
                    observation_id="obs_" + uuid.uuid4().hex[:12],
                    task_id=task_id,
                    statement=str(args["observation"]),
                    evidence_id=evidence_id,
                )
        return {
            "ok": True,
            "requestId": flow.id,
            "status": response.status_code,
            "headers": flow.public()["responseHeaders"],
            "bodyPreview": text[:MAX_TOOL_OUTPUT],
            "truncated": len(full_content) > MAX_TOOL_OUTPUT,
            "evidenceId": evidence_id or None,
            "scope": {"allowed": True, "reason": decision.reason},
        }

    def _workbench_search(self, args: dict[str, Any], _task_id: str) -> dict[str, Any]:
        items, total = self.store.list_flows(
            q=str(args.get("q") or ""),
            method=str(args.get("method") or ""),
            status=str(args.get("status") or ""),
            limit=max(1, min(int(args.get("limit") or 20), 100)),
        )
        return {"ok": True, "total": total, "items": items}

    def _appmodel_query(self, args: dict[str, Any], _task_id: str) -> dict[str, Any]:
        model = AppModel(
            self.project_path / ".chainsaw" / "knowledge.db",
            self.project_id,
        )
        try:
            items = model.list_entities(
                kind=str(args.get("kind") or "") or None,
                query=str(args.get("q") or ""),
                limit=max(1, min(int(args.get("limit") or 50), 500)),
            )
            return {"ok": True, "items": items}
        finally:
            model.close()

    def _coverage_record(self, args: dict[str, Any], _task_id: str) -> dict[str, Any]:
        model = AppModel(
            self.project_path / ".chainsaw" / "knowledge.db",
            self.project_id,
        )
        try:
            entry = model.record_coverage(
                str(args.get("entityId") or ""),
                risk_area=str(args.get("riskArea") or ""),
                outcome=str(args.get("outcome") or ""),
                surface=str(args.get("surface") or ""),
                evidence_id=str(args.get("evidenceId") or ""),
                reason=str(args.get("reason") or ""),
                worker="agent",
            )
            return {"ok": True, "entry": entry}
        finally:
            model.close()

    def _evidence_record(self, args: dict[str, Any], task_id: str) -> dict[str, Any]:
        request_id = str(args.get("requestId") or "").strip()
        if not request_id:
            return {"ok": False, "error": "requestId is required"}
        evidence = self.store.record_evidence(
            request_id=request_id,
            response_id=f"resp_{request_id}",
            hypothesis_id=str(args.get("hypothesisId") or ""),
            task_id=task_id,
            note=str(args.get("note") or ""),
            session_id=self.runtime.session_id,
            artifact_dir=self.project_path / ".chainsaw" / "artifacts",
        )
        self.runtime.record_evidence(
            evidence_id=str(evidence["id"]),
            kind=str(evidence["kind"]),
            summary=str(evidence["summary"]),
            artifact_id=str(evidence["artifactId"]),
            content_hash=str(evidence["hash"]),
            task_id=task_id,
            hypothesis_id=str(args.get("hypothesisId") or ""),
            request_id=request_id,
            response_id=str(evidence["responseId"]),
        )
        return {"ok": True, "evidence": evidence}

    def _task_complete(self, args: dict[str, Any], task_id: str) -> dict[str, Any]:
        task = self.runtime.complete_task(
            task_id,
            reason=str(args.get("reason") or "agent completed the task"),
        )
        return {"ok": True, "task": task}

    def _shell_exec(self, args: dict[str, Any], task_id: str) -> dict[str, Any]:
        if self.sandbox is None or not self.allow_shell:
            return {"ok": False, "error": "shell execution is not enabled for this run"}
        command = str(args.get("command") or "").strip()
        if not command:
            return {"ok": False, "error": "command is required"}
        try:
            timeout = max(1, min(int(args.get("timeout") or self.sandbox.config.timeout), 300))
            result = self.sandbox.run(
                command,
                cwd=str(args.get("cwd") or "."),
                timeout=timeout,
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"}
        artifact_dir = self.project_path / ".chainsaw" / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        evidence_id = "evd_" + uuid.uuid4().hex[:12]
        payload = json.dumps(
            {
                "command": command,
                "cwd": str(args.get("cwd") or "."),
                "exitCode": result.exit_code,
                "timedOut": result.timed_out,
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        artifact_path = artifact_dir / f"{evidence_id}-shell.json"
        artifact_path.write_text(payload, encoding="utf-8")
        digest = "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
        self.runtime.record_evidence(
            evidence_id=evidence_id,
            kind="shell",
            summary=f"shell: {command[:120]}",
            artifact_id=str(artifact_path),
            content_hash=digest,
            task_id=task_id,
        )
        return {
            "ok": result.exit_code == 0 and not result.timed_out,
            "exitCode": result.exit_code,
            "stdout": result.stdout[:MAX_TOOL_OUTPUT],
            "stderr": result.stderr[:MAX_TOOL_OUTPUT],
            "timedOut": result.timed_out,
            "truncated": result.truncated or len(result.stdout) > MAX_TOOL_OUTPUT,
            "evidenceId": evidence_id,
            "sandbox": self.sandbox.describe(),
        }


@dataclass
class ToolAgentResult:
    task_id: str
    status: str
    final_text: str
    steps: int
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "taskId": self.task_id,
            "status": self.status,
            "finalText": self.final_text,
            "steps": self.steps,
            "toolCalls": self.tool_calls,
        }


class ToolAgent:
    def __init__(
        self,
        *,
        runtime: SessionRuntime,
        registry: ToolRegistry,
        provider: ChatProvider,
        model: str = "",
        max_steps: int = 12,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> None:
        self.runtime = runtime
        self.registry = registry
        self.provider = provider
        self.model = model
        self.max_steps = max_steps
        self.temperature = temperature
        self.max_tokens = max_tokens

    def run(self, prompt: str, *, task_id: str = "", target: str = "") -> ToolAgentResult:
        task_id = task_id or self._create_task(prompt, target)
        task = self.runtime.task(task_id)
        if task["status"] != "started":
            if task["status"] in {"proposed", "ready"}:
                self.runtime.lease_task(task_id)
                self.runtime.start_task(task_id)
            else:
                raise ValueError(f"task {task_id} is {task['status']}, expected started")

        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    "You are the operator for an authorized security engagement. "
                    "Use only the provided tools. Return one or more tool calls as JSON, or a final "
                    "plain-text answer when the task is complete. Never invent request ids. "
                    "Record negative results with coverage.record; do not report an untested asset "
                    "as clean.\n\n"
                    + self.registry.prompt_block()
                ),
            },
            {"role": "user", "content": prompt},
        ]
        tool_calls_seen: list[dict[str, Any]] = []
        final_text = ""
        for step in range(1, self.max_steps + 1):
            completion = self.provider.chat(
                messages,
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                tools=self.registry.openai_tools(),
            )
            calls = completion.tool_calls or parse_tool_calls(completion.text)
            if not calls:
                final_text = completion.text.strip()
                current = self.runtime.task(task_id)
                if current["status"] not in {"completed", "failed", "blocked"}:
                    self.runtime.complete_task(task_id, reason="agent returned final answer")
                return ToolAgentResult(
                    task_id=task_id,
                    status="completed",
                    final_text=final_text,
                    steps=step,
                    tool_calls=tool_calls_seen,
                )
            messages.append(
                {
                    "role": "assistant",
                    "content": completion.text or "tool call",
                }
            )
            for call in calls:
                name = str(call.get("name") or "").strip()
                arguments = call.get("arguments")
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except json.JSONDecodeError:
                        arguments = {}
                if not isinstance(arguments, dict):
                    arguments = {}
                result = self.registry.execute(name, arguments, task_id)
                tool_calls_seen.append({"name": name, "arguments": arguments, "result": result})
                serialized = json.dumps(result, ensure_ascii=False)[:MAX_STORED_BODY]
                messages.append(
                    {
                        "role": "user",
                        "content": f"TOOL RESULT {name}\n{serialized}",
                    }
                )
                if self.runtime.task(task_id)["status"] == "completed":
                    return ToolAgentResult(
                        task_id=task_id,
                        status="completed",
                        final_text=final_text or "task completed by tool call",
                        steps=step,
                        tool_calls=tool_calls_seen,
                    )
        current = self.runtime.task(task_id)
        if current["status"] not in {"completed", "failed", "blocked"}:
            try:
                self.runtime.fail_task(task_id, reason="tool loop step budget exhausted")
            except Exception:
                pass
        return ToolAgentResult(
            task_id=task_id,
            status=str(self.runtime.task(task_id)["status"]),
            final_text=final_text,
            steps=self.max_steps,
            tool_calls=tool_calls_seen,
        )

    def _create_task(self, prompt: str, target: str) -> str:
        task_id = "tsk_" + uuid.uuid4().hex[:12]
        title = (prompt.strip().splitlines()[0] if prompt.strip() else "Tool task")[:100]
        spec = TaskSpec(
            id=task_id,
            kind="agent.tool_loop",
            title=title,
            target=target or "session",
            objective=prompt,
            done_when="model returns a final answer or calls task.complete",
            risk="active",
            allowed_tools=tuple(definition.name for definition in self.registry.definitions()),
            evidence_required=(),
        )
        self.runtime.create_task(spec)
        self.runtime.lease_task(task_id)
        self.runtime.start_task(task_id)
        return task_id
