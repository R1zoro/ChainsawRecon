from __future__ import annotations

"""Durable, model-addressable evidence artifacts.

Raw output belongs on disk.  The model receives compact manifests and asks for
targeted slices, which prevents both evidence loss and context-window bloat.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any


@dataclass(frozen=True)
class ArtifactRecord:
    artifact_id: str
    kind: str
    path: str
    created_at: str
    size_bytes: int
    line_count: int
    sha256: str
    summary: str
    source: str
    meta: dict[str, Any]


class ArtifactStore:
    """Stores complete evidence under a run workspace and exposes safe views."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.root = self.workspace / "artifacts"
        self.raw_root = self.root / "raw"
        self.manifest_root = self.root / "manifests"
        self.raw_root.mkdir(parents=True, exist_ok=True)
        self.manifest_root.mkdir(parents=True, exist_ok=True)

    def capture_text(self, kind: str, content: str, *, source: str, summary: str = "",
                     meta: dict[str, Any] | None = None, suffix: str = ".txt") -> ArtifactRecord:
        payload = content if isinstance(content, str) else str(content)
        digest = hashlib.sha256(payload.encode("utf-8", errors="replace")).hexdigest()
        artifact_id = f"ART-{digest[:16]}"
        clean_kind = _safe_component(kind) or "evidence"
        clean_suffix = suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,8}", suffix) else ".txt"
        relative = Path("artifacts") / "raw" / f"{artifact_id}-{clean_kind}{clean_suffix}"
        target = self.workspace / relative
        if not target.exists():
            target.write_text(payload, encoding="utf-8")
        lines = payload.count("\n") + (1 if payload else 0)
        record = ArtifactRecord(
            artifact_id=artifact_id,
            kind=clean_kind,
            path=str(relative).replace("\\", "/"),
            created_at=_now(),
            size_bytes=len(payload.encode("utf-8", errors="replace")),
            line_count=lines,
            sha256=digest,
            summary=summary or _default_summary(clean_kind, payload),
            source=source,
            meta=meta or {},
        )
        (self.manifest_root / f"{artifact_id}.json").write_text(
            json.dumps(asdict(record), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return record

    def capture_command(self, command: str, stdout: str, stderr: str, *, exit_code: int,
                        timed_out: bool, source: str = "bash") -> ArtifactRecord:
        content = (
            f"COMMAND:\n{command}\n\nEXIT_CODE: {exit_code}\nTIMED_OUT: {timed_out}\n"
            f"\n--- STDOUT ---\n{stdout}\n\n--- STDERR ---\n{stderr}"
        )
        return self.capture_text(
            "command_output", content, source=source,
            summary=f"Command exit={exit_code} timeout={timed_out}; stdout={len(stdout)} chars stderr={len(stderr)} chars.",
            meta={"command": command, "exit_code": exit_code, "timed_out": timed_out,
                  "stdout_chars": len(stdout), "stderr_chars": len(stderr)},
        )

    def list_artifacts(self, *, kind: str = "", limit: int = 40) -> list[ArtifactRecord]:
        records: list[ArtifactRecord] = []
        for path in sorted(self.manifest_root.glob("ART-*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                record = ArtifactRecord(**data)
            except (OSError, TypeError, json.JSONDecodeError):
                continue
            if kind and record.kind != kind:
                continue
            records.append(record)
            if len(records) >= max(1, min(limit, 100)):
                break
        return records

    def get(self, artifact_id: str) -> ArtifactRecord:
        if not re.fullmatch(r"ART-[a-f0-9]{16}", artifact_id):
            raise ValueError("Invalid artifact_id")
        path = self.manifest_root / f"{artifact_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Unknown artifact: {artifact_id}")
        return ArtifactRecord(**json.loads(path.read_text(encoding="utf-8")))

    def read_lines(self, artifact_id: str, start_line: int = 1, end_line: int | None = None) -> tuple[ArtifactRecord, str, int, int]:
        record = self.get(artifact_id)
        start = max(1, start_line)
        end = min(record.line_count or 1, end_line if end_line is not None else start + 79)
        end = max(start, end)
        lines = self._read(record).splitlines()
        return record, "\n".join(lines[start - 1:end]), start, end

    def search(self, artifact_id: str, query: str, *, max_matches: int = 20,
               context_lines: int = 1, regex: bool = False) -> tuple[ArtifactRecord, list[dict[str, Any]]]:
        if not query or len(query) > 500:
            raise ValueError("query must contain 1-500 characters")
        record = self.get(artifact_id)
        lines = self._read(record).splitlines()
        pattern = re.compile(query if regex else re.escape(query), flags=re.IGNORECASE)
        matches: list[dict[str, Any]] = []
        for number, line in enumerate(lines, start=1):
            if not pattern.search(line):
                continue
            start = max(1, number - max(0, min(context_lines, 8)))
            end = min(len(lines), number + max(0, min(context_lines, 8)))
            matches.append({"line": number, "start_line": start, "end_line": end, "preview": "\n".join(lines[start - 1:end])[:1200]})
            if len(matches) >= max(1, min(max_matches, 50)):
                break
        return record, matches

    def read_context(self, artifact_id: str, query: str, *, max_matches: int = 8,
                     context_lines: int = 3, regex: bool = False) -> tuple[ArtifactRecord, list[dict[str, Any]]]:
        if not query or len(query) > 500:
            raise ValueError("query must contain 1-500 characters")
        record = self.get(artifact_id)
        lines = self._read(record).splitlines()
        pattern = re.compile(query if regex else re.escape(query), flags=re.IGNORECASE)
        slices: list[dict[str, Any]] = []
        for number, line in enumerate(lines, start=1):
            if not pattern.search(line):
                continue
            start = max(1, number - max(0, min(context_lines, 8)))
            end = min(len(lines), number + max(0, min(context_lines, 8)))
            slices.append({"start_line": start, "end_line": end, "preview": "\n".join(lines[start - 1:end])[:1200]})
            if len(slices) >= max(1, min(max_matches, 50)):
                break
        return record, slices

    def summarize(self, artifact_id: str, *, max_chars: int = 4000) -> dict[str, Any]:
        record = self.get(artifact_id)
        text = self._read(record)
        summary = text[:max(1, min(max_chars, 20000))]
        return {
            "artifact_id": record.artifact_id,
            "kind": record.kind,
            "path": record.path,
            "size_bytes": record.size_bytes,
            "line_count": record.line_count,
            "sha256": record.sha256,
            "summary": record.summary,
            "source": record.source,
            "meta": record.meta,
            "preview": summary,
        }

    def _read(self, record: ArtifactRecord) -> str:
        path = (self.workspace / record.path).resolve()
        if self.workspace not in path.parents:
            raise ValueError("Artifact path escapes workspace")
        return path.read_text(encoding="utf-8", errors="replace")


def artifact_manifest(record: ArtifactRecord) -> str:
    return (
        f"artifact_id={record.artifact_id} kind={record.kind} path={record.path} "
        f"size={record.size_bytes}B lines={record.line_count} summary={record.summary}"
    )


def _safe_component(value: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-")[:48]


def _default_summary(kind: str, content: str) -> str:
    nonempty = sum(1 for line in content.splitlines() if line.strip())
    return f"{kind} artifact with {nonempty} non-empty lines."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
