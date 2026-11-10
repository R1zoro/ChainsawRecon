from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..journal import read_journal, verify_journal
from ..workspace import (
    ChainsawHome,
    SessionPaths,
)
from .models import (
    ApprovalDecision,
    MessageCreate,
    NoteCreate,
    ProjectCreate,
    ProjectOpen,
    ProviderCreate,
    SessionCreate,
)
from .registry import ProjectNotFoundError, ProjectRegistry

API_VERSION = "1"


def _request_id(request: Request | None = None) -> str:
    if request is not None:
        value = request.headers.get("X-Request-Id", "").strip()
        if value:
            return value
    return "req_" + uuid4().hex[:16]


def _error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    request: Request | None = None,
    details: dict[str, Any] | None = None,
    retryable: bool = False,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "request_id": _request_id(request),
                "retryable": retryable,
            }
        },
    )


def _event_dict(event: Any) -> dict[str, Any]:
    return {
        "seq": event.seq,
        "ts": event.ts,
        "sessionId": event.session_id,
        "type": event.type,
        "actor": event.actor,
        "turn": event.turn,
        "step": event.step,
        "refs": event.refs,
        "data": event.data,
        "visibility": event.visibility,
    }


def _page(items: list[Any], *, limit: int, offset: int) -> dict[str, Any]:
    total = len(items)
    page = items[offset : offset + limit]
    next_offset = offset + len(page)
    return {
        "items": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "next": next_offset if next_offset < total else None,
    }


