"""Project and session filesystem model.

Global home: providers, credentials references, tool packs, index, cache.
Project: any folder with ``.chainsaw/``; durable scope + app model + reports.
Session: one run under a project; journal + artifacts + workspace.

The journal is the session's source of truth. ``session.json`` is metadata only.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .journal import JournalWriter


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable(prefix: str, *parts: str) -> str:
    payload = "\n".join(parts).encode("utf-8", errors="replace")
    return f"{prefix}_{hashlib.sha256(payload).hexdigest()[:12]}"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-")[:60] or "session"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


@dataclass(frozen=True)
class ChainsawHome:
    root: Path

    @classmethod
    def default(cls) -> ChainsawHome:
        import os

        configured = os.environ.get("CHAINSAW_HOME", "").strip()
        if configured:
            return cls(Path(configured).expanduser())
        return cls(Path.home() / ".chainsawrecon")

    @property
    def config_file(self) -> Path:
        return self.root / "config.json"

    @property
    def index_db(self) -> Path:
        return self.root / "index.db"

    @property
    def providers_dir(self) -> Path:
        return self.root / "providers"

    @property
    def tools_dir(self) -> Path:
        return self.root / "tools"

    @property
    def credentials_file(self) -> Path:
        return self.root / "credentials.json"

    def ensure(self) -> ChainsawHome:
        for path in (self.root, self.providers_dir, self.tools_dir, self.root / "logs", self.root / "cache"):
            path.mkdir(parents=True, exist_ok=True)
        if not self.config_file.exists():
            _write_json(
                self.config_file,
                {
                    "version": 2,
                    "telemetryEnabled": False,
                    "authBrowserEngine": "playwright",
                    "theme": "dark",
                },
            )
        return self


@dataclass(frozen=True)
class ProjectPaths:
    root: Path

    @property
    def chainsaw(self) -> Path:
        return self.root / ".chainsaw"

    @property
    def project_file(self) -> Path:
        return self.chainsaw / "project.json"

    @property
    def scope_dir(self) -> Path:
        return self.chainsaw / "scope"

    @property
    def scope_file(self) -> Path:
        return self.scope_dir / "scope.json"

    @property
    def knowledge_db(self) -> Path:
        return self.chainsaw / "knowledge.db"

    @property
    def sessions_dir(self) -> Path:
        return self.chainsaw / "sessions"

    @property
    def catalogs_dir(self) -> Path:
        return self.chainsaw / "catalogs"

    @property
    def reports_dir(self) -> Path:
        return self.chainsaw / "reports"


@dataclass(frozen=True)
class ProjectMeta:
    id: str
    name: str
    path: Path
    created_at: str
    updated_at: str
    targets: tuple[str, ...] = ()
    scope_status: str = "empty"
    settings: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "path": str(self.path),
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "targets": list(self.targets),
            "scopeStatus": self.scope_status,
            "settings": self.settings or {},
        }


@dataclass(frozen=True)
class SessionPaths:
    root: Path

    @property
    def session_file(self) -> Path:
        return self.root / "session.json"

    @property
    def journal_file(self) -> Path:
        return self.root / "journal.jsonl"

    @property
    def artifacts_dir(self) -> Path:
        return self.root / "artifacts"

    @property
    def workspace_dir(self) -> Path:
        return self.root / "workspace"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"


@dataclass(frozen=True)
class SessionMeta:
    id: str
    project_id: str
    title: str
    status: str
    mode: str
    provider: str
    model: str
    targets: tuple[str, ...] = ()
    created_at: str = ""
    updated_at: str = ""
    parent_session_id: str | None = None
    last_seq: int = 0
    checkpoint_seq: int | None = None
    budget: dict[str, int] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "title": self.title,
            "status": self.status,
            "mode": self.mode,
            "provider": self.provider,
            "model": self.model,
            "targets": list(self.targets),
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "parentSessionId": self.parent_session_id,
            "lastSeq": self.last_seq,
            "checkpointSeq": self.checkpoint_seq,
            "budget": self.budget or {},
        }


def init_project(
    root: Path | str,
    *,
    name: str | None = None,
    targets: Iterable[str] = (),
    scope: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
    force: bool = False,
) -> tuple[ProjectPaths, ProjectMeta]:
    paths = ProjectPaths(Path(root).expanduser().resolve())
    paths.root.mkdir(parents=True, exist_ok=True)
    if paths.project_file.exists() and not force:
        return paths, load_project(paths.root)

    for directory in (paths.scope_dir, paths.sessions_dir, paths.catalogs_dir, paths.reports_dir):
        directory.mkdir(parents=True, exist_ok=True)
    target_list = tuple(dict.fromkeys(str(item).strip() for item in targets if str(item).strip()))
    project_name = name or paths.root.name or "Untitled project"
    project_id = _stable("prj", str(paths.root))
    now = _now()
    meta = ProjectMeta(
        id=project_id,
        name=project_name,
        path=paths.root,
        created_at=now,
        updated_at=now,
        targets=target_list,
        scope_status="ok" if scope or target_list else "empty",
        settings=dict(settings or {}),
    )
    _write_json(paths.project_file, meta.to_dict())
    if not paths.scope_file.exists() or force:
        _write_json(
            paths.scope_file,
            scope
            or {
                "program_name": project_name,
                "allowed_domains": [],
                "excluded_domains": [],
                "allowed_urls": list(target_list),
                "notes": "",
                "rate_limits": {"delay_seconds": 0, "max_commands_per_minute": 0, "notes": ""},
            },
        )
    _write_text(paths.scope_dir / "in-scope.txt", "\n".join(target_list) + ("\n" if target_list else ""))
    _write_text(paths.scope_dir / "out-of-scope.txt", "")
    _write_text(paths.scope_dir / "rules.md", "# Rules\n\n")
    _write_text(paths.scope_dir / "prompt.md", "# Operator Prompt\n\n")
    return paths, meta


def load_project(root: Path | str) -> ProjectMeta:
    paths = ProjectPaths(Path(root).expanduser().resolve())
    data = _read_json(paths.project_file)
    return ProjectMeta(
        id=str(data["id"]),
        name=str(data["name"]),
        path=Path(str(data["path"])),
        created_at=str(data["createdAt"]),
        updated_at=str(data["updatedAt"]),
        targets=tuple(str(item) for item in data.get("targets", [])),
        scope_status=str(data.get("scopeStatus", "empty")),
        settings=dict(data.get("settings") or {}) or None,
    )


def update_project(root: Path | str, **changes: Any) -> ProjectMeta:
    paths = ProjectPaths(Path(root).expanduser().resolve())
    data = _read_json(paths.project_file)
    for key, value in changes.items():
        data[key] = value
    data["updatedAt"] = _now()
    _write_json(paths.project_file, data)
    return load_project(paths.root)


def create_session(
    project: Path | str,
    *,
    title: str,
    mode: str = "auto",
    provider: str = "",
    model: str = "",
    targets: Iterable[str] = (),
    session_id: str | None = None,
    budget: dict[str, int] | None = None,
) -> tuple[SessionPaths, SessionMeta]:
    project_paths = ProjectPaths(Path(project).expanduser().resolve())
    if not project_paths.project_file.exists():
        raise ValueError(f"not an initialized ChainsawRecon project: {project}")
    project_meta = load_project(project_paths.root)
    created = _now()
    identifier = session_id or _stable("ses", project_meta.id, created, title)
    paths = SessionPaths(project_paths.sessions_dir / identifier)
    if paths.session_file.exists():
        raise ValueError(f"session already exists: {identifier}")
    for directory in (paths.root, paths.artifacts_dir, paths.workspace_dir, paths.logs_dir):
        directory.mkdir(parents=True, exist_ok=True)
    meta = SessionMeta(
        id=identifier,
        project_id=project_meta.id,
        title=title,
        status="idle",
        mode=mode,
        provider=provider,
        model=model,
        targets=tuple(dict.fromkeys(str(item) for item in targets)),
        created_at=created,
        updated_at=created,
        budget=budget
        or {"modelCalls": 400, "toolCalls": 800, "wallSeconds": 7200},
    )
    _write_json(paths.session_file, meta.to_dict())
    writer = JournalWriter(paths.journal_file, identifier)
    writer.append(
        "session/created",
        {
            "projectId": project_meta.id,
            "title": title,
            "mode": mode,
            "provider": provider,
            "model": model,
            "targets": list(meta.targets),
        },
        actor="system",
    )
    return paths, meta


def load_session(session_dir: Path | str) -> SessionMeta:
    paths = SessionPaths(Path(session_dir).expanduser().resolve())
    data = _read_json(paths.session_file)
    return SessionMeta(
        id=str(data["id"]),
        project_id=str(data["projectId"]),
        title=str(data["title"]),
        status=str(data["status"]),
        mode=str(data["mode"]),
        provider=str(data.get("provider", "")),
        model=str(data.get("model", "")),
        targets=tuple(str(item) for item in data.get("targets", [])),
        created_at=str(data.get("createdAt", "")),
        updated_at=str(data.get("updatedAt", "")),
        parent_session_id=data.get("parentSessionId"),
        last_seq=int(data.get("lastSeq", 0)),
        checkpoint_seq=data.get("checkpointSeq"),
        budget=dict(data.get("budget") or {}) or None,
    )


def list_sessions(project: Path | str) -> list[SessionMeta]:
    project_paths = ProjectPaths(Path(project).expanduser().resolve())
    sessions: list[SessionMeta] = []
    if not project_paths.sessions_dir.exists():
        return sessions
    for child in sorted(project_paths.sessions_dir.iterdir()):
        if not child.is_dir() or not (child / "session.json").exists():
            continue
        try:
            sessions.append(load_session(child))
        except ValueError:
            continue
    return sessions


def update_session(session_dir: Path | str, **changes: Any) -> SessionMeta:
    paths = SessionPaths(Path(session_dir).expanduser().resolve())
    data = _read_json(paths.session_file)
    for key, value in changes.items():
        data[key] = value
    data["updatedAt"] = _now()
    _write_json(paths.session_file, data)
    return load_session(paths.root)


def _write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


__all__ = [
    "ChainsawHome",
    "ProjectMeta",
    "ProjectPaths",
    "SessionMeta",
    "SessionPaths",
    "create_session",
    "init_project",
    "list_sessions",
    "load_project",
    "load_session",
    "update_project",
    "update_session",
]
