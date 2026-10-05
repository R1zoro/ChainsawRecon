"""Parsing helpers for the Burp MCP adapter.

The MCP wire format and the extension's serialized history/issue shapes are
tolerated defensively here: the adapter must keep working when the extension
adds or renames a field, so every reader falls back to a safe default instead
of raising.
"""
from __future__ import annotations

import json
from typing import Any


def extract_tool_names(payload: Any) -> set[str]:
    """Extract tool names from an MCP ``tools/list`` result payload.

    MCP ``tools/list`` returns ``{"tools":[{"name":"...","description":"...",
    "inputSchema":{...}}]}``, but bridges differ; accept the common variants.
    """
    names: set[str] = set()
    if isinstance(payload, dict):
        tools = payload.get("tools") or payload.get("result") or payload.get("data") or []
    elif isinstance(payload, list):
        tools = payload
    else:
        tools = []
    if isinstance(tools, dict):
        tools = list(tools.keys())
    for item in tools:
        if isinstance(item, str):
            names.add(item)
        elif isinstance(item, dict):
            name = item.get("name") or item.get("tool")
            if isinstance(name, str):
                names.add(name)
            params = item.get("parameters") or item.get("inputSchema", {})
            if isinstance(params, dict):
                # Some bridges surface parameter keys as tool-like names.
                names.update(str(k) for k in params.keys())
    return names


def extract_mcp_text(result: dict[str, Any]) -> str | None:
    """Extract text content from an MCP ``tools/call`` result.

    MCP result format: ``{"content":[{"type":"text","text":"..."}],
    "isError":false}``.  Returns None when the result is structured (non-text)
    rather than a text block.
    """
    content = result.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("text"):
                parts.append(str(item["text"]))
        if parts:
            return "\n".join(parts)
    return None


def extract_sse_data(content: str) -> str:
    """Extract the ``data:`` payload lines from an SSE response body."""
    lines = content.splitlines()
    data_lines = [line[5:].strip() for line in lines if line.startswith("data:")]
    return "\n".join(data_lines) if data_lines else content


def _loads(value: str) -> Any:
    """Parse JSON defensively; return the raw string on any failure."""
    if not value or not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError, ValueError):
        return value


def parse_history_entries(content: str) -> list[dict[str, Any]]:
    """Normalize a history read-back payload into a list of entry dicts.

    The real PortSwigger extension does NOT return a JSON array.  Its
    ``mcpPaginatedTool`` joins serialized history items with a blank line
    (``"\\n\\n"``), and each item is a JSON object that may have been truncated
    to 5000 chars with a literal ``... (truncated)`` marker — making it invalid
    JSON.  Each serialized ``ProxyHttpRequestResponse`` carries only
    ``{request, response, notes}``: there is **no ``id``, ``status``,
    ``httpService`` or ``url``** field on the wire.

    So this parser (1) splits the blank-line-joined blob, (2) tolerates
    truncated/invalid objects by keeping the raw text, and (3) synthesizes a
    stable ``id`` (page index + request-line hash) so the rest of the adapter
    can address a captured request.  It also still accepts a clean JSON array
    or ``{"items":[...]}`` wrapper for bridges that emit one.
    """
    parsed = _loads(content)
    if isinstance(parsed, list):
        return [_normalize_entry(e, i) for i, e in enumerate(parsed) if isinstance(e, dict)]
    if isinstance(parsed, dict):
        for key in ("items", "history", "results", "entries"):
            value = parsed.get(key)
            if isinstance(value, list):
                return [_normalize_entry(e, i) for i, e in enumerate(value) if isinstance(e, dict)]
        return [_normalize_entry(parsed, 0)] if parsed else []
    # Real extension shape: blank-line-joined serialized items, possibly truncated.
    entries: list[dict[str, Any]] = []
    for index, chunk in enumerate(_split_history_blob(content)):
        entry = _loads(chunk)
        if isinstance(entry, dict):
            entries.append(_normalize_entry(entry, index))
        elif chunk.strip():
            # Truncated or non-JSON item: keep the raw text so the model can
            # still read it, keyed by a synthesized id.
            entries.append(_normalize_entry({"request": chunk.strip()}, index))
    return entries


