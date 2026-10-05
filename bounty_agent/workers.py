from __future__ import annotations

"""Logical specialist-worker contracts.

Workers share one LLM endpoint but receive bounded objectives and evidence.
They are not additional resident models; the coordinator schedules these
short-lived roles and deterministic code enforces their action boundaries.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WorkerSpec:
    name: str
    mission: str
    allowed_actions: tuple[str, ...]
    evidence_required: tuple[str, ...] = ()


WORKER_SPECS: tuple[WorkerSpec, ...] = (
    WorkerSpec("mapping", "Discover hosts, routes, technologies, and inputs.", ("httpx", "katana", "browser_map", "nuclei", "route_surface", "search_world_model")),
    WorkerSpec("browser", "Record browser journeys and request lineage.", ("browser_map", "list_journeys", "search_journey_requests", "get_journey_request")),
    WorkerSpec("api_graphql", "Understand API and GraphQL surfaces before testing.", ("search_captured_requests", "get_captured_request", "search_world_model")),
    WorkerSpec("injection", "Run bounded input experiments against confirmed surfaces.", ("dalfox", "sqlmap", "replay_captured_request"), ("baseline_response",)),
    WorkerSpec("authorization", "Compare access across session lanes and object identifiers.", ("replay_captured_request", "compare_captured_responses"), ("control_response", "candidate_response")),
    WorkerSpec("validation", "Reproduce and classify candidate findings independently.", ("create_verifier", "read_artifact_context", "compare_captured_responses", "nuclei"), ("reproducible_evidence",)),
)


def worker_manifest() -> list[dict[str, Any]]:
    return [
        {"name": item.name, "mission": item.mission, "allowed_actions": list(item.allowed_actions), "evidence_required": list(item.evidence_required)}
        for item in WORKER_SPECS
    ]


def get_worker(name: str) -> WorkerSpec | None:
    return next((item for item in WORKER_SPECS if item.name == name), None)


# Actions that stay available no matter which worker is active.  They are
# planning, output, and inspection primitives — never a testing/tool action —
# so the model can record a finding, read evidence, switch workers, or finish
# without being dead-ended by the hard-block gate.
WORKER_META_ACTIONS: frozenset[str] = frozenset({
    "finish",
    "select_worker",
    "list_workers",
    "create_objective",
    "create_hypothesis",
    "record_evidence",
    "save_artifact",
    "record_finding",
    "list_artifacts",
    "search_artifact",
    "read_artifact_slice",
    "read_artifact_context",
    "summarize_artifact",
    "world_model_summary",
    "search_world_model",
    "route_surface",
    "perform_login",
    "verify_session",
    "renew_session",
    "session_status",
})


def worker_gate(active_worker: str | None, action: str) -> str | None:
    """Enforce the active worker's action contract (hard-block).

    Returns an error message when ``action`` is outside the active worker's
    ``allowed_actions`` (and not a meta action), else ``None``.  A ``None``
    ``active_worker`` means no worker is selected, so nothing is gated.
    """
    if not active_worker:
        return None
    if action in WORKER_META_ACTIONS:
        return None
    worker = get_worker(active_worker)
    if worker is None:
        return (
            f"Active worker '{active_worker}' is unknown. "
            "Use list_workers to see available workers and select_worker to choose one."
        )
    if action in worker.allowed_actions:
        return None
    allowed = ", ".join(worker.allowed_actions) or "(none)"
    return (
        f"Worker '{active_worker}' does not allow action '{action}'. "
        f"Allowed: {allowed}. Use select_worker to switch workers, or finish."
    )
