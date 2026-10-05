"""The Burp MCP client: capability discovery plus high-level operations.

This is the only module that knows how ChainsawRecon's semantic actions map to
the extension's real primitives.  The mapping is:

* ``search_captured_requests`` → ``get_proxy_http_history`` /
  ``get_proxy_http_history_regex``
* ``get_captured_request`` / ``get_captured_response`` → read history, select
  by id, return the request/response half.
* ``replay_captured_request`` → read history, apply the whitelisted patch
  locally, then ``send_http_1_request``.
* ``create_repeater_experiment`` → read history, then ``create_repeater_tab``.
* ``compare_captured_responses`` → read two history entries and diff locally.

There is no extension tool for a site map, session status, or message compare,
so those concepts are deliberately *not* exposed here.
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

from .parsing import (
    compact_history,
    extract_mcp_text,
    extract_tool_names,
    parse_history_entries,
)
from .patch import apply_request_patch, parse_patch
from .schema import (
    CORE_BURP_CAPABILITIES,
    OPTIONAL_BURP_CAPABILITIES,
    DEFAULT_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
)
from .transport import JsonRpcTransport, MCP_PROTOCOL_VERSION
from .types import BurpMcpCapabilityError, BurpMcpConfig, BurpMcpResult


class BurpMcpClient:
    """High-level Burp MCP adapter speaking standard MCP JSON-RPC 2.0."""

    def __init__(self, config: BurpMcpConfig) -> None:
        self.config = config
        headers: dict[str, str] = {}
        if config.token:
            headers["Authorization"] = f"Bearer {config.token}"
        self._transport = JsonRpcTransport(config.transport, config.url, headers)
        self._capabilities: set[str] = set()
        self._resolved: dict[str, str] = {}
        self._discovered = False
        self._request_id = 0

    # ------------------------------------------------------------------
    # JSON-RPC 2.0 helpers
    # ------------------------------------------------------------------

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _build_request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            payload["params"] = params
        return payload

    def _parse_response(self, content: str) -> tuple[bool, Any, dict[str, Any]]:
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, ValueError):
            return False, content, {"parse_error": True}
        if isinstance(data, dict):
            if data.get("error") is not None:
                err = data["error"]
                return False, str(err.get("message", "unknown MCP error")), {"mcp_error_code": err.get("code", -32000)}
            if "result" in data:
                return True, data["result"], {}
        return False, content, {"unexpected_response": True}

    # ------------------------------------------------------------------
    # Discovery and health
    # ------------------------------------------------------------------

    def health(self) -> BurpMcpResult:
        request = self._build_request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "chainsawrecon", "version": "1.0"},
            },
        )
        content, status, meta = self._transport.post(request)
        if not content:
            return BurpMcpResult(False, f"Burp MCP health check failed: {meta.get('error', 'no response')}", {"transport": self.config.transport, **meta})
        ok, result, parse_meta = self._parse_response(content)
        if not ok:
            return BurpMcpResult(False, f"Burp MCP initialize failed: {result}", {"transport": self.config.transport, **parse_meta})
        try:
            self._transport.post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:
            pass
        return BurpMcpResult(True, json.dumps(result, ensure_ascii=False), {"transport": self.config.transport, "status": status})

    def list_tools(self) -> BurpMcpResult:
        request = self._build_request("tools/list")
        content, status, meta = self._transport.post(request)
        if not content:
            return BurpMcpResult(False, f"Burp MCP tools listing failed: {meta.get('error', 'no response')}", {"transport": self.config.transport, **meta})
        ok, result, parse_meta = self._parse_response(content)
        if not ok:
            return BurpMcpResult(False, f"Burp MCP tools listing error: {result}", {"transport": self.config.transport, **parse_meta})
        return BurpMcpResult(True, json.dumps(result, ensure_ascii=False), {"transport": self.config.transport, "status": status})

    def discover_capabilities(self) -> BurpMcpResult:
        """Discover tools and validate the core requirements.

        Returns a result with ``meta['tools']``, ``meta['resolved']``, and
        ``meta['missing_tools']``.  Raises BurpMcpCapabilityError when a core
        tool is absent, but only after recording the discovered set.
        """
        result = self.list_tools()
        if not result.ok:
            return result
        try:
            payload = json.loads(result.content or "{}")
        except (json.JSONDecodeError, ValueError):
            return BurpMcpResult(False, "Burp MCP capability discovery returned non-JSON output.", {"discovery_failed": True})
        tools = extract_tool_names(payload)
        self._capabilities = set(tools)
        self._resolved = {name: name for name in CORE_BURP_CAPABILITIES + OPTIONAL_BURP_CAPABILITIES if name in tools}
        self._discovered = True
        missing = [name for name in CORE_BURP_CAPABILITIES if name not in tools]
        optional_missing = [name for name in OPTIONAL_BURP_CAPABILITIES if name not in tools]
        if missing:
            detail = (
                "The installed Burp MCP extension is missing required tools: "
                + ", ".join(missing)
                + ". Configure the extension via Burp → Extensions → MCP and expose "
                + "Proxy/Session/Repeater capabilities."
            )
            raise BurpMcpCapabilityError(detail)
        return BurpMcpResult(
            True,
            f"Burp MCP ready with {len(tools)} tools: {', '.join(sorted(tools)[:40])}",
            {"capabilities": sorted(tools), "resolved": self._resolved, "missing_tools": missing, "optional_missing": optional_missing},
        )

    # ------------------------------------------------------------------
    # Primitive invocation
    # ------------------------------------------------------------------

    def _invoke(self, tool: str, args: dict[str, Any]) -> BurpMcpResult:
        if not self._discovered:
            try:
                self.discover_capabilities()
            except BurpMcpCapabilityError as exc:
                return BurpMcpResult(False, str(exc), {"capability_error": True})
        if tool not in self._capabilities:
            return BurpMcpResult(False, f"Burp MCP tool '{tool}' is not available from the installed extension.", {"tool_missing": True, "tool": tool})
        request = self._build_request("tools/call", {"name": tool, "arguments": args})
        content, status, meta = self._transport.post(request)
        if not content:
            return BurpMcpResult(False, f"Burp MCP call to '{tool}' failed: {meta.get('error', 'no response')}", {"transport": self.config.transport, "tool": tool, **meta})
        ok, result, parse_meta = self._parse_response(content)
        if not ok:
            return BurpMcpResult(False, f"Burp MCP tool '{tool}' error: {result}", {"transport": self.config.transport, "tool": tool, **parse_meta})
        if isinstance(result, dict):
            if result.get("isError"):
                text = extract_mcp_text(result)
                return BurpMcpResult(False, text or "MCP tool returned isError=true", {"tool": tool, "is_error": True})
            text = extract_mcp_text(result)
            if text is not None:
                return BurpMcpResult(True, text, {"tool": tool, "status": status})
            return BurpMcpResult(True, json.dumps(result, ensure_ascii=False), {"tool": tool, "status": status})
        return BurpMcpResult(True, json.dumps(result, ensure_ascii=False), {"tool": tool, "status": status})

    def _history(self, query: str = "", limit: int = DEFAULT_HISTORY_LIMIT, offset: int = 0) -> BurpMcpResult:
        count = max(1, min(int(limit), MAX_HISTORY_LIMIT))
        if query and "get_proxy_http_history_regex" in self._capabilities:
            return self._invoke("get_proxy_http_history_regex", {"regex": query, "count": count, "offset": offset})
        if query:
            # Regex variant absent: fetch plain history and filter locally.
            result = self._invoke("get_proxy_http_history", {"count": count, "offset": offset})
            if result.ok:
                result.content = _filter_history_by_query(result.content, query, limit)
            return result
        return self._invoke("get_proxy_http_history", {"count": count, "offset": offset})

    def _find_entry(self, request_id: str) -> tuple[dict[str, Any] | None, BurpMcpResult | None]:
        """Locate a history entry. Returns (entry, None) or (None, error).

        The extension's serialized history items have no ``id`` field, so
        :func:`parse_history_entries` synthesizes one as ``<index>-<hash>``.
        Accept a match on that synthesized id, on the bare page index
        (``"3"``), or on the hash suffix (``"a1b2c3d4"``) so the model can
        address an entry however it appeared in a search listing.
        """
        result = self._invoke("get_proxy_http_history", {"count": MAX_HISTORY_LIMIT, "offset": 0})
        if not result.ok:
            return None, result
        entries = parse_history_entries(result.content)
        wanted = str(request_id).strip()
        for index, entry in enumerate(entries):
            entry_id = str(entry.get("id", ""))
            hash_suffix = entry_id.rsplit("-", 1)[-1] if "-" in entry_id else ""
            if wanted == entry_id or wanted == str(index) or (hash_suffix and wanted == hash_suffix):
                return entry, None
        return None, BurpMcpResult(
            False,
            f"No captured request with id '{request_id}' in the latest history page. "
            f"Use search_captured_requests to list entries and their synthesized ids.",
            {"request_id": request_id, "entry_count": len(entries)},
        )

    # ------------------------------------------------------------------
    # High-level semantic operations
    # ------------------------------------------------------------------

    def search_history(self, query: str = "", target: str = "", limit: int = DEFAULT_HISTORY_LIMIT) -> BurpMcpResult:
        result = self._history(query, limit)
        if not result.ok:
            return result
        result.content = compact_history(result.content, limit)
        if target:
            result.meta["target"] = target
        return result

    def get_request(self, request_id: str) -> BurpMcpResult:
        entry, error = self._find_entry(request_id)
        if error:
            return error
        request = entry.get("request") if entry else None
        if not isinstance(request, str) or not request.strip():
            return BurpMcpResult(False, f"No request body found for id '{request_id}'.", {"request_id": request_id})
        return BurpMcpResult(True, request, {"request_id": request_id, "source": "burp_proxy_history"})

    def get_response(self, request_id: str) -> BurpMcpResult:
        entry, error = self._find_entry(request_id)
        if error:
            return error
        response = entry.get("response") if entry else None
        if not isinstance(response, str) or not response.strip():
            return BurpMcpResult(False, f"No response body found for id '{request_id}'.", {"request_id": request_id})
        return BurpMcpResult(True, response, {"request_id": request_id, "source": "burp_proxy_history"})

    def replay_request(self, request_id: str, patch: dict[str, Any] | None, target: str = "") -> BurpMcpResult:
        entry, error = self._find_entry(request_id)
        if error:
            return error
        raw_request = entry.get("request") if entry else None
        if not isinstance(raw_request, str) or not raw_request.strip():
            return BurpMcpResult(False, f"No request body found for id '{request_id}'.", {"request_id": request_id})
        patched = apply_request_patch(raw_request, patch or {})
        hostname, port, uses_https = _target_from_entry(entry, raw_request)
        return self._invoke("send_http_1_request", {"content": patched, "targetHostname": hostname, "targetPort": port, "usesHttps": uses_https})

    def create_repeater_experiment(self, request_id: str, target: str = "") -> BurpMcpResult:
        if "create_repeater_tab" not in self._capabilities:
            return BurpMcpResult(False, "create_repeater_tab is not available from the installed extension.", {"tool_missing": True, "tool": "create_repeater_tab"})
        entry, error = self._find_entry(request_id)
        if error:
            return error
        raw_request = entry.get("request") if entry else None
        if not isinstance(raw_request, str) or not raw_request.strip():
            return BurpMcpResult(False, f"No request body found for id '{request_id}'.", {"request_id": request_id})
        hostname, port, uses_https = _target_from_entry(entry, raw_request)
        result = self._invoke("create_repeater_tab", {"content": raw_request, "targetHostname": hostname, "targetPort": port, "usesHttps": uses_https})
        if result.ok:
            result.meta["request_id"] = request_id
        return result

    def compare_responses(self, baseline_id: str, candidate_id: str) -> BurpMcpResult:
        baseline, err_b = self._find_entry(baseline_id)
        if err_b:
            return err_b
        candidate, err_c = self._find_entry(candidate_id)
        if err_c:
            return err_c
        baseline_resp = baseline.get("response") if baseline else None
        candidate_resp = candidate.get("response") if candidate else None
        diff = _diff_responses(baseline_resp, candidate_resp)
        return BurpMcpResult(True, diff, {"baseline_id": baseline_id, "candidate_id": candidate_id, "compared_locally": True})

    def close(self) -> None:
        return None


# ── target / diff helpers ───────────────────────────────────────────────────

def _target_from_entry(entry: dict[str, Any], raw_request: str) -> tuple[str, int, bool]:
    """Derive (hostname, port, uses_https) from a history entry.

    Prefers the entry's ``httpService`` (host/port/secure) when present, then
    falls back to the Host header and request target.
    """
    hostname, port, uses_https = "", 0, False
    http_service = entry.get("httpService") or entry.get("http_service")
    if isinstance(http_service, dict):
        hostname = str(http_service.get("host", "") or "")
        raw_port = http_service.get("port")
        if raw_port:
            port = int(raw_port)
        uses_https = bool(http_service.get("secure", False) or http_service.get("tls", False))
    if not hostname:
        hostname, port, uses_https = _target_from_request(raw_request)
    if not port:
        port = 443 if uses_https else 80
    return hostname, port, uses_https


def _target_from_request(raw_request: str) -> tuple[str, int, bool]:
    """Parse host/port/tls from a raw HTTP request's Host header and target."""
    lines = raw_request.replace("\r\n", "\n").split("\n")
    host = ""
    uses_https = False
    port = 0
    for line in lines[1:]:
        if line.lower().startswith("host:"):
            host = line.split(":", 1)[1].strip()
            break
    # Absolute-form request target (https://host/path) overrides Host for TLS.
    request_line = lines[0].strip() if lines else ""
    fields = request_line.split()
    target = fields[1] if len(fields) > 1 else ""
    if target.startswith("https://"):
        uses_https = True
        parsed = urlparse(target)
        host = parsed.hostname or host
        port = parsed.port or 0
    elif target.startswith("http://"):
        parsed = urlparse(target)
        host = parsed.hostname or host
        port = parsed.port or 0
    # Host header may include an explicit port (host:8443).
    if ":" in host and not host.startswith("["):
        host_part, _, port_part = host.rpartition(":")
        if port_part.isdigit():
            host = host_part
            port = port or int(port_part)
    return host, port, uses_https


