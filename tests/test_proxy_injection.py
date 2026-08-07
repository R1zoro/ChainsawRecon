from pathlib import Path

from bounty_agent.config import AgentSettings
from bounty_agent.sandbox import LocalWorkspaceRunner


def test_local_runner_injects_proxy_env(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, dict] = {}

    def fake_run(*args, **kwargs):
        captured["env"] = kwargs.get("env", {})
        return __import__("subprocess").CompletedProcess(args[0], 0, "ok", "")

    monkeypatch.setattr(__import__("subprocess"), "run", fake_run)
    settings = AgentSettings(http_proxy="http://host.docker.internal:8080", https_proxy="http://host.docker.internal:8080", no_proxy="localhost,127.0.0.1")
    runner = LocalWorkspaceRunner(tmp_path / "workspace", settings=settings)
    result = runner.exec("echo hi", 5)

    assert result.stdout == "ok"
    assert captured["env"]["HTTP_PROXY"] == "http://host.docker.internal:8080"
    assert captured["env"]["HTTPS_PROXY"] == "http://host.docker.internal:8080"
    assert captured["env"]["NO_PROXY"] == "localhost,127.0.0.1"


def test_local_runner_injects_burp_proxy_env(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, dict] = {}

    def fake_run(*args, **kwargs):
        captured["env"] = kwargs.get("env", {})
        return __import__("subprocess").CompletedProcess(args[0], 0, "ok", "")

    monkeypatch.setattr(__import__("subprocess"), "run", fake_run)
    settings = AgentSettings(burp_proxy="http://host.docker.internal:8080")
    runner = LocalWorkspaceRunner(tmp_path / "workspace", settings=settings)
    result = runner.exec("echo hi", 5)

    assert result.stdout == "ok"
    assert captured["env"]["HTTP_PROXY"] == "http://host.docker.internal:8080"
    assert captured["env"]["HTTPS_PROXY"] == "http://host.docker.internal:8080"


def test_docker_runner_passes_burp_proxy_into_container(monkeypatch, tmp_path: Path) -> None:
    call_history: list[tuple] = []

    def fake_run(*args, **kwargs):
        call_history.append((args, kwargs))
        if args[0][0] == "docker" and args[0][1] == "run":
            return __import__("subprocess").CompletedProcess(args[0], 0, "container123\n", "")
        return __import__("subprocess").CompletedProcess(args[0], 0, "ok", "")

    monkeypatch.setattr(__import__("subprocess"), "run", fake_run)
    settings = AgentSettings(burp_proxy="http://host.docker.internal:8080")
    from bounty_agent.sandbox import DockerSandboxRunner

    runner = DockerSandboxRunner(tmp_path / "workspace", image="bounty-sandbox", settings=settings)
    result = runner.exec("echo hi", 5)

    assert result.stdout == "ok"
    docker_run_args = call_history[0][0][0]
    assert "-e" in docker_run_args
    assert "HTTP_PROXY=http://host.docker.internal:8080" in docker_run_args
    assert "HTTPS_PROXY=http://host.docker.internal:8080" in docker_run_args
