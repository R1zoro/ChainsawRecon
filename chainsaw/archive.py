"""Project archive/export.

An archive is a portable snapshot of the engagement's `.chainsaw` state. It is
not a restore operation; restore is intentionally a separate, explicit action.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .workspace import ProjectMeta


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _backup_sqlite(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    source_conn = sqlite3.connect(str(source))
    target_conn = sqlite3.connect(str(target))
    try:
        source_conn.backup(target_conn)
    finally:
        target_conn.close()
        source_conn.close()


def _iter_project_files(
    project: ProjectMeta, *, include_workspace: bool
) -> Iterable[tuple[Path, str]]:
    chainsaw = project.path / ".chainsaw"
    allowed = [
        chainsaw / "project.json",
        chainsaw / "scope",
        chainsaw / "knowledge.db",
        chainsaw / "workbench.db",
        chainsaw / "artifacts",
        chainsaw / "reports",
    ]
    for item in allowed:
        if not item.exists():
            continue
        if item.is_file():
            yield item, item.relative_to(project.path).as_posix()
        else:
            for child in item.rglob("*"):
                if child.is_file():
                    yield child, child.relative_to(project.path).as_posix()
    sessions = chainsaw / "sessions"
    if sessions.exists():
        for session_dir in sorted(sessions.iterdir()):
            if not session_dir.is_dir():
                continue
            for name in ("session.json", "journal.jsonl", "state.db", "artifacts", "workspace"):
                item = session_dir / name
                if not item.exists():
                    continue
                if name == "workspace" and not include_workspace:
                    continue
                if item.is_file():
                    yield item, item.relative_to(project.path).as_posix()
                else:
                    for child in item.rglob("*"):
                        if child.is_file():
                            yield child, child.relative_to(project.path).as_posix()


def create_archive(
    project: ProjectMeta,
    *,
    include_workspace: bool = False,
) -> dict[str, Any]:
    archives = project.path / ".chainsaw" / "archives"
    archives.mkdir(parents=True, exist_ok=True)
    name = f"archive-{_stamp()}.zip"
    path = archives / name
    manifest: list[dict[str, Any]] = []
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source, arcname in _iter_project_files(
            project, include_workspace=include_workspace
        ):
            if source.name in {"knowledge.db-wal", "workbench.db-wal"}:
                continue
            if source.suffix == ".db":
                temporary = archives / (source.name + ".snapshot")
                try:
                    _backup_sqlite(source, temporary)
                    archive.write(temporary, arcname)
                    manifest.append(
                        {
                            "path": arcname,
                            "size": temporary.stat().st_size,
                            "sha256": hashlib.sha256(temporary.read_bytes()).hexdigest(),
                        }
                    )
                finally:
                    temporary.unlink(missing_ok=True)
            else:
                archive.write(source, arcname)
                manifest.append(
                    {
                        "path": arcname,
                        "size": source.stat().st_size,
                        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    }
                )
        meta = {
            "projectId": project.id,
            "projectName": project.name,
            "createdAt": _now(),
            "includeWorkspace": include_workspace,
            "files": manifest,
        }
        archive.writestr(
            ".chainsaw/archive-manifest.json",
            json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        )
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "projectId": project.id,
        "name": name,
        "path": str(path),
        "sizeBytes": path.stat().st_size,
        "sha256": "sha256:" + digest,
        "createdAt": _now(),
        "includeWorkspace": include_workspace,
        "fileCount": len(manifest),
    }


def list_archives(project: ProjectMeta) -> list[dict[str, Any]]:
    archives = project.path / ".chainsaw" / "archives"
    if not archives.exists():
        return []
    items = []
    for path in sorted(archives.glob("archive-*.zip"), reverse=True):
        items.append(
            {
                "name": path.name,
                "path": str(path),
                "sizeBytes": path.stat().st_size,
                "createdAt": datetime.fromtimestamp(
                    path.stat().st_mtime, timezone.utc
                ).isoformat(),
            }
        )
    return items
