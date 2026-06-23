from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


class SandboxRunner:
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
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)

    def exec(self, command: str, timeout_seconds: int) -> CommandResult:
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
    def __init__(self, workspace: Path, image: str, env_file: Path | None = None) -> None:
        super().__init__(workspace)
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
        try:
            completed = subprocess.run(
                docker_command,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=timeout_seconds + 10,
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
            "-e",
            "PATH=/root/go/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
        ]
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