def _diff_responses(baseline: Any, candidate: Any) -> str:
    """Compact local diff of two response strings for the model."""
    b = baseline if isinstance(baseline, str) else ""
    c = candidate if isinstance(candidate, str) else ""
    if not b and not c:
        return "Both responses are empty."
    if b == c:
        return "Responses are identical."
    b_status = _response_status(b)
    c_status = _response_status(c)
    lines = ["Responses differ:"]
    if b_status != c_status:
        lines.append(f"  status: {b_status or '?'} → {c_status or '?'}")
    lines.append(f"  baseline length: {len(b)}; candidate length: {len(c)}")
    lines.append(f"  baseline head: {_head(b)}")
    lines.append(f"  candidate head: {_head(c)}")
    return "\n".join(lines)


def _response_status(response: str) -> str:
    first_line = response.split("\n", 1)[0].strip() if response else ""
    return first_line.split(" ", 1)[0] if first_line else ""


def _head(text: str, limit: int = 160) -> str:
    snippet = text.strip().replace("\r\n", " ")
    return snippet if len(snippet) <= limit else snippet[:limit] + "…"


def _filter_history_by_query(content: str, query: str, limit: int) -> str:
    """Local filter fallback when the regex variant is absent."""
    entries = parse_history_entries(content)
    lowered = query.lower()
    matched = []
    for entry in entries:
        request = entry.get("request")
        response = entry.get("response")
        haystack = f"{entry.get('url', '')} {request if isinstance(request, str) else ''} {response if isinstance(response, str) else ''}".lower()
        if lowered in haystack:
            matched.append(entry)
    return json.dumps(matched[:limit], ensure_ascii=False)