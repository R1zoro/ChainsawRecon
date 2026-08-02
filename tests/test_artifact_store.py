from __future__ import annotations

from bounty_agent.artifact_store import ArtifactStore
from bounty_agent.browser_worker import BROWSER_WORKER_SCRIPT


def test_artifact_store_preserves_full_output_and_returns_targeted_views(tmp_path):
    store = ArtifactStore(tmp_path)
    record = store.capture_command("example", "first\nGraphQL endpoint /api/graphql\nlast", "", exit_code=0, timed_out=False)

    assert (tmp_path / record.path).read_text(encoding="utf-8").endswith("last\n\n--- STDERR ---\n")
    found, matches = store.search(record.artifact_id, "graphql", context_lines=1)
    assert found.artifact_id == record.artifact_id
    assert matches[0]["line"] >= 1
    _, excerpt, start, end = store.read_lines(record.artifact_id, matches[0]["start_line"], matches[0]["end_line"])
    assert start <= matches[0]["line"] <= end
    assert "/api/graphql" in excerpt


def test_browser_worker_script_is_valid_python():
    compile(BROWSER_WORKER_SCRIPT, ".chainsaw_browser_worker.py", "exec")
