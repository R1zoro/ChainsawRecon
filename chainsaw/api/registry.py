from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..appmodel import AppModel
from ..auth import AuthSessionStore
from ..journal import JournalWriter, read_journal
from ..projection import SessionProjection
from ..workbench import FlowNotFound, ScopePolicy, WorkbenchStore
from ..workspace import (
    ChainsawHome,
    ProjectMeta,
    SessionMeta,
    SessionPaths,
    create_session,
    init_project,
    list_sessions,
    load_project,
    update_project,
    update_session,
)
from .models import ProjectCreate, ProviderCreate


class ProjectNotFoundError(FileNotFoundError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProviderStore:
    def __init__(self, home: ChainsawHome) -> None:
        self.home = home
        self.path = home.root / "providers.json"

    def list(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict) and isinstance(data.get("providers"), list):
            return [item for item in data["providers"] if isinstance(item, dict)]
        return []

    def create(self, payload: ProviderCreate) -> dict[str, Any]:
        providers = self.list()
        provider_id = "prv_" + payload.name.lower().replace(" ", "-")[:24]
        item = {
            "id": provider_id,
            **payload.model_dump(by_alias=True),
            "lastCheckedAt": _now(),
        }
        providers = [existing for existing in providers if existing.get("id") != provider_id]
        providers.append(item)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(providers, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return item

    def counts(self) -> dict[str, int]:
        counts = {"healthy": 0, "degraded": 0, "unavailable": 0}
        for provider in self.list():
            status = str(provider.get("status", "unknown"))
            if status == "healthy":
                counts["healthy"] += 1
            elif status == "degraded":
                counts["degraded"] += 1
            elif status in {"unavailable", "unconfigured", "unknown"}:
                counts["unavailable"] += 1
        return counts


class ProjectRegistry:
    """Small metadata index over project folders.

    The index stores paths, not evidence or secrets. Each project remains the
    source of truth for its own scope/settings.
    """

    def __init__(self, home: ChainsawHome) -> None:
        self.home = home.ensure()
        self.index_file = self.home.root / "projects.json"
        self.providers = ProviderStore(self.home)

    def _load_index(self) -> list[dict[str, Any]]:
        if not self.index_file.exists():
            return []
        try:
            data = json.loads(self.index_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def _save_index(self, items: Iterable[dict[str, Any]]) -> None:
        self.index_file.parent.mkdir(parents=True, exist_ok=True)
        self.index_file.write_text(
            json.dumps(list(items), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def register(self, meta: ProjectMeta) -> None:
        items = self._load_index()
        entry = {"id": meta.id, "path": str(meta.path), "lastOpenedAt": _now()}
        items = [item for item in items if item.get("id") != meta.id and item.get("path") != str(meta.path)]
        items.append(entry)
        self._save_index(items)

    def list_projects(self) -> list[dict[str, Any]]:
        items = self._load_index()
        changed = False
        summaries: list[dict[str, Any]] = []
        for item in items:
            path = Path(str(item.get("path", "")))
            try:
                meta = load_project(path)
            except (OSError, ValueError):
                changed = True
                continue
            summaries.append(self.project_summary(meta))
        if changed:
            self._save_index(
                [item for item in items if Path(str(item.get("path", ""))).joinpath(".chainsaw", "project.json").exists()]
            )
        summaries.sort(key=lambda item: str(item.get("lastOpenedAt", "")), reverse=True)
        return summaries

    def get(self, project_id: str) -> ProjectMeta:
        for item in self._load_index():
            if item.get("id") == project_id:
                return load_project(Path(str(item["path"])))
        raise ProjectNotFoundError(f"project not found: {project_id}")

    def create(self, payload: ProjectCreate) -> dict[str, Any]:
        scope = payload.scope.model_dump(by_alias=False) if payload.scope else None
        settings = {
            "authProfiles": [profile.model_dump(by_alias=True) for profile in payload.auth_profiles],
            "roles": dict(payload.roles),
            "phases": list(payload.phases),
            "rawScope": payload.raw_scope,
        }
        path = Path(payload.path).expanduser()
        if (path / ".chainsaw" / "project.json").exists():
            raise ValueError("project already exists; use POST /projects/open")
        _, meta = init_project(
            path,
            name=payload.name,
            targets=payload.targets,
            scope=scope,
            settings=settings,
        )
        self.register(meta)
        self._seed_app_model(meta)
        return self.project_summary(meta)

    def open(self, path: Path, *, initialize: bool = False) -> dict[str, Any]:
        project_file = path / ".chainsaw" / "project.json"
        if not project_file.exists():
            if not initialize:
                raise ProjectNotFoundError(
                    f"{path} is not a ChainsawRecon project; initialize it first"
                )
            _, meta = init_project(path, name=path.name)
        else:
            meta = load_project(path)
        self.register(meta)
        self._seed_app_model(meta)
        return self.project_summary(meta)

    def _seed_app_model(self, meta: ProjectMeta) -> None:
        model = AppModel(meta.path / ".chainsaw" / "knowledge.db", meta.id)
        try:
            model.seed_targets(meta.name, meta.targets)
        finally:
            model.close()

    def app_model(self, project_id: str) -> AppModel:
        project = self.get(project_id)
        return AppModel(project.path / ".chainsaw" / "knowledge.db", project.id)

    def workbench(self, project_id: str) -> WorkbenchStore:
        project = self.get(project_id)
        return WorkbenchStore(project.path / ".chainsaw" / "workbench.db", project.id)

    def scope_policy(self, project_id: str) -> ScopePolicy:
        project = self.get(project_id)
        return ScopePolicy.from_project(project.path)

    def workbench_artifact_dir(self, project_id: str) -> Path:
        project = self.get(project_id)
        path = project.path / ".chainsaw" / "artifacts"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def find_flow(self, flow_id: str) -> tuple[ProjectMeta, WorkbenchStore]:
        for summary in self.list_projects():
            project = self.get(str(summary["id"]))
            store = WorkbenchStore(project.path / ".chainsaw" / "workbench.db", project.id)
            if store.get_flow(flow_id) is not None:
                return project, store
            store.close()
        raise FlowNotFound(flow_id)

    def record_evidence_event(self, session_id: str, evidence: dict[str, Any]) -> None:
        """Mirror a workbench evidence row into the session journal/projection."""

        _, paths, _ = self.find_session(session_id)
        writer = JournalWriter(paths.journal_file, session_id)
        writer.append(
            "evidence/recorded",
            {
                "kind": evidence.get("kind", "http_pair"),
                "summary": evidence.get("summary", ""),
                "artifactId": evidence.get("artifactId", ""),
                "hash": evidence.get("hash", ""),
                "taskId": evidence.get("taskId") or None,
                "hypothesisId": evidence.get("hypothesisId") or None,
                "requestId": evidence.get("requestId") or None,
                "responseId": evidence.get("responseId") or None,
            },
            actor="tool",
            refs={
                "evidence_id": str(evidence["id"]),
                "task_id": str(evidence.get("taskId") or ""),
                "hypothesis_id": str(evidence.get("hypothesisId") or ""),
            },
        )
        projection = SessionProjection(paths.root / "state.db", session_id)
        try:
            projection.sync(paths.journal_file)
        finally:
            projection.close()

    def sessions(self, project_id: str) -> list[SessionMeta]:
        project = self.get(project_id)
        return list_sessions(project.path)

    def find_session(self, session_id: str) -> tuple[ProjectMeta, SessionPaths, SessionMeta]:
        for summary in self.list_projects():
            project = self.get(str(summary["id"]))
            for session in list_sessions(project.path):
                if session.id == session_id:
                    paths = SessionPaths(project.path / ".chainsaw" / "sessions" / session.id)
                    return project, paths, session
        raise ProjectNotFoundError(f"session not found: {session_id}")

    def create_session(self, project_id: str, payload: Any) -> dict[str, Any]:
        project = self.get(project_id)
        paths, meta = create_session(
            project.path,
            title=payload.title,
            mode=payload.mode,
            provider=payload.provider,
            model=payload.model,
            targets=payload.targets,
        )
        return self.session_summary(meta, paths)

    def provider_entry(self, provider_id: str = "") -> dict[str, Any] | None:
        for entry in self.providers.list():
            if not provider_id:
                return entry
            if provider_id in {
                str(entry.get("id", "")),
                str(entry.get("name", "")),
            }:
                return entry
        return None

    def auth_session_store(self) -> AuthSessionStore:
        return AuthSessionStore(self.home.root)

    def auth_profiles(self, project_id: str) -> list[dict[str, Any]]:
        project = self.get(project_id)
        return [
            dict(item)
            for item in ((project.settings or {}).get("authProfiles") or [])
            if isinstance(item, dict)
        ]

    def save_auth_profile(self, project_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        project = self.get(project_id)
        settings = dict(project.settings or {})
        profiles = [
            dict(item)
            for item in (settings.get("authProfiles") or [])
            if isinstance(item, dict)
        ]
        item = dict(profile)
        if not item.get("id"):
            item["id"] = "prf_" + uuid.uuid4().hex[:12]
        item.setdefault("persistence", "session_only")
        item.setdefault("kind", "form")
        profiles = [entry for entry in profiles if entry.get("id") != item["id"]]
        profiles.append(item)
        settings["authProfiles"] = profiles
        update_project(project.path, settings=settings)
        return item

    def delete_auth_profile(self, project_id: str, profile_id: str) -> bool:
        project = self.get(project_id)
        settings = dict(project.settings or {})
        profiles = [
            dict(item)
            for item in (settings.get("authProfiles") or [])
            if isinstance(item, dict) and item.get("id") != profile_id
        ]
        settings["authProfiles"] = profiles
        update_project(project.path, settings=settings)
        store = self.auth_session_store()
        store.delete(project.id, profile_id)
        return True

    def find_auth_profile(
        self, profile_id: str
    ) -> tuple[ProjectMeta, dict[str, Any]]:
        for summary in self.list_projects():
            project = self.get(str(summary["id"]))
            for profile in (project.settings or {}).get("authProfiles") or []:
                if isinstance(profile, dict) and profile.get("id") == profile_id:
                    return project, dict(profile)
        raise ProjectNotFoundError(f"auth profile not found: {profile_id}")

    def project_summary(self, meta: ProjectMeta) -> dict[str, Any]:
        sessions = list_sessions(meta.path)
        active = next(
            (item for item in sessions if item.status in {"running", "paused", "blocked"}),
            None,
        )
        settings = meta.settings or {}
        auth_profiles = settings.get("authProfiles") or []
        model = AppModel(meta.path / ".chainsaw" / "knowledge.db", meta.id)
        try:
            model_summary = model.summary()
        finally:
            model.close()
        counts = model_summary.get("counts", {})
        return {
            "id": meta.id,
            "name": meta.name,
            "path": str(meta.path),
            "createdAt": meta.created_at,
            "lastOpenedAt": meta.updated_at,
            "scopeStatus": meta.scope_status,
            "scopeHash": "",
            "targets": list(meta.targets),
            "sessionCount": len(sessions),
            "openFindings": 0,
            "coverage": {
                "applications": counts.get("application", 0),
                "services": counts.get("service", 0),
                "routes": counts.get("route", 0),
                "inputs": counts.get("input", 0),
                "identities": counts.get("identity", len(auth_profiles)),
                "staleAssets": model_summary.get("staleAssets", 0),
            },
            "activeSession": self.session_summary(active, SessionPaths(meta.path / ".chainsaw" / "sessions" / active.id)) if active else None,
            "tags": [],
            "settings": settings,
        }

    def session_summary(self, meta: SessionMeta, paths: SessionPaths) -> dict[str, Any]:
        last_event = None
        last_seq = meta.last_seq
        try:
            for event in read_journal(paths.journal_file):
                last_event = event
                last_seq = event.seq
        except (OSError, ValueError):
            pass
        return {
            "id": meta.id,
            "projectId": meta.project_id,
            "title": meta.title,
            "status": meta.status,
            "mode": meta.mode,
            "provider": meta.provider,
            "model": meta.model,
            "targets": list(meta.targets),
            "createdAt": meta.created_at,
            "updatedAt": meta.updated_at,
            "elapsedSeconds": 0,
            "budget": {
                **(meta.budget or {"modelCalls": 400, "toolCalls": 800, "wallSeconds": 7200}),
                "used": {"modelCalls": 0, "toolCalls": 0, "wallSeconds": 0},
            },
            "parentSessionId": meta.parent_session_id,
            "lastSeq": last_seq,
            "checkpointSeq": meta.checkpoint_seq,
            "lastEventSummary": last_event.type if last_event else "No events yet",
            "lastEventAt": last_event.ts if last_event else meta.created_at,
        }

    def home_summary(self) -> dict[str, Any]:
        projects = self.list_projects()
        sessions = []
        for summary in projects:
            try:
                sessions.extend(self.sessions(str(summary["id"])))
            except (OSError, ValueError):
                continue
        sessions.sort(key=lambda item: item.updated_at, reverse=True)
        recent_activity = [
            {
                "id": f"evt_{item.id}",
                "projectId": item.project_id,
                "projectName": next(
                    (project["name"] for project in projects if project["id"] == item.project_id),
                    "Project",
                ),
                "summary": f"{item.title} — {item.status}",
                "ts": item.updated_at,
                "kind": "session",
            }
            for item in sessions[:6]
        ]
        auth_total = sum(
            len((project.get("settings") or {}).get("authProfiles") or [])
            for project in projects
        )
        return {
            "recentProjects": projects,
            "recentActivity": recent_activity,
            "activeSession": next(
                (
                    project["activeSession"]
                    for project in projects
                    if project.get("activeSession")
                ),
                None,
            ),
            "environment": {
                "providers": self.providers.counts(),
                "toolPacks": self.toolpack_counts(),
                "authProfiles": {"active": auth_total, "expired": 0},
                "sandbox": "native",
                "warnings": (
                    ["No model provider configured. Add one in Models."]
                    if sum(self.providers.counts().values()) == 0
                    else []
                ),
            },
            "globalSettings": {
                "theme": "dark",
                "density": "comfortable",
                "telemetryEnabled": False,
                "authBrowserEngine": "playwright",
            },
        }

    def toolpack_counts(self) -> dict[str, int]:
        if not self.home.tools_dir.exists():
            return {"installed": 0, "total": 0}
        installed = sum(1 for _ in self.home.tools_dir.rglob("installed.json"))
        packs = {path.parent.parent.name for path in self.home.tools_dir.rglob("installed.json")}
        return {"installed": installed, "total": len(packs) or installed}

    def update_session_status(self, session_id: str, status: str) -> dict[str, Any]:
        _, paths, meta = self.find_session(session_id)
        updated = update_session(paths.root, status=status)
        return self.session_summary(updated, paths)

    def projection(self, session_id: str) -> SessionProjection:
        _, paths, _ = self.find_session(session_id)
        projection = SessionProjection(paths.root / "state.db", session_id)
        projection.sync(paths.journal_file)
        return projection

    def tasks(self, session_id: str) -> list[dict[str, Any]]:
        projection = self.projection(session_id)
        try:
            return projection.tasks()
        finally:
            projection.close()

    def approvals(self, session_id: str) -> list[dict[str, Any]]:
        projection = self.projection(session_id)
        try:
            return projection.approvals()
        finally:
            projection.close()

    def evidence(self, session_id: str) -> list[dict[str, Any]]:
        projection = self.projection(session_id)
        try:
            return projection.evidence()
        finally:
            projection.close()

    def findings(
        self,
        *,
        project_id: str = "",
        session_id: str = "",
        state: str = "",
        severity: str = "",
        query: str = "",
    ) -> list[dict[str, Any]]:
        sessions: list[tuple[ProjectMeta, SessionMeta]] = []
        if session_id:
            project, _, meta = self.find_session(session_id)
            sessions.append((project, meta))
        else:
            for summary in self.list_projects():
                project = self.get(str(summary["id"]))
                if project_id and project.id != project_id:
                    continue
                sessions.extend((project, meta) for meta in list_sessions(project.path))
        items: list[dict[str, Any]] = []
        needle = query.lower()
        for project, meta in sessions:
            projection = SessionProjection(
                project.path / ".chainsaw" / "sessions" / meta.id / "state.db",
                meta.id,
            )
            try:
                projection.sync(project.path / ".chainsaw" / "sessions" / meta.id / "journal.jsonl")
                for item in projection.findings():
                    if state and item.get("state") != state:
                        continue
                    if severity and item.get("severity") != severity:
                        continue
                    if needle and not any(
                        needle in str(item.get(key, "")).lower()
                        for key in ("title", "asset", "severity", "state")
                    ):
                        continue
                    items.append(
                        {
                            **item,
                            "projectId": project.id,
                            "sessionId": meta.id,
                        }
                    )
            finally:
                projection.close()
        items.sort(key=lambda item: str(item.get("updatedAt", "")), reverse=True)
        return items

    def find_finding(
        self, finding_id: str
    ) -> tuple[ProjectMeta, SessionMeta, dict[str, Any]]:
        for summary in self.list_projects():
            project = self.get(str(summary["id"]))
            for meta in list_sessions(project.path):
                paths = SessionPaths(project.path / ".chainsaw" / "sessions" / meta.id)
                projection = SessionProjection(paths.root / "state.db", meta.id)
                try:
                    projection.sync(paths.journal_file)
                    match = next(
                        (item for item in projection.findings() if item["id"] == finding_id),
                        None,
                    )
                finally:
                    projection.close()
                if match is not None:
                    return project, meta, match
        raise ProjectNotFoundError(f"finding not found: {finding_id}")

    def transition_finding(
        self,
        finding_id: str,
        *,
        state: str,
        reason: str,
        evidence_ids: list[str],
    ) -> dict[str, Any]:
        if state not in {"candidate", "validated", "rejected"}:
            raise ValueError("finding state must be candidate, validated, or rejected")
        project, meta, finding = self.find_finding(finding_id)
        current = str(finding.get("state", "candidate"))
        allowed = {
            "candidate": {"validated", "rejected"},
            "validated": {"rejected"},
            "rejected": {"candidate"},
        }
        if state == current:
            return {**finding, "projectId": project.id, "sessionId": meta.id}
        if state not in allowed.get(current, set()):
            raise ValueError(f"invalid finding transition: {current} -> {state}")
        linked = evidence_ids or list(finding.get("evidenceIds") or [])
        if state == "validated":
            known = {item["id"] for item in self.evidence(meta.id)}
            if not (set(linked) & known):
                raise ValueError(
                    "a validated finding requires at least one recorded evidence id"
                )
        paths = SessionPaths(project.path / ".chainsaw" / "sessions" / meta.id)
        writer = JournalWriter(paths.journal_file, meta.id)
        writer.append(
            f"finding/{state}",
            {
                "title": finding.get("title", ""),
                "severity": finding.get("severity", ""),
                "state": state,
                "asset": finding.get("asset", ""),
                "evidenceIds": linked,
                "reason": reason,
            },
            actor="operator",
            refs={
                "finding_id": finding_id,
                "hypothesis_id": str(finding.get("hypothesisId") or ""),
                **({"evidence_id": linked[0]} if linked else {}),
            },
        )
        projection = SessionProjection(paths.root / "state.db", meta.id)
        try:
            projection.sync(paths.journal_file)
            updated = next(
                (item for item in projection.findings() if item["id"] == finding_id),
                {**finding, "state": state},
            )
        finally:
            projection.close()
        return {**updated, "projectId": project.id, "sessionId": meta.id}

    def context(self, session_id: str) -> list[dict[str, Any]]:
        projection = self.projection(session_id)
        try:
            return projection.context()
        finally:
            projection.close()

    def append_user_message(self, session_id: str, content: str) -> int:
        _, paths, _ = self.find_session(session_id)
        writer = JournalWriter(paths.journal_file, session_id)
        event = writer.append("message/user", {"content": content}, actor="operator")
        update_session(paths.root, lastSeq=event.seq)
        projection = SessionProjection(paths.root / "state.db", session_id)
        try:
            projection.sync(paths.journal_file)
        finally:
            projection.close()
        return event.seq

    def resolve_approval(
        self,
        session_id: str,
        approval_id: str,
        *,
        granted: bool,
        reason: str = "",
    ) -> dict[str, Any]:
        _, paths, _ = self.find_session(session_id)
        writer = JournalWriter(paths.journal_file, session_id)
        event_type = "approval/granted" if granted else "approval/denied"
        writer.append(
            event_type,
            {"reason": reason},
            actor="operator",
            refs={"approval_id": approval_id},
        )
        projection = SessionProjection(paths.root / "state.db", session_id)
        try:
            projection.sync(paths.journal_file)
            approvals = projection.approvals()
        finally:
            projection.close()
        match = next((item for item in approvals if item["id"] == approval_id), None)
        if match is None:
            raise ProjectNotFoundError(f"approval not found: {approval_id}")
        return match
