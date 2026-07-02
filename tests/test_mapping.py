import json
from pathlib import Path

from bounty_agent.agent import BountyAgent
from bounty_agent.cli import resolve_targets
from bounty_agent.config import AgentSettings, ProgramScope
from bounty_agent.recon_db import SurfaceRecord


def test_mapping_state_targets_are_used_for_recon_workflow(tmp_path: Path) -> None:
    engagement = tmp_path / "engagements" / "acme"
    program_dir = engagement / "program"
    program_dir.mkdir(parents=True)
    (program_dir / "scope.json").write_text(
        json.dumps({"program_name": "Acme", "allowed_domains": ["example.com"]}),
        encoding="utf-8",
    )
    run_dir = engagement / "agent" / "runs" / "prior-run"
    run_dir.mkdir(parents=True)
    (run_dir / "mapping-state.json").write_text(
        json.dumps(
            {
                "targets": ["https://api.example.com", "https://example.com"],
                "hosts": ["api.example.com", "example.com"],
                "surfaces": [
                    {
                        "host": "api.example.com",
                        "path_pattern": "/graphql",
                        "surface_type": "graphql",
                        "auth_context": "public",
                        "tags": ["graphql"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    scope = ProgramScope("Acme", allowed_domains=["example.com"])
    assert resolve_targets(None, engagement, scope) == ["https://api.example.com", "https://example.com"]


def test_attack_handoff_prompt_recommends_follow_up_actions(tmp_path: Path) -> None:
    scope = ProgramScope(program_name="Acme", allowed_domains=["example.com"])
    agent = BountyAgent(scope, "https://example.com", AgentSettings(mode="attack", dry_run=True), tmp_path / "runs")
    agent.run_recon.upsert_surface(
        SurfaceRecord(
            surface_key="example.com/api",
            host="example.com",
            path_pattern="/api",
            surface_type="api",
            source="mapping-test",
            auth_context="authenticated",
            tags=("api", "auth"),
        )
    )

    prompt = agent._build_phase_handoff_prompt("attack")
    assert "attack" in prompt.lower() or "auth" in prompt.lower()


def test_mapping_payload_persists_structured_targets(tmp_path: Path) -> None:
    scope = ProgramScope(
        program_name="Acme",
        allowed_domains=["example.com"],
        allowed_urls=["https://example.com"],
        notes="Use only authorized accounts",
    )
    runs_dir = tmp_path / "engagement" / "agent" / "runs"
    agent = BountyAgent(scope, "https://example.com", AgentSettings(dry_run=True), runs_dir)

    agent.engagement_recon.upsert_surface(
        SurfaceRecord(
            surface_key="example.com/graphql",
            host="example.com",
            path_pattern="/graphql",
            surface_type="graphql",
            source="mapping-test",
            auth_context="public",
            tags=("graphql",),
        )
    )

    payload = agent._build_mapping_payload()
    assert payload["program_name"] == "Acme"
    assert "example.com" in payload["hosts"]
    assert any(surface["path_pattern"] == "/graphql" for surface in payload["surfaces"])

    mapping_path = agent._persist_mapping_state(payload)
    data = json.loads(mapping_path.read_text(encoding="utf-8"))
    assert data["program_name"] == "Acme"
    assert data["targets"] == ["https://example.com"]
