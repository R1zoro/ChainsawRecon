from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import os
import subprocess


def _safe_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in {"PYTHONPATH", "VIRTUAL_ENV"}}
    return env


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


class SandboxRunner:
    def __init__(self, settings: Any = None) -> None:
        self.settings = settings

    def exec(self, command: str, timeout_seconds: int) -> CommandResult:
        raise NotImplementedError

    def close(self) -> None:
        return None

    def read_file(self, path: str) -> str:
        raise NotImplementedError

    def write_file(self, path: str, content: str) -> None:
        raise NotImplementedError

    def list_files(self, path: str) -> list[str]:
        raise NotImplementedError


class LocalWorkspaceRunner(SandboxRunner):
    def __init__(self, workspace: Path, settings: Any = None) -> None:
        super().__init__(settings)
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)

    def exec(self, command: str, timeout_seconds: int) -> CommandResult:
        env = None
        if self.settings is not None:
            env = dict(**_safe_env())
            if getattr(self.settings, "http_proxy", ""):
                env["HTTP_PROXY"] = self.settings.http_proxy
                env["http_proxy"] = self.settings.http_proxy
            if getattr(self.settings, "https_proxy", ""):
                env["HTTPS_PROXY"] = self.settings.https_proxy
                env["https_proxy"] = self.settings.https_proxy
            if getattr(self.settings, "burp_proxy", ""):
                env["HTTP_PROXY"] = self.settings.burp_proxy
                env["http_proxy"] = self.settings.burp_proxy
                env["HTTPS_PROXY"] = self.settings.burp_proxy
                env["https_proxy"] = self.settings.burp_proxy
            if getattr(self.settings, "no_proxy", ""):
                env["NO_PROXY"] = self.settings.no_proxy
                env["no_proxy"] = self.settings.no_proxy
        try:
            completed = subprocess.run(
                command,
                shell=True,
                cwd=self.workspace,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=timeout_seconds,
                env=env,
            )
            return CommandResult(command, completed.returncode, completed.stdout, completed.stderr)
        except subprocess.TimeoutExpired as exc:
            return CommandResult(
                command=command,
                exit_code=124,
                stdout=exc.stdout or "",
                stderr=exc.stderr or f"Command timed out after {timeout_seconds}s",
                timed_out=True,
            )

    def read_file(self, path: str) -> str:
        return self._resolve(path).read_text(encoding="utf-8", errors="replace")

    def write_file(self, path: str, content: str) -> None:
        target = self._resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def list_files(self, path: str) -> list[str]:
        root = self._resolve(path)
        workspace = self.workspace.resolve()
        if root.is_file():
            return [str(root.relative_to(workspace))]
        return sorted(str(item.relative_to(workspace)) for item in root.rglob("*"))

    def _resolve(self, path: str) -> Path:
        candidate = (self.workspace / path.lstrip("/\\")).resolve()
        workspace = self.workspace.resolve()
        if candidate != workspace and workspace not in candidate.parents:
            raise ValueError(f"Path escapes workspace: {path}")
        return candidate


class DockerSandboxRunner(LocalWorkspaceRunner):
    def __init__(self, workspace: Path, image: str, env_file: Path | None = None, settings: Any = None) -> None:
        super().__init__(workspace, settings)
        self.image = image
        self.env_file = env_file
        self.container_id: str | None = None

    def exec(self, command: str, timeout_seconds: int) -> CommandResult:
        container_id = self._ensure_container()
        docker_command = [
            "docker",
            "exec",
            container_id,
            "sh",
            "-c",
            f"timeout -s KILL -k 5 {timeout_seconds} sh -c {self._shell_quote(command)}",
        ]
        env = None
        if self.settings is not None:
            env = dict(**_safe_env())
            if getattr(self.settings, "http_proxy", ""):
                env["HTTP_PROXY"] = self.settings.http_proxy
                env["http_proxy"] = self.settings.http_proxy
            if getattr(self.settings, "https_proxy", ""):
                env["HTTPS_PROXY"] = self.settings.https_proxy
                env["https_proxy"] = self.settings.https_proxy
            if getattr(self.settings, "no_proxy", ""):
                env["NO_PROXY"] = self.settings.no_proxy
                env["no_proxy"] = self.settings.no_proxy
            # Milestone 5.1: Burp proxy capture via host.docker.internal:8080
            if getattr(self.settings, "burp_proxy", ""):
                env["HTTP_PROXY"] = self.settings.burp_proxy
                env["http_proxy"] = self.settings.burp_proxy
                env["HTTPS_PROXY"] = self.settings.burp_proxy
                env["https_proxy"] = self.settings.burp_proxy
        try:
            completed = subprocess.run(
                docker_command,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=timeout_seconds + 10,
                env=env,
            )
            return CommandResult(command, completed.returncode, completed.stdout, completed.stderr)
        except subprocess.TimeoutExpired as exc:
            return CommandResult(
                command=command,
                exit_code=124,
                stdout=exc.stdout or "",
                stderr=exc.stderr or f"Docker command timed out after {timeout_seconds}s",
                timed_out=True,
            )

    def close(self) -> None:
        if not self.container_id:
            return
        subprocess.run(
            ["docker", "rm", "-f", self.container_id],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
        )
        self.container_id = None

    def _ensure_container(self) -> str:
        if self.container_id:
            return self.container_id
        command = [
            "docker",
            "run",
            "-d",
            "--rm",
            "--add-host",
            "host.docker.internal:host-gateway",
            "-e",
            "PATH=/root/go/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
        ]
        if self.settings is not None:
            if getattr(self.settings, "burp_proxy", ""):
                command.extend([
                    "-e", f"HTTP_PROXY={self.settings.burp_proxy}",
                    "-e", f"http_proxy={self.settings.burp_proxy}",
                    "-e", f"HTTPS_PROXY={self.settings.burp_proxy}",
                    "-e", f"https_proxy={self.settings.burp_proxy}",
                ])
            if getattr(self.settings, "http_proxy", ""):
                command.extend([
                    "-e", f"HTTP_PROXY={self.settings.http_proxy}",
                    "-e", f"http_proxy={self.settings.http_proxy}",
                ])
            if getattr(self.settings, "https_proxy", ""):
                command.extend([
                    "-e", f"HTTPS_PROXY={self.settings.https_proxy}",
                    "-e", f"https_proxy={self.settings.https_proxy}",
                ])
            if getattr(self.settings, "no_proxy", ""):
                command.extend([
                    "-e", f"NO_PROXY={self.settings.no_proxy}",
                    "-e", f"no_proxy={self.settings.no_proxy}",
                ])
        if self.env_file and self.env_file.exists():
            command.extend(["--env-file", str(self.env_file.resolve())])
        command.extend([
            "-v",
            f"{self.workspace.resolve()}:/workspace",
            "-w",
            "/workspace",
            self.image,
            "sleep",
            "infinity",
        ])
        completed = subprocess.run(
            command,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "Failed to start Docker sandbox.")
        self.container_id = completed.stdout.strip()
        return self.container_id

    def _shell_quote(self, value: str) -> str:
        return "'" + value.replace("'", "'\"'\"'") + "'"