def _split_history_blob(content: str) -> list[str]:
    """Split a blank-line-joined blob of serialized history items.

    Items are separated by one or more blank lines (``\\n\\n``).  A raw HTTP
    request/response body can itself contain blank lines, but each serialized
    item is a single JSON object on the wire, so we split on blank lines and
    then re-join consecutive fragments that belong to one JSON object (a `{`
    that has not yet closed).  Truncated objects are kept as-is.
    """
    chunks: list[str] = []
    current: list[str] = []
    depth = 0
    for raw_line in content.split("\n"):
        line = raw_line.rstrip("\r")
        if not line.strip():
            # Item boundary: JSON balanced, OR the item was cut at the 5000-char
            # cap — the extension's "... (truncated)" marker terminates it even
            # though the braces never close.
            truncated = current and current[-1].rstrip().endswith("... (truncated)")
            if current and (depth <= 0 or truncated):
                chunks.append("\n".join(current))
                current = []
                depth = 0
            elif current:
                current.append("")
            continue
        current.append(line)
        depth += line.count("{") - line.count("}")
    if current:
        chunks.append("\n".join(current))
    return chunks


def _normalize_entry(entry: dict[str, Any], index: int) -> dict[str, Any]:
    """Guarantee a stable ``id`` and best-effort ``url``/``method``/``status``.

    The wire format has no id, so we derive one from the page index plus a
    short hash of the request line.  ``url``/``method`` are parsed from the
    request line when absent so summaries and scope checks keep working.
    """
    if "id" not in entry or not entry.get("id"):
        entry = dict(entry)
        entry["id"] = _synthesize_id(entry, index)
    request = entry.get("request")
    if isinstance(request, str) and request.strip():
        method, url = _parse_request_line(request)
        entry.setdefault("method", method)
        if url:
            entry.setdefault("url", url)
    return entry


def _synthesize_id(entry: dict[str, Any], index: int) -> str:
    import hashlib

    request = entry.get("request")
    first_line = request.split("\n", 1)[0].strip() if isinstance(request, str) else ""
    digest = hashlib.sha1(first_line.encode("utf-8", errors="replace")).hexdigest()[:8]
    return f"{index}-{digest}"


def history_entry_summary(entry: dict[str, Any]) -> str:
    """Compact one-line summary of a history entry for the model."""
    method = str(entry.get("method", "") or "")
    url = str(entry.get("url", "") or "")
    host = ""
    status = str(entry.get("status", "") or "")
    http_service = entry.get("httpService") or entry.get("http_service") or {}
    if isinstance(http_service, dict):
        host = str(http_service.get("host", "") or "")
        if not status:
            status = str(http_service.get("status", "") or "")
    # Method/url are frequently absent from the envelope; parse the request line.
    request = entry.get("request")
    if isinstance(request, str) and (not method or not url):
        parsed_method, parsed_url = _parse_request_line(request)
        method = method or parsed_method
        url = url or parsed_url
    if not host and url:
        from urllib.parse import urlparse

        host = urlparse(url if "://" in url else f"//{url}").hostname or ""
    parts = [p for p in (method, url or host, status) if p]
    summary = " ".join(parts) if parts else "entry"
    # Always prefix the synthesized id so the model can pass it back to
    # get_captured_request / replay_captured_request / compare_captured_responses.
    entry_id = entry.get("id")
    return f"[{entry_id}] {summary}" if entry_id else summary


def _parse_request_line(request: str) -> tuple[str, str]:
    """Extract (method, target) from the first line of a raw HTTP request."""
    first_line = request.split("\n", 1)[0].strip() if request else ""
    fields = first_line.split()
    if len(fields) >= 2:
        return fields[0], fields[1]
    return "", ""


def compact_history(content: str, limit: int = 30) -> str:
    """Turn a history payload into a compact model-facing list."""
    entries = parse_history_entries(content)
    if not entries:
        return "No matching entries."
    lines = [history_entry_summary(e) for e in entries[:limit]]
    return "\n".join(f"- {line}" for line in lines if line)