def create_app(home: ChainsawHome | None = None) -> FastAPI:
    app = FastAPI(title="ChainsawRecon API", version="2.0.0-preview")
    registry = ProjectRegistry(home or ChainsawHome.default())

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "https://tauri.localhost",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = str(exc.detail).split(":", 1)[0] if isinstance(exc.detail, str) else "HTTP_ERROR"
        if code not in {
            "BAD_REQUEST",
            "UNAUTHORIZED",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "SCOPE_BLOCKED",
            "APPROVAL_REQUIRED",
            "RATE_LIMITED",
            "PROVIDER_UNAVAILABLE",
            "INTERNAL",
        }:
            code = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL"
        return _error_response(
            exc.status_code,
            code,
            str(exc.detail),
            request=request,
            retryable=exc.status_code >= 500,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(
            400,
            "BAD_REQUEST",
            "Request validation failed.",
            request=request,
            details={"errors": exc.errors()},
        )

    @app.exception_handler(ProjectNotFoundError)
    async def not_found(request: Request, exc: ProjectNotFoundError) -> JSONResponse:
        return _error_response(404, "NOT_FOUND", str(exc), request=request)

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError) -> JSONResponse:
        return _error_response(400, "BAD_REQUEST", str(exc), request=request)

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": "2.0.0-preview", "apiVersion": API_VERSION}

    @app.get("/api/v1/home")
    async def home_summary() -> dict[str, Any]:
        return registry.home_summary()

    @app.get("/api/v1/projects")
    async def list_projects() -> dict[str, Any]:
        return _page(registry.list_projects(), limit=200, offset=0)

    @app.post("/api/v1/projects", status_code=201)
    async def create_project(payload: ProjectCreate) -> dict[str, Any]:
        return registry.create(payload)

    @app.post("/api/v1/projects/open")
    async def open_project(payload: ProjectOpen) -> dict[str, Any]:
        return registry.open(Path(payload.path).expanduser(), initialize=payload.initialize)

    @app.get("/api/v1/projects/{project_id}")
    async def get_project(project_id: str) -> dict[str, Any]:
        return registry.project_summary(registry.get(project_id))

    @app.get("/api/v1/projects/{project_id}/sessions")
    async def project_sessions(project_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        items = [
            registry.session_summary(
                session,
                SessionPaths(project.path / ".chainsaw" / "sessions" / session.id),
            )
            for session in registry.sessions(project_id)
        ]
        return _page(items, limit=200, offset=0)

    @app.post("/api/v1/projects/{project_id}/sessions", status_code=201)
    async def create_session(project_id: str, payload: SessionCreate) -> dict[str, Any]:
        return registry.create_session(project_id, payload)

    @app.get("/api/v1/projects/{project_id}/auth-profiles")
    async def auth_profiles(project_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        profiles = (project.settings or {}).get("authProfiles") or []
        return _page(list(profiles), limit=200, offset=0)

    @app.get("/api/v1/projects/{project_id}/scope")
    async def get_scope(project_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        scope_file = project.path / ".chainsaw" / "scope" / "scope.json"
        try:
            data = json.loads(scope_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        return {"scopeJson": data, "hash": "", "valid": bool(data)}

    @app.get("/api/v1/projects/{project_id}/app-model")
    async def app_model(
        project_id: str,
        kind: str = "",
        q: str = "",
        stale: bool = False,
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            items = model.list_entities(kind=kind or None, query=q, stale_only=stale, limit=limit, offset=offset)
            summary = model.summary()
        finally:
            model.close()
        return {
            "items": items,
            "total": summary["counts"].get(kind, sum(summary["counts"].values())) if kind else sum(summary["counts"].values()),
            "limit": limit,
            "offset": offset,
            "next": offset + len(items) if offset + len(items) < (summary["counts"].get(kind, 0) if kind else sum(summary["counts"].values())) else None,
            "summary": summary,
        }

    @app.get("/api/v1/projects/{project_id}/app-model/graph")
    async def app_model_graph(
        project_id: str,
        rootId: str = "",
        depth: int = Query(2, ge=1, le=6),
        maxNodes: int = Query(300, ge=10, le=2000),
    ) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return model.graph(root_id=rootId or None, depth=depth, max_nodes=maxNodes)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/app-model/entities/{entity_id}")
    async def app_model_entity(project_id: str, entity_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            entity = model.get(entity_id)
            if entity is None:
                raise HTTPException(404, f"NOT_FOUND: entity not found: {entity_id}")
            return {
                "entity": entity.to_dict(),
                "edges": model.edges(entity_id),
                "notes": model.notes(entity_id),
            }
        finally:
            model.close()

    @app.post("/api/v1/projects/{project_id}/app-model/entities/{entity_id}/note")
    async def app_model_note(project_id: str, entity_id: str, payload: NoteCreate) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            if model.get(entity_id) is None:
                raise HTTPException(404, f"NOT_FOUND: entity not found: {entity_id}")
            return model.add_note(entity_id, payload.content)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/routes")
    async def project_routes(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return _page(model.list_entities(kind="route", limit=1000), limit=1000, offset=0)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/inputs")
    async def project_inputs(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return _page(model.list_entities(kind="input", limit=1000), limit=1000, offset=0)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/identities")
    async def project_identities(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return _page(model.list_entities(kind="identity", limit=1000), limit=1000, offset=0)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/technologies")
    async def project_technologies(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return _page(model.list_entities(kind="technology", limit=1000), limit=1000, offset=0)
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/app-model/export")
    async def app_model_export(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return {"summary": model.summary(), "graph": model.graph(max_nodes=2000)}
        finally:
            model.close()

    @app.get("/api/v1/sessions/{session_id}")
    async def get_session(session_id: str) -> dict[str, Any]:
        _, paths, session = registry.find_session(session_id)
        return registry.session_summary(session, paths)

    @app.post("/api/v1/sessions/{session_id}/start")
    async def start_session(session_id: str) -> dict[str, Any]:
        return registry.update_session_status(session_id, "running")

    @app.post("/api/v1/sessions/{session_id}/pause")
    async def pause_session(session_id: str) -> dict[str, Any]:
        return registry.update_session_status(session_id, "paused")

    @app.post("/api/v1/sessions/{session_id}/resume")
    async def resume_session(session_id: str) -> dict[str, Any]:
        return registry.update_session_status(session_id, "running")

    @app.post("/api/v1/sessions/{session_id}/stop")
    async def stop_session(session_id: str) -> dict[str, Any]:
        return registry.update_session_status(session_id, "completed")

    @app.get("/api/v1/sessions/{session_id}/journal")
    async def journal(
        session_id: str,
        after_seq: int = Query(0, alias="afterSeq"),
        limit: int = Query(100, ge=1, le=500),
        event_type: str = Query("", alias="types"),
    ) -> dict[str, Any]:
        _, paths, _ = registry.find_session(session_id)
        try:
            events = [
                _event_dict(event)
                for event in read_journal(paths.journal_file)
                if event.seq > after_seq and (not event_type or event.type in event_type.split(","))
            ]
        except (OSError, ValueError) as exc:
            raise HTTPException(400, f"BAD_REQUEST: {exc}") from exc
        page = _page(events, limit=limit, offset=0)
        page["lastSeq"] = max((event["seq"] for event in events), default=after_seq)
        page["verified"] = verify_journal(paths.journal_file).ok
        return page

    @app.post("/api/v1/sessions/{session_id}/messages", status_code=202)
    async def post_message(session_id: str, payload: MessageCreate) -> dict[str, Any]:
        seq = registry.append_user_message(session_id, payload.content)
        return {"seq": seq, "status": "queued"}

    @app.get("/api/v1/sessions/{session_id}/tasks")
    async def tasks(session_id: str) -> dict[str, Any]:
        return _page(registry.tasks(session_id), limit=200, offset=0)

    @app.get("/api/v1/sessions/{session_id}/approvals")
    async def approvals(session_id: str) -> dict[str, Any]:
        return _page(registry.approvals(session_id), limit=200, offset=0)

    @app.post("/api/v1/sessions/{session_id}/approvals/{approval_id}/grant")
    async def grant_approval(session_id: str, approval_id: str, payload: ApprovalDecision) -> dict[str, Any]:
        return registry.resolve_approval(session_id, approval_id, granted=True, reason=payload.reason)

    @app.post("/api/v1/sessions/{session_id}/approvals/{approval_id}/deny")
    async def deny_approval(session_id: str, approval_id: str, payload: ApprovalDecision) -> dict[str, Any]:
        return registry.resolve_approval(session_id, approval_id, granted=False, reason=payload.reason)

    @app.get("/api/v1/sessions/{session_id}/evidence")
    async def evidence(session_id: str) -> dict[str, Any]:
        return _page(registry.evidence(session_id), limit=200, offset=0)

    @app.get("/api/v1/sessions/{session_id}/lanes")
    async def lanes(session_id: str) -> dict[str, Any]:
        registry.find_session(session_id)
        return _page([], limit=100, offset=0)

    @app.get("/api/v1/sessions/{session_id}/context")
    async def context(session_id: str) -> dict[str, Any]:
        packets = registry.context(session_id)
        roles = []
        for role in ("orchestrator", "recon", "operator", "validator", "reporter"):
            latest = next((item for item in packets if item.get("role") == role), None)
            if latest:
                roles.append(
                    {
                        "role": role,
                        "modelId": latest.get("modelId", ""),
                        "budgetTokens": latest.get("budgetTokens", 0),
                        "usedTokens": latest.get("usedTokens", 0),
                        "compressionRatio": latest.get("compressionRatio", 1.0),
                        "fit": latest.get("fit", True),
                        "warnings": latest.get("warnings", []),
                    }
                )
            else:
                roles.append(
                    {
                        "role": role,
                        "modelId": "",
                        "budgetTokens": 0,
                        "usedTokens": 0,
                        "compressionRatio": 1.0,
                        "fit": True,
                        "warnings": ["No context has been assembled yet."],
                    }
                )
        return {"roles": roles}

    @app.get("/api/v1/sessions/{session_id}/context/{role}")
    async def context_role(session_id: str, role: str) -> dict[str, Any]:
        packets = registry.context(session_id)
        latest = next((item for item in packets if item.get("role") == role), None)
        if latest:
            return {
                "role": role,
                "modelId": latest.get("modelId", ""),
                "budgetTokens": latest.get("budgetTokens", 0),
                "usedTokens": latest.get("usedTokens", 0),
                "fit": latest.get("fit", True),
                "sections": latest.get("sections", []),
                "warnings": latest.get("warnings", []),
            }
        return {
            "role": role,
            "modelId": "",
            "budgetTokens": 0,
            "usedTokens": 0,
            "fit": True,
            "sections": [],
            "warnings": ["No context has been assembled yet."],
        }

    @app.get("/api/v1/providers")
    async def providers() -> dict[str, Any]:
        return _page(registry.providers.list(), limit=200, offset=0)

    @app.post("/api/v1/providers", status_code=201)
    async def create_provider(payload: ProviderCreate) -> dict[str, Any]:
        return registry.providers.create(payload)

    @app.get("/api/v1/toolpacks")
    async def toolpacks() -> dict[str, Any]:
        counts = registry.toolpack_counts()
        return {
            "items": [],
            "total": counts["total"],
            "limit": 200,
            "offset": 0,
            "next": None,
            "installed": counts["installed"],
        }

    @app.get("/api/v1/workbench/history")
    async def workbench_history() -> dict[str, Any]:
        return _page([], limit=100, offset=0)

    @app.get("/api/v1/findings")
    async def findings() -> dict[str, Any]:
        return _page([], limit=100, offset=0)

    @app.get("/api/v1/reports")
    async def reports() -> dict[str, Any]:
        return _page([], limit=100, offset=0)

    @app.get("/api/v1/benchmarks")
    async def benchmarks() -> dict[str, Any]:
        return _page([], limit=100, offset=0)

    async def _stream(websocket: WebSocket) -> None:
        await websocket.accept()
        session_id = websocket.query_params.get("sessionId", "")
        try:
            after_seq = int(websocket.query_params.get("afterSeq", "0"))
        except ValueError:
            after_seq = 0
        if not session_id:
            await websocket.close(code=4400)
            return
        try:
            _, paths, _ = registry.find_session(session_id)
        except ProjectNotFoundError:
            await websocket.close(code=4404)
            return
        last_seq = after_seq
        try:
            while True:
                try:
                    events = [
                        _event_dict(event)
                        for event in read_journal(paths.journal_file)
                        if event.seq > last_seq
                    ]
                except (OSError, ValueError):
                    events = []
                for event in events:
                    await websocket.send_json(
                        {"kind": "journal", "sessionId": session_id, "event": event}
                    )
                    last_seq = event["seq"]
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            return
        except Exception:
            try:
                await websocket.close(code=1011)
            except Exception:
                pass

    @app.websocket("/api/v1/events")
    async def events(websocket: WebSocket) -> None:
        await _stream(websocket)

    @app.websocket("/api/v1/stream")
    async def stream(websocket: WebSocket) -> None:
        await _stream(websocket)

    return app


app = create_app()


def run() -> None:
    import uvicorn

    port = int(os.environ.get("CHAINSAW_API_PORT", "8765"))
    uvicorn.run("chainsaw.api.main:app", host="127.0.0.1", port=port, reload=False)
