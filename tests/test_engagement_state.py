from pathlib import Path

from bounty_agent.agent import BountyAgent
from bounty_agent.config import AgentSettings, ProgramScope
from bounty_agent.engagement_state import EngagementStateStore, extract_hosts
from bounty_agent.scope import ScopeGuard
from bounty_agent.tools import ToolRegistry


class MemoryRunner:
    def __init__(self) -> None:
        self.settings = AgentSettings()
        self.files: dict[str, str] = {}

    def exec(self, command: str, timeout_seconds: int):
        return type("Result", (), {"command": command, "exit_code": 0, "stdout": "", "stderr": "", "timed_out": False})()

    def read_file(self, path: str) -> str:
        return self.files.get(path, "")

    def write_file(self, path: str, content: str) -> None:
        self.files[path] = content

    def list_files(self, path: str) -> list[str]:
        return sorted(self.files)


class MemoryTrace:
    def write(self, event: str, **payload):
        return None


def test_state_store_exports_objective_hypothesis_and_evidence(tmp_path: Path) -> None:
    store = EngagementStateStore(tmp_path / "knowledge" / "state.db")
    try:
        objective = store.ensure_objective("Assess orders", "https://app.example.com")
        hypothesis = store.create_hypothesis(
            "Possible object authorization issue",
            "Can user A access user B's order?",
            "https://app.example.com/api/orders/{id}",
            objective_id=objective,
            required_evidence=["two users", "control response"],
        )
        store.record_evidence("response", "responses/order-a.json", "Control response", content="{\"id\": 1}", hypothesis_id=hypothesis)
        store.record_action("run-1", {"action": "httpx", "target": "https://app.example.com"}, True, "ok", target="https://app.example.com", objective_id=objective)

        exports = store.write_machine_exports(tmp_path / "knowledge")

        assert exports["objectives.jsonl"].read_text(encoding="utf-8")
        assert "Possible object authorization issue" in exports["hypotheses.jsonl"].read_text(encoding="utf-8")
        assert store.budget_summary("run-1") == {"actions": 1, "successful_actions": 1}
    finally:
        store.close()


def test_typed_actions_create_state_and_verifier(tmp_path: Path) -> None:
    state = EngagementStateStore(tmp_path / "state.db")
    runner = MemoryRunner()
    registry = ToolRegistry(
        runner,
        ScopeGuard(ProgramScope("test", allowed_domains=["example.com"]), allow_all=True),
        MemoryTrace(),
        retrieval=None,
        state_store=state,
        run_id="run-1",
    )
    try:
        objective = registry.execute({"action": "create_objective", "title": "Assess API", "target": "https://api.example.com"})
        assert objective.ok
        hypothesis = registry.execute(
            {
                "action": "create_hypothesis",
                "title": "Possible authorization gap",
                "security_question": "Can one user read another user's record?",
                "surface": "https://api.example.com/api/records/{id}",
                "required_evidence": ["two user contexts"],
            }
        )
        assert hypothesis.ok
        artifact = registry.execute({"action": "save_artifact", "artifact_type": "api_endpoint", "data": {"url": "https://api.example.com/api/records"}})
        verifier = registry.execute({"action": "create_verifier", "target": "https://api.example.com/api/records/1", "purpose": "authz"})

        assert artifact.ok
        assert verifier.ok
        assert "artifacts/api_endpoint/api_endpoint.json" in runner.files
        assert "verify_authz.py" in runner.files
        assert len(state.hypotheses()) == 1
        assert state.budget_summary("run-1")["actions"] == 4
    finally:
        state.close()


def test_mapping_run_publishes_shared_knowledge_and_catalogs(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run-1"
    agent = BountyAgent(
        ProgramScope("Acme", allowed_domains=["example.com"]),
        "https://example.com",
        AgentSettings(mode="mapping", dry_run=True, session_run_dir=run_dir, session_targets=("https://example.com",)),
        tmp_path / "runs",
    )

    result = agent.run()

    assert result == run_dir
    assert (tmp_path / "runs" / "knowledge" / "objectives.jsonl").exists()
    assert (tmp_path / "runs" / "knowledge" / "tool-manifest.json").exists()
    assert (tmp_path / "runs" / "catalogs" / "architecture.md").exists()
    assert (tmp_path / "runs" / "catalogs" / "testing-progress.tsv").exists()


def test_action_budget_blocks_work_after_limit(tmp_path: Path) -> None:
    state = EngagementStateStore(tmp_path / "state.db")
    registry = ToolRegistry(
        MemoryRunner(),
        ScopeGuard(ProgramScope("test", allowed_domains=["example.com"]), allow_all=True),
        MemoryTrace(),
        retrieval=None,
        state_store=state,
        run_id="run-1",
        max_actions=1,
    )
    try:
        assert registry.execute({"action": "create_objective", "title": "Assess", "target": "https://example.com"}).ok
        blocked = registry.execute({"action": "create_objective", "title": "Assess more", "target": "https://example.com"})
        assert not blocked.ok
        assert blocked.meta["budget_blocked"] is True
        assert registry.action_count == 1
    finally:
        state.close()


def test_host_extraction_handles_collapsed_tool_output() -> None:
    hosts = extract_hosts("--- stdout --- api.example.com www.example.com https://docs.example.com/openapi.json")
    assert hosts == {"api.example.com", "www.example.com", "docs.example.com"}


def test_attack_tools_require_a_hypothesis_when_state_is_enabled(tmp_path: Path) -> None:
    state = EngagementStateStore(tmp_path / "state.db")
    runner = MemoryRunner()
    registry = ToolRegistry(
        runner,
        ScopeGuard(ProgramScope("test", allowed_domains=["example.com"]), allow_all=True),
        MemoryTrace(),
        retrieval=None,
        state_store=state,
        run_id="run-1",
    )
    try:
        rejected = registry.execute({"action": "dalfox", "target": "https://example.com/search?q=test"})
        assert not rejected.ok
        assert rejected.meta["hypothesis_required"] is True

        created = registry.execute(
            {
                "action": "create_hypothesis",
                "title": "Reflected input may be unsafe",
                "security_question": "Does the search response reflect unescaped input?",
                "surface": "https://example.com/search?q=test",
            }
        )
        assert created.ok
        assert registry.execute({"action": "dalfox", "target": "https://example.com/search?q=test"}).ok
    finally:
        state.close()
