"""JSON-RPC 2.0 transports for the Burp MCP adapter.

Supports SSE (the PortSwigger default), streamable-http, and stdio.  The
transport layer is deliberately free of any tool-name or semantic knowledge:
it only moves JSON-RPC messages, so a change to the extension's tool set never
requires touching this file.
"""
from __future__ import annotations

import json
import subprocess
from typing import Any
from urllib import request as urllib_request
from urllib.parse import urljoin

try:
    import requests
except ImportError:  # pragma: no cover - fall back to urllib when requests is absent
    requests = None


# Endpoint paths.  The PortSwigger extension serves SSE on a bare base URL
# (http://127.0.0.1:9876 by default) via the Kotlin MCP SDK, which also accepts
# the conventional /sse + /message split.  These constants are best-effort
# fallbacks; discovery is attempted first.
SSE_ENDPOINT = "/sse"
MESSAGE_ENDPOINT = "/message"
STREAMABLE_HTTP_ENDPOINT = "/mcp"

MCP_PROTOCOL_VERSION = "2025-06-18"


class JsonRpcTransport:
    """A transport that POSTs JSON-RPC messages and returns (content, status, meta)."""

    def __init__(self, transport: str, url: str, headers: dict[str, str]) -> None:
        self.transport = transport
        self.url = url
        self.headers = headers
        self._sse_message_url: str | None = None

    def post(self, payload: dict[str, Any]) -> tuple[str, int, dict[str, Any]]:
        if self.transport == "stdio":
            return self._post_stdio(payload)
        return self._post_http(payload)

    # ── HTTP (SSE / streamable-http) ────────────────────────────────────────

    def _post_http(self, payload: dict[str, Any]) -> tuple[str, int, dict[str, Any]]:
        body = json.dumps(payload).encode("utf-8")
        url, headers = self._http_target()
        timeout = 60
        try:
            if requests is not None:
                resp = requests.post(url, data=body, headers=headers, timeout=timeout)
                content = resp.text
                status = resp.status_code
                if not resp.ok:
                    return "", status, {"error": f"HTTP {resp.status_code}: {resp.text[:500]}"}
            else:
                req = urllib_request.Request(url, data=body, headers=headers, method="POST")
                with urllib_request.urlopen(req, timeout=timeout) as response:
                    content = response.read().decode("utf-8", errors="replace")
                status = 200
        except Exception as exc:
            return "", 0, {"error": f"{type(exc).__name__}: {exc}"}
        if content.lstrip().startswith("event:"):
            content = _extract_sse_data(content)
        return content, status, {}

    def _http_target(self) -> tuple[str, dict[str, str]]:
        if self.transport == "sse":
            if not self._sse_message_url:
                self._sse_message_url = self._discover_sse_message_url()
            url = self._sse_message_url or (self.url.rstrip("/") + MESSAGE_ENDPOINT)
        else:  # streamable-http
            url = self.url.rstrip("/") + STREAMABLE_HTTP_ENDPOINT
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **self.headers,
        }
        return url, headers

    def _discover_sse_message_url(self) -> str | None:
        """Read the SSE endpoint's ``endpoint`` event to learn the POST URL."""
        url = self.url.rstrip("/") + SSE_ENDPOINT
        headers = {"Accept": "text/event-stream", **self.headers}
        try:
            if requests is not None:
                response = requests.get(url, headers=headers, stream=True, timeout=10)
                if not response.ok:
                    response.close()
                    return None
                try:
                    for raw_line in response.iter_lines(decode_unicode=True):
                        line = (raw_line or "").strip()
                        if line.startswith("data:") and line[5:].strip():
                            return urljoin(url, line[5:].strip())
                finally:
                    response.close()
                return None
            req = urllib_request.Request(url, headers=headers, method="GET")
            with urllib_request.urlopen(req, timeout=10) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line.startswith("data:") and line[5:].strip():
                        return urljoin(url, line[5:].strip())
        except Exception:
            return None
        return None

    # ── stdio ───────────────────────────────────────────────────────────────

    def _post_stdio(self, payload: dict[str, Any]) -> tuple[str, int, dict[str, Any]]:
        # The ``url`` field doubles as the stdio command (e.g. ``npx`` or a path).
        method = payload.get("method", "")
        cmd = self.url or "npx"
        args = ["mcp-request", json.dumps(payload)]
        try:
            completed = subprocess.run(
                [cmd, *args],
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=60,
            )
        except Exception as exc:
            return "", 0, {"error": f"{type(exc).__name__}: {exc}"}
        if completed.returncode != 0:
            return "", completed.returncode, {"error": completed.stderr[:2000]}
        return completed.stdout[:8000], 0, {}

    def get(self, path: str) -> tuple[str, int, dict[str, Any]]:
        """GET a resource (used for the stdio health/list probes)."""
        cmd = self.url or "npx"
        try:
            completed = subprocess.run(
                [cmd, path],
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=30,
            )
        except Exception as exc:
            return "", 0, {"error": f"{type(exc).__name__}: {exc}"}
        if completed.returncode != 0:
            return completed.stderr[:2000], completed.returncode, {"error": completed.stderr[:2000]}
        return completed.stdout[:12000], 0, {}


def _extract_sse_data(content: str) -> str:
    """Extract the ``data:`` payload lines from an SSE response body."""
    lines = content.splitlines()
    data_lines = [line[5:].strip() for line in lines if line.startswith("data:")]
    return "\n".join(data_lines) if data_lines else content