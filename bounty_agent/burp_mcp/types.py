"""Shared types for the Burp MCP adapter.

These small value objects (config, result envelope, errors) are the only
contract the rest of ChainsawRecon imports from this package.  Keeping them
in one module avoids a tangle of cross-imports between the transport, client,
and action layers.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class BurpMcpError(RuntimeError):
    """Base error for Burp MCP integration failures."""


class BurpMcpCapabilityError(BurpMcpError):
    """Raised when the installed Burp extension lacks required MCP tools."""


@dataclass(frozen=True)
class BurpMcpConfig:
    """Connection settings for the Burp Suite MCP extension.

    The PortSwigger mcp-server exposes SSE on ``127.0.0.1:9876`` by default
    (configurable in the extension's "Advanced options").  ``transport`` is
    ``sse``, ``streamable-http``, or ``stdio``.  ``token`` is optional and only
    meaningful when the extension requires a bearer token.

    ``project_alias`` / ``session_alias`` are ChainsawRecon-side labels; the
    extension itself has no session/project concept, so these are carried for
    provenance in artifacts and traces, not passed to Burp.
    """
    url: str = ""
    transport: str = "sse"  # sse | streamable-http | stdio
    token: str = ""
    project_alias: str = ""
    session_alias: str = ""


@dataclass
class BurpMcpResult:
    """Result envelope for every adapter operation.

    ``ok`` indicates transport/protocol success.  ``content`` is a compact,
    model-facing string; full bodies are never dropped into the prompt here
    (they are persisted as artifacts by the caller).  ``meta`` carries
    structured context such as capability lists, tool names, and parse errors.
    """
    ok: bool
    content: str
    meta: dict[str, Any] = field(default_factory=dict)