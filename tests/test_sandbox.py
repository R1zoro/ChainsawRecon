from pathlib import Path
import subprocess
from uuid import uuid4

from bounty_agent.sandbox import LocalWorkspaceRunner


def test_local_runner_uses_tolerant_utf8_decoding(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        captured.update(kwargs)
        return subprocess.CompletedProcess(args[0], 0, "ok", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    workspace = Path("sandbox") / "test-local-runner" / uuid4().hex
    result = LocalWorkspaceRunner(workspace).exec("example", 5)

    assert result.stdout == "ok"
    assert captured["encoding"] == "utf-8"
    assert captured["errors"] == "replace"
