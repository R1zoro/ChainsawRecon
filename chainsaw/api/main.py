from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..auth import (
    AuthError,
    AuthNeedsOperator,
    browser_login,
    detect_flows,
    http_login,
    verify_session,
)
from ..ca import ensure_ca
from ..journal import read_journal, verify_journal
from ..providers import (
    ProviderError,
    build_provider,
    config_from_entry,
)
from ..proxy import ProxyError, ProxyManager
from ..runner import RunConfig, Runner
from ..runtime import SessionRuntime
from ..workbench import (
    ApprovalRequired,
    FlowNotFound,
    TransportFailed,
    WorkbenchError,
    ca_status,
    compare,
    import_file,
    replay,
)
from ..workspace import (
    ChainsawHome,
    SessionPaths,
)
from .models import (
    ApprovalDecision,
    AuthLoginRequest,
    AuthProfileInput,
    CompareCreate,
    CoverageCreate,
    EvidenceCreate,
    FindingTransition,
    ImportCreate,
    MessageCreate,
    NoteCreate,
    ProjectCreate,
    ProjectOpen,
    ProviderCreate,
    ProxyStart,
    ProxyStop,
    ReplayCreate,
    SessionCreate,
    SessionRunCreate,
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
    registry = ProjectRegistry(home or ChainsawHome.default())
    proxies = ProxyManager(registry.home.root)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            proxies.stop_all()

    app = FastAPI(
        title="ChainsawRecon API",
        version="2.0.0-preview",
        lifespan=lifespan,
    )

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

    @app.post("/api/v1/projects/{project_id}/auth/detect")
    async def auth_detect(project_id: str) -> dict[str, Any]:
        store = registry.workbench(project_id)
        try:
            flows = store.raw_flows(limit=500)
        finally:
            store.close()
        return detect_flows(flows).to_dict()

    @app.get("/api/v1/projects/{project_id}/auth/profiles")
    async def auth_profile_list(project_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        store = registry.auth_session_store()
        items = []
        for profile in registry.auth_profiles(project_id):
            session = store.load(project.id, str(profile.get("id", "")))
            items.append(
                {
                    **profile,
                    "session": session.public() if session else {"status": "none"},
                }
            )
        return _page(items, limit=200, offset=0)

    @app.post("/api/v1/projects/{project_id}/auth/profiles", status_code=201)
    async def auth_profile_save(
        project_id: str, payload: AuthProfileInput
    ) -> dict[str, Any]:
        registry.get(project_id)
        item = registry.save_auth_profile(
            project_id, payload.model_dump(by_alias=False, exclude_none=True)
        )
        return item

    @app.delete("/api/v1/projects/{project_id}/auth/profiles/{profile_id}", status_code=204)
    async def auth_profile_delete(project_id: str, profile_id: str) -> None:
        registry.delete_auth_profile(project_id, profile_id)
        return None

    @app.get("/api/v1/projects/{project_id}/auth/profiles/{profile_id}/session")
    async def auth_profile_session(project_id: str, profile_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        session = registry.auth_session_store().load(project.id, profile_id)
        return session.public() if session else {"status": "none", "profileId": profile_id}

    @app.post("/api/v1/projects/{project_id}/auth/profiles/{profile_id}/login")
    async def auth_profile_login(
        project_id: str,
        profile_id: str,
        payload: AuthLoginRequest,
    ) -> dict[str, Any]:
        project = registry.get(project_id)
        _, profile = registry.find_auth_profile(profile_id)
        adapter = (payload.adapter or str(profile.get("adapter") or "auto")).lower()
        if adapter == "auto":
            adapter = "browser" if profile.get("kind") in {"oauth", "saml", "browser"} else "http_form"
        try:
            if adapter == "browser":
                session = await asyncio.to_thread(
                    browser_login,
                    profile=profile,
                    project_id=project.id,
                    home_root=registry.home.root,
                    username=payload.username,
                    password=payload.password,
                    policy=registry.scope_policy(project.id),
                    login_timeout=payload.login_timeout,
                )
            elif adapter == "http_form":
                session = await asyncio.to_thread(
                    http_login,
                    profile=profile,
                    project_id=project.id,
                    username=payload.username,
                    password=payload.password,
                    policy=registry.scope_policy(project.id),
                )
            else:
                raise HTTPException(400, f"BAD_REQUEST: unsupported auth adapter: {adapter}")
        except AuthNeedsOperator as exc:
            raise HTTPException(409, f"CONFLICT: {exc}") from exc
        except AuthError as exc:
            raise HTTPException(400, f"BAD_REQUEST: {exc}") from exc
        registry.auth_session_store().save(session)
        return session.public()

    @app.post("/api/v1/projects/{project_id}/auth/profiles/{profile_id}/verify")
    async def auth_profile_verify(project_id: str, profile_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        _, profile = registry.find_auth_profile(profile_id)
        store = registry.auth_session_store()
        session = store.load(project.id, profile_id)
        if session is None:
            raise HTTPException(404, f"NOT_FOUND: no session for auth profile {profile_id}")
        verified, reason = await asyncio.to_thread(
            verify_session,
            session,
            verify_url=str(profile.get("verifyUrl") or ""),
            indicator=str(profile.get("verifyIndicator") or ""),
            policy=registry.scope_policy(project.id),
        )
        session.status = "active" if verified else "failed"
        if verified and not session.verified_at:
            session.verified_at = datetime.now(timezone.utc).isoformat()
        session.warning = reason
        store.save(session)
        return {**session.public(), "reason": reason}

    @app.post("/api/v1/projects/{project_id}/auth/profiles/{profile_id}/logout")
    async def auth_profile_logout(project_id: str, profile_id: str) -> dict[str, Any]:
        project = registry.get(project_id)
        store = registry.auth_session_store()
        store.delete(project.id, profile_id)
        return {"profileId": profile_id, "status": "none"}

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
                "coverage": model.coverage_for(entity_id),
                "edges": model.edges(entity_id),
                "notes": model.notes(entity_id),
            }
        finally:
            model.close()

    @app.post("/api/v1/projects/{project_id}/app-model/entities/{entity_id}/coverage", status_code=201)
    async def app_model_coverage(
        project_id: str, entity_id: str, payload: CoverageCreate
    ) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            try:
                return model.record_coverage(
                    entity_id,
                    risk_area=payload.risk_area,
                    outcome=payload.outcome,
                    surface=payload.surface,
                    evidence_id=payload.evidence_id,
                    reason=payload.reason,
                    worker=payload.worker,
                )
            except KeyError as exc:
                raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
            except ValueError as exc:
                raise HTTPException(400, f"BAD_REQUEST: {exc}") from exc
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/app-model/coverage")
    async def app_model_coverage_summary(project_id: str) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return model.coverage_summary()
        finally:
            model.close()

    @app.get("/api/v1/projects/{project_id}/app-model/sitemap")
    async def app_model_sitemap(
        project_id: str,
        maxNodes: int = Query(2000, ge=10, le=10000),
    ) -> dict[str, Any]:
        model = registry.app_model(project_id)
        try:
            return model.sitemap(max_nodes=maxNodes)
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

    @app.post("/api/v1/sessions/{session_id}/run")
    async def run_session(session_id: str, payload: SessionRunCreate) -> dict[str, Any]:
        project, _, meta = registry.find_session(session_id)
        entry = registry.provider_entry(payload.provider_id or meta.provider)
        if entry is None:
            raise HTTPException(
                400,
                "BAD_REQUEST: no provider configured; add one before running a session",
            )
        model = payload.model or meta.model
        kind = str(entry.get("type") or entry.get("engine") or "").strip().lower()
        selected_model = model
        if kind in {"webui", "browser", "chatgpt-web", "deepseek-web", "web"}:
            provider = build_provider(entry, model=model)
            selected_model = model or str(entry.get("model") or entry.get("engine") or "webui")
        else:
            try:
                provider_config = config_from_entry(entry, model=model)
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, f"BAD_REQUEST: invalid provider config: {exc}") from exc
            if not provider_config.base_url:
                raise HTTPException(400, "BAD_REQUEST: provider has no base URL")
            provider = build_provider(entry, model=model)
            selected_model = model or provider_config.model
        runtime = SessionRuntime(project.path, session_id)
        store = registry.workbench(project.id)
        try:
            runner = Runner(
                runtime,
                store=store,
                policy=registry.scope_policy(project.id),
                provider=provider,
                model=selected_model,
                config=RunConfig(
                    max_steps=payload.max_steps,
                    context_window=payload.context_window,
                    max_output_tokens=payload.max_output_tokens,
                    noise_profile=payload.noise_profile,
                ),
            )
            registry.update_session_status(session_id, "running")
            try:
                result = await asyncio.to_thread(runner.run)
            except Exception:
                registry.update_session_status(session_id, "paused")
                raise
        finally:
            store.close()
            runtime.close()
            close = getattr(provider, "close", None)
            if callable(close):
                close()
        registry.update_session_status(
            session_id,
            "completed" if result.finished else "paused",
        )
        return {
            **result.to_dict(),
            "sessionId": session_id,
            "model": selected_model,
        }

    @app.get("/api/v1/providers/{provider_id}/health")
    async def provider_health(provider_id: str) -> dict[str, Any]:
        entry = registry.provider_entry(provider_id)
        if entry is None:
            raise HTTPException(404, f"NOT_FOUND: provider not found: {provider_id}")
        provider = build_provider(entry)
        try:
            result = await asyncio.to_thread(provider.health)
        except ProviderError as exc:
            raise HTTPException(502, f"INTERNAL: {exc}") from exc
        finally:
            close = getattr(provider, "close", None)
            if callable(close):
                close()
        return result

    @app.post("/api/v1/providers/{provider_id}/calibrate")
    async def provider_calibrate(provider_id: str) -> dict[str, Any]:
        entry = registry.provider_entry(provider_id)
        if entry is None:
            raise HTTPException(404, f"NOT_FOUND: provider not found: {provider_id}")
        provider = build_provider(entry)
        calibrate = getattr(provider, "calibrate", None)
        if not callable(calibrate):
            raise HTTPException(400, "BAD_REQUEST: provider does not support calibration")
        try:
            return await asyncio.to_thread(calibrate)
        except ProviderError as exc:
            raise HTTPException(502, f"INTERNAL: {exc}") from exc
        finally:
            close = getattr(provider, "close", None)
            if callable(close):
                close()

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
    async def workbench_history(
        projectId: str = Query(""),
        q: str = "",
        host: str = "",
        method: str = "",
        status: str = "",
        contentType: str = "",
        auth: str = "",
        tag: str = "",
        inScopeOnly: bool = False,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        if not projectId:
            raise HTTPException(400, "BAD_REQUEST: projectId is required")
        store = registry.workbench(projectId)
        try:
            items, total = store.list_flows(
                q=q,
                host=host,
                method=method,
                status=status,
                content_type=contentType,
                auth=auth,
                tag=tag,
                in_scope_only=inScopeOnly,
                limit=limit,
                offset=offset,
            )
        finally:
            store.close()
        next_offset = offset + len(items)
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "next": next_offset if next_offset < total else None,
        }

    @app.get("/api/v1/workbench/requests/{request_id}")
    async def workbench_request(request_id: str) -> dict[str, Any]:
        try:
            _, store = registry.find_flow(request_id)
        except FlowNotFound as exc:
            raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        try:
            return store.require_flow(request_id).detail()
        finally:
            store.close()

    @app.post("/api/v1/workbench/replay")
    async def workbench_replay(payload: ReplayCreate) -> dict[str, Any]:
        try:
            project, store = registry.find_flow(payload.request_id)
        except FlowNotFound as exc:
            if not payload.project_id:
                raise HTTPException(
                    404,
                    f"NOT_FOUND: {exc}; scratch requests require projectId, url, and method",
                ) from exc
            project = registry.get(payload.project_id)
            store = registry.workbench(payload.project_id)
        try:
            policy = registry.scope_policy(project.id)
            patch = payload.patch.model_dump(exclude_none=True, by_alias=True)
            auth_headers: dict[str, str] = {}
            auth_cookies: dict[str, str] = {}
            if payload.auth_profile_id:
                session = registry.auth_session_store().load(
                    project.id, payload.auth_profile_id
                )
                if session is None:
                    raise HTTPException(
                        400,
                        f"BAD_REQUEST: no active session for auth profile {payload.auth_profile_id}",
                    )
                auth_headers = session.headers
                auth_cookies = session.cookies
            try:
                return replay(
                    store,
                    payload.request_id,
                    patch=patch,
                    policy=policy,
                    justification=payload.justification,
                    auth_headers=auth_headers,
                    auth_cookies=auth_cookies,
                )
            except ApprovalRequired as exc:
                raise HTTPException(403, f"APPROVAL_REQUIRED: {exc}") from exc
            except TransportFailed as exc:
                raise HTTPException(502, f"INTERNAL: {exc}") from exc
        finally:
            store.close()

    @app.post("/api/v1/workbench/compare")
    async def workbench_compare(payload: CompareCreate) -> dict[str, Any]:
        try:
            _, store = registry.find_flow(payload.baseline_id)
        except FlowNotFound as exc:
            raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        try:
            try:
                return compare(store, payload.baseline_id, payload.candidate_id)
            except FlowNotFound as exc:
                raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        finally:
            store.close()

    @app.post("/api/v1/workbench/evidence", status_code=201)
    async def workbench_evidence(payload: EvidenceCreate) -> dict[str, Any]:
        try:
            project, store = registry.find_flow(payload.request_id)
        except FlowNotFound as exc:
            raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        try:
            if payload.session_id:
                session_project, _, _ = registry.find_session(payload.session_id)
                if session_project.id != project.id:
                    raise HTTPException(
                        400,
                        "BAD_REQUEST: sessionId does not belong to the request's project",
                    )
            evidence = store.record_evidence(
                request_id=payload.request_id,
                response_id=payload.response_id,
                hypothesis_id=payload.hypothesis_id,
                task_id=payload.task_id,
                note=payload.note,
                session_id=payload.session_id,
                artifact_dir=project.path / ".chainsaw" / "artifacts",
            )
        finally:
            store.close()
        if payload.session_id:
            registry.record_evidence_event(payload.session_id, evidence)
        return evidence

    @app.post("/api/v1/workbench/import", status_code=202)
    async def workbench_import(payload: ImportCreate) -> dict[str, Any]:
        if not payload.project_id:
            raise HTTPException(400, "BAD_REQUEST: projectId is required")
        project = registry.get(payload.project_id)
        store = registry.workbench(payload.project_id)
        try:
            try:
                return import_file(
                    store,
                    fmt=payload.format,
                    path=Path(payload.path).expanduser(),
                    policy=registry.scope_policy(project.id),
                )
            except WorkbenchError as exc:
                raise HTTPException(400, f"BAD_REQUEST: {exc}") from exc
        finally:
            store.close()

    @app.get("/api/v1/workbench/export")
    async def workbench_export(
        projectId: str = Query(""),
        format: str = Query("har"),
    ) -> dict[str, Any]:
        if not projectId:
            raise HTTPException(400, "BAD_REQUEST: projectId is required")
        if format not in {"har", "jsonl"}:
            raise HTTPException(400, f"BAD_REQUEST: unsupported export format: {format}")
        store = registry.workbench(projectId)
        try:
            data: Any = store.export_har() if format == "har" else store.export_jsonl()
        finally:
            store.close()
        return {"format": format, "data": data}

    @app.get("/api/v1/workbench/ca")
    async def workbench_ca() -> dict[str, Any]:
        return ca_status(registry.home.root)

    @app.post("/api/v1/workbench/ca", status_code=201)
    async def workbench_ca_create() -> dict[str, Any]:
        ensure_ca(registry.home.root)
        return ca_status(registry.home.root)

    @app.post("/api/v1/workbench/proxy/start")
    async def workbench_proxy_start(payload: ProxyStart) -> dict[str, Any]:
        project = registry.get(payload.project_id)
        try:
            return proxies.start(
                project_path=project.path,
                project_id=project.id,
                policy=registry.scope_policy(project.id),
                host=payload.host,
                port=payload.port,
                verify_upstream=payload.verify_upstream,
                noise_profile=payload.noise_profile,
            )
        except (OSError, ProxyError) as exc:
            raise HTTPException(400, f"BAD_REQUEST: cannot start proxy: {exc}") from exc

    @app.post("/api/v1/workbench/proxy/stop")
    async def workbench_proxy_stop(payload: ProxyStop) -> dict[str, Any]:
        registry.get(payload.project_id)
        return proxies.stop(payload.project_id)

    @app.get("/api/v1/workbench/proxy/status")
    async def workbench_proxy_status(projectId: str = Query("")) -> dict[str, Any]:
        if not projectId:
            raise HTTPException(400, "BAD_REQUEST: projectId is required")
        registry.get(projectId)
        return proxies.status(projectId)

    @app.get("/api/v1/findings")
    async def findings(
        projectId: str = Query(""),
        sessionId: str = Query(""),
        state: str = "",
        severity: str = "",
        q: str = "",
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        items = registry.findings(
            project_id=projectId,
            session_id=sessionId,
            state=state,
            severity=severity,
            query=q,
        )
        page = _page(items, limit=limit, offset=offset)
        return page

    @app.get("/api/v1/findings/{finding_id}")
    async def finding_detail(finding_id: str) -> dict[str, Any]:
        try:
            project, meta, finding = registry.find_finding(finding_id)
        except ProjectNotFoundError as exc:
            raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        evidence_ids = set(finding.get("evidenceIds") or [])
        return {
            "finding": {
                **finding,
                "projectId": project.id,
                "sessionId": meta.id,
            },
            "evidence": [
                item for item in registry.evidence(meta.id) if item["id"] in evidence_ids
            ],
        }

    @app.post("/api/v1/findings/{finding_id}/transition")
    async def finding_transition(
        finding_id: str, payload: FindingTransition
    ) -> dict[str, Any]:
        try:
            return registry.transition_finding(
                finding_id,
                state=payload.state,
                reason=payload.reason,
                evidence_ids=payload.evidence_ids,
            )
        except ProjectNotFoundError as exc:
            raise HTTPException(404, f"NOT_FOUND: {exc}") from exc
        except ValueError as exc:
            raise HTTPException(400, f"BAD_REQUEST: {exc}") from exc

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
