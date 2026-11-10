"""Pinned tool packs.

The harness owns the tool lifecycle without embedding every binary in the
desktop executable:

    catalog -> plan -> download -> SHA256 verify -> install -> health -> invoke

A tool pack is a JSON manifest. Binaries live in release assets or object
storage and are pinned by version + checksum. Never clone and execute an
arbitrary repository at runtime.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform as platform_module
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


class ToolPackError(RuntimeError):
    pass


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_platform(value: str | None = None) -> str:
    raw = (value or platform_module.system()).lower()
    if raw.startswith("win"):
        return "windows"
    if raw.startswith("darwin") or raw == "mac":
        return "darwin"
    if raw.startswith("linux"):
        return "linux"
    return raw


def normalize_arch(value: str | None = None) -> str:
    raw = (value or platform_module.machine()).lower()
    if raw in {"x86_64", "amd64", "x64"}:
        return "x64"
    if raw in {"aarch64", "arm64"}:
        return "arm64"
    if raw in {"i386", "i686", "x86"}:
        return "x86"
    return raw


@dataclass(frozen=True)
class ToolArtifact:
    name: str
    version: str
    platform: str
    arch: str
    url: str
    sha256: str
    size_bytes: int
    license: str = ""
    source: str = ""
    entrypoint: str = ""
    kind: str = "binary"

    def __post_init__(self) -> None:
        if not self.name or not self.version:
            raise ToolPackError("artifact name and version are required")
        if not self.url.startswith(("https://", "http://")):
            raise ToolPackError(f"{self.name}: artifact URL must be http(s)")
        if len(self.sha256) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in self.sha256):
            raise ToolPackError(f"{self.name}: sha256 must be 64 hex characters")
        if self.size_bytes < 0:
            raise ToolPackError(f"{self.name}: size_bytes cannot be negative")
        if self.kind not in {"binary", "archive"}:
            raise ToolPackError(f"{self.name}: kind must be binary or archive")

    @property
    def filename(self) -> str:
        if self.entrypoint:
            return self.entrypoint
        base = Path(self.url.split("?", 1)[0]).name
        return base or self.name


@dataclass(frozen=True)
class ToolPack:
    name: str
    version: str
    artifacts: tuple[ToolArtifact, ...]
    description: str = ""
    requires: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.name or not self.version:
            raise ToolPackError("pack name and version are required")
        seen: set[tuple[str, str, str, str]] = set()
        for item in self.artifacts:
            key = (item.name, item.platform, item.arch, item.version)
            if key in seen:
                raise ToolPackError(f"duplicate artifact {key}")
            seen.add(key)

    def for_platform(self, platform: str | None = None, arch: str | None = None) -> tuple[ToolArtifact, ...]:
        target_platform = normalize_platform(platform)
        target_arch = normalize_arch(arch)
        return tuple(
            item
            for item in self.artifacts
            if item.platform == target_platform and item.arch == target_arch
        )


@dataclass(frozen=True)
class InstalledArtifact:
    artifact: ToolArtifact
    path: Path


@dataclass(frozen=True)
class ToolPackPlan:
    pack: ToolPack
    platform: str
    arch: str
    missing: tuple[ToolArtifact, ...]
    installed: tuple[InstalledArtifact, ...]

    @property
    def complete(self) -> bool:
        return not self.missing

    def to_dict(self) -> dict[str, Any]:
        return {
            "pack": self.pack.name,
            "version": self.pack.version,
            "platform": self.platform,
            "arch": self.arch,
            "complete": self.complete,
            "missing": [item.name for item in self.missing],
            "installed": [item.artifact.name for item in self.installed],
        }


def load_tool_pack(value: Path | str | dict[str, Any]) -> ToolPack:
    if isinstance(value, (str, Path)):
        path = Path(value)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ToolPackError(f"cannot read pack manifest {path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise ToolPackError(f"invalid pack manifest {path}: {exc}") from exc
    else:
        data = value
    if not isinstance(data, dict):
        raise ToolPackError("pack manifest must be an object")
    artifacts_raw = data.get("artifacts")
    if not isinstance(artifacts_raw, list) or not artifacts_raw:
        raise ToolPackError("pack manifest requires a non-empty artifacts list")
    artifacts = tuple(_artifact_from_dict(item) for item in artifacts_raw)
    requires = data.get("requires", [])
    if not isinstance(requires, list):
        raise ToolPackError("requires must be a list")
    return ToolPack(
        name=str(data.get("name", "")),
        version=str(data.get("version", "")),
        description=str(data.get("description", "")),
        artifacts=artifacts,
        requires=tuple(str(item) for item in requires),
    )


def _artifact_from_dict(value: Any) -> ToolArtifact:
    if not isinstance(value, dict):
        raise ToolPackError("artifact must be an object")
    required = ("name", "version", "platform", "arch", "url", "sha256", "sizeBytes")
    missing = [key for key in required if key not in value]
    if missing:
        raise ToolPackError(f"artifact missing fields: {', '.join(missing)}")
    return ToolArtifact(
        name=str(value["name"]),
        version=str(value["version"]),
        platform=normalize_platform(str(value["platform"])),
        arch=normalize_arch(str(value["arch"])),
        url=str(value["url"]),
        sha256=str(value["sha256"]).lower(),
        size_bytes=int(value["sizeBytes"]),
        license=str(value.get("license", "")),
        source=str(value.get("source", "")),
        entrypoint=str(value.get("entrypoint", "")),
        kind=str(value.get("kind", "binary")),
    )


def artifact_path(dest: Path, pack: ToolPack, artifact: ToolArtifact) -> Path:
    return dest / pack.name / pack.version / artifact.filename


def plan_install(
    pack: ToolPack,
    dest: Path | str,
    *,
    platform: str | None = None,
    arch: str | None = None,
) -> ToolPackPlan:
    dest = Path(dest)
    target_platform = normalize_platform(platform)
    target_arch = normalize_arch(arch)
    candidates = pack.for_platform(target_platform, target_arch)
    if not candidates:
        raise ToolPackError(
            f"pack '{pack.name}' has no artifacts for {target_platform}/{target_arch}"
        )
    missing: list[ToolArtifact] = []
    installed: list[InstalledArtifact] = []
    for artifact in candidates:
        path = artifact_path(dest, pack, artifact)
        if path.exists() and path.is_file() and sha256_file(path) == artifact.sha256:
            installed.append(InstalledArtifact(artifact, path))
        else:
            missing.append(artifact)
    return ToolPackPlan(
        pack=pack,
        platform=target_platform,
        arch=target_arch,
        missing=tuple(missing),
        installed=tuple(installed),
    )


Downloader = Callable[[str, Path], None]


def urllib_download(url: str, target: Path, *, timeout: int = 60) -> None:
    request = Request(url, headers={"User-Agent": "chainsaw-recon/2.0"})
    target.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(request, timeout=timeout) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle, length=1024 * 1024)


def install_pack(
    pack: ToolPack,
    dest: Path | str,
    downloader: Downloader = urllib_download,
    *,
    platform: str | None = None,
    arch: str | None = None,
) -> tuple[InstalledArtifact, ...]:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    plan = plan_install(pack, dest, platform=platform, arch=arch)
    installed: list[InstalledArtifact] = list(plan.installed)
    for artifact in plan.missing:
        target = artifact_path(dest, pack, artifact)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix="chainsaw-pack-", dir=str(dest)))
        temp_file = temp_dir / artifact.filename
        try:
            downloader(artifact.url, temp_file)
            if not temp_file.exists():
                raise ToolPackError(f"{artifact.name}: downloader produced no file")
            size = temp_file.stat().st_size
            if artifact.size_bytes and size != artifact.size_bytes:
                raise ToolPackError(
                    f"{artifact.name}: size mismatch (expected {artifact.size_bytes}, got {size})"
                )
            digest = sha256_file(temp_file)
            if digest != artifact.sha256:
                raise ToolPackError(
                    f"{artifact.name}: checksum mismatch (expected {artifact.sha256}, got {digest})"
                )
            os.replace(temp_file, target)
            if artifact.kind == "binary" and os.name != "nt":
                target.chmod(0o755)
            installed.append(InstalledArtifact(artifact, target))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    _write_install_marker(dest, pack, platform=platform, arch=arch)
    return tuple(installed)


def _write_install_marker(
    dest: Path,
    pack: ToolPack,
    *,
    platform: str | None,
    arch: str | None,
) -> None:
    marker = dest / pack.name / pack.version / "installed.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "pack": pack.name,
        "version": pack.version,
        "platform": normalize_platform(platform),
        "arch": normalize_arch(arch),
        "artifacts": [
            {
                "name": item.name,
                "sha256": item.sha256,
                "entrypoint": item.entrypoint,
            }
            for item in pack.for_platform(platform, arch)
        ],
    }
    marker.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def installed_tools(pack: ToolPack, dest: Path | str, *, platform: str | None = None, arch: str | None = None) -> dict[str, Path]:
    plan = plan_install(pack, dest, platform=platform, arch=arch)
    return {item.artifact.name: item.path for item in plan.installed}


__all__ = [
    "Downloader",
    "InstalledArtifact",
    "ToolArtifact",
    "ToolPack",
    "ToolPackError",
    "ToolPackPlan",
    "artifact_path",
    "install_pack",
    "installed_tools",
    "load_tool_pack",
    "normalize_arch",
    "normalize_platform",
    "plan_install",
    "sha256_file",
    "urllib_download",
]
