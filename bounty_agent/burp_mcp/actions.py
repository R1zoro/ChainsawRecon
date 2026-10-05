"""Model-facing Burp MCP action definitions.

These are the stable, high-level action names the model selects.  They are the
only Burp actions that survive the migration away from the old REST contract:
the site-map and session-status actions had no extension backend and are gone.
"""
from __future__ import annotations

from typing import Any

from .schema import SEMANTIC_ACTIONS


# High-level model-facing action names that ToolRegistry dispatches.
MCP_ACTIONS: frozenset[str] = frozenset(SEMANTIC_ACTIONS)


def build_mcp_action(tool: str, args: dict[str, Any]) -> dict[str, Any]:
    """Build a model-facing high-level action payload."""
    return {"action": tool, **args}