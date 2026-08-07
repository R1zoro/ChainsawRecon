import sqlite3
from pathlib import Path
from uuid import uuid4

from bounty_agent.recon_db import (
    ReconFact,
    ReconStore,
    build_attack_results_from_action_result,
    build_facts_from_action_result,
    build_surfaces_from_action_result,
    promote_run_facts,
)


def test_run_store_extracts_useful_endpoint_facts() -> None:
    store = ReconStore(_test_db_path("run"))
    try:
        facts = build_facts_from_action_result(
            {"action": "bash", "command": "curl https://app.example.com/api/v2/users?next=https://x.test"},
            True,
            "HTTP/1.1 200 OK",
            "tool:1",
        )
        for fact in facts:
            store.upsert_fact(fact)

        endpoints = [fact for fact in store.facts() if fact.kind == "endpoint"]

        assert endpoints
        assert "api" in endpoints[0].tags
        assert "parameter" in endpoints[0].tags
    finally:
        store.close()


def test_js_bundle_extracts_relative_api_and_graphql_surfaces() -> None:
    surfaces = build_surfaces_from_action_result(
        {
            "action": "bash",
            "command": "curl https://app.example.com/assets/app.js",
        },
        True,
        "fetch('/api/v2/users'); const q = '/graphql'; sourceMappingURL=app.js.map",
        "tool:1",
    )

    kinds = {surface.surface_type for surface in surfaces}
    paths = {surface.path_pattern for surface in surfaces}

    assert "js" in kinds
    assert "api" in kinds or "graphql" in kinds
    assert any(path.startswith("/api") or path.startswith("/graphql") for path in paths)


def test_next_task_planner_prefers_uncovered_js_and_api_surfaces() -> None:
    store = ReconStore(_test_db_path("coverage"))
    try:
        for surface in build_surfaces_from_action_result(
            {"action": "bash", "command": "curl https://app.example.com/api/v2/users"},
            True,
            "HTTP/1.1 200 OK",
            "tool:1",
        ):
            store.upsert_surface(surface)
        for attack in build_attack_results_from_action_result(
            {"action": "bash", "command": "curl https://app.example.com/api/v2/users"},
            True,
            "HTTP/1.1 200 OK",
            "tool:1",
        ):
            store.upsert_attack_result(attack)

        summary = store.coverage_summary()

        assert summary["surface_count"] >= 1
        assert summary["next_tasks"]
        assert any(task["attack_type"] != "api" for task in summary["next_tasks"]) or summary["next_tasks"][0][
            "surface_type"
        ] != "api"
    finally:
        store.close()


def test_legacy_database_schema_is_migrated_to_add_last_seen_columns() -> None:
    db_path = _test_db_path("legacy")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE facts(
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                confidence TEXT NOT NULL,
                source TEXT NOT NULL,
                evidence TEXT NOT NULL,
                status TEXT NOT NULL,
                tags TEXT NOT NULL,
                meta TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

    store = ReconStore(db_path)
    try:
        cols = [row[1] for row in store.conn.execute("PRAGMA table_info(facts)")]
        assert "last_seen" in cols
    finally:
        store.close()


def test_only_promotable_facts_enter_engagement_store() -> None:
    root = _test_root()
    run = ReconStore(root / f"run-{uuid4().hex}.db")
    engagement = ReconStore(root / f"engagement-{uuid4().hex}.db")
    try:
        run.upsert_fact(ReconFact("endpoint", "example.com/", "https://example.com/", "tentative", "tool:1"))
        run.upsert_fact(
            ReconFact(
                "endpoint",
                "app.example.com/api/v2/users",
                "https://app.example.com/api/v2/users",
                "observed",
                "tool:2",
                tags=("api",),
                meta={"path_pattern": "/api/v2/users"},
            )
        )

        promoted = promote_run_facts(run, engagement, "run-1")

        assert promoted == 1
        facts = engagement.facts()
        assert len(facts) == 1
        assert facts[0].value == "https://app.example.com/api/v2/users"
    finally:
        run.close()
        engagement.close()


def _test_db_path(prefix: str) -> Path:
    return _test_root() / f"{prefix}-{uuid4().hex}.db"


def _test_root() -> Path:
    root = Path("sandbox") / "test-recon-db"
    root.mkdir(parents=True, exist_ok=True)
    return root
