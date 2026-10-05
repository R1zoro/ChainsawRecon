"""Burp MCP adapter — a modular client for the PortSwigger Burp MCP extension.

This package replaces the former monolithic ``burp_mcp.py``.  The public
surface below is the only contract the rest of ChainsawRecon imports, so the
internal split (types / schema / parsing / patch / transport / client /
actions) can evolve without touching callers.

Ground truth for the tool catalog lives in :mod:`bounty_agent.burp_mcp.schema`;
the extension's real tools are snake_case derivations of its Kotlin data
classes (``get_proxy_http_history``, ``send_http_1_request``,
``create_repeater_tab``, …).  There is no site-map, session, or compare tool,
so those concepts are synthesized locally or intentionally omitted.
"""
from __future__ import annotations

from .actions import MCP_ACTIONS, build_mcp_action
from .client import BurpMcpClient
from .parsing import extract_tool_names as _extract_tool_names
from .patch import parse_patch
from .types import BurpMcpCapabilityError, BurpMcpConfig, BurpMcpError, BurpMcpResult

__all__ = [
    "BurpMcpClient",
    "BurpMcpConfig",
    "BurpMcpResult",
    "BurpMcpError",
    "BurpMcpCapabilityError",
    "MCP_ACTIONS",
    "build_mcp_action",
    "parse_patch",
    "_extract_tool_names",
]