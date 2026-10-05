"""Narrow-patch validation and local request rewriting.

The PortSwigger extension only accepts a *raw* HTTP request for its send and
Repeater primitives; it has no notion of a structured "patch".  So the safety
boundary the plan calls for lives here, on the ChainsawRecon side: the model
proposes a patch with a whitelisted set of families, and this module rewrites
the captured request deterministically before it is sent.  Raw request
construction by the model is impossible because only the six families below
are accepted.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Allowed patch families.  A patch may combine several (query + header, etc.)
# but any other key is rejected to prevent arbitrary raw request construction.
ALLOWED_PATCH_FAMILIES = frozenset({"query", "form", "json", "path", "header", "cookie"})


def parse_patch(patch: Any) -> dict[str, Any] | None:
    """Validate a model-proposed replay patch.

    Returns None when no patch is supplied, or the validated patch dict.
    Raises ValueError for any key outside the whitelisted families, or when the
    patch is not a mapping.
    """
    if patch is None:
        return None
    if not isinstance(patch, dict):
        raise ValueError("patch must be a JSON object with operational fields.")
    unknown = [key for key in patch if key not in ALLOWED_PATCH_FAMILIES]
    if unknown:
        raise ValueError(
            "Replay patch contains unrecognized keys: "
            + ", ".join(sorted(str(k) for k in unknown))
            + " — patch must use only: query, form, json, path, header, cookie."
        )
    if not patch:
        raise ValueError(
            "Patch must contain at least one of: query, form, json, path, header, cookie."
        )
    return patch


def apply_request_patch(raw_request: str, patch: dict[str, Any]) -> str:
    """Rewrite a raw HTTP/1.1 request according to a validated patch.

    ``raw_request`` is the full captured request (request line, headers, body).
    ``patch`` must already have passed :func:`parse_patch`.  Returns the
    rewritten raw request string.
    """
    if not patch:
        return raw_request
    method, target, headers, body = _parse_http_request(raw_request)

    # 1. path — replace the path portion of the request target, preserving any
    #    query string unless a query patch also replaces it.
    if "path" in patch:
        target = _set_path(target, str(patch["path"]))

    # 2. query — merge query parameters into the request target.
    if "query" in patch and isinstance(patch["query"], dict):
        target = _merge_query(target, {str(k): str(v) for k, v in patch["query"].items()})

    # 3. header — add/replace headers (case-insensitive).
    if "header" in patch and isinstance(patch["header"], dict):
        for name, value in patch["header"].items():
            _set_header(headers, str(name), str(value))

    # 4. cookie — merge into the Cookie header (preserving existing cookies).
    if "cookie" in patch and isinstance(patch["cookie"], dict):
        _merge_cookie(headers, {str(k): str(v) for k, v in patch["cookie"].items()})

    # 5. form — rewrite an application/x-www-form-urlencoded body.
    if "form" in patch and isinstance(patch["form"], dict):
        body = _merge_form(body, {str(k): str(v) for k, v in patch["form"].items()})
        _set_header(headers, "Content-Type", "application/x-www-form-urlencoded")

    # 6. json — replace the body with serialized JSON.
    if "json" in patch:
        body = _json_dumps(patch["json"])
        _set_header(headers, "Content-Type", "application/json")

    return _serialize_http_request(method, target, headers, body)


# ── low-level HTTP request parsing / serialization ─────────────────────────

def _parse_http_request(raw: str) -> tuple[str, str, list[tuple[str, str]], str]:
    """Split a raw HTTP/1.1 request into (method, target, headers, body).

    ``headers`` preserves order as a list of (name, value) pairs so that
    case-insensitive updates keep the original casing for untouched headers.
    """
    text = raw.replace("\r\n", "\n")
    head, sep, body = text.partition("\n\n")
    if not sep:
        head, sep, body = text.partition("\n")
    lines = head.split("\n")
    request_line = lines[0].strip() if lines else ""
    parts = request_line.split()
    method = parts[0] if parts else ""
    target = parts[1] if len(parts) > 1 else ""
    headers: list[tuple[str, str]] = []
    for line in lines[1:]:
        if not line.strip():
            continue
        if ":" in line:
            name, _, value = line.partition(":")
            headers.append((name.strip(), value.strip()))
    return method, target, headers, body


def _serialize_http_request(
    method: str, target: str, headers: list[tuple[str, str]], body: str
) -> str:
    head = f"{method} {target} HTTP/1.1"
    for name, value in headers:
        head += f"\n{name}: {value}"
    if body:
        return f"{head}\n\n{body}"
    return f"{head}\n\n"


# ── header helpers ──────────────────────────────────────────────────────────

def _find_header(headers: list[tuple[str, str]], name: str) -> int:
    lowered = name.lower()
    for index, (existing_name, _) in enumerate(headers):
        if existing_name.lower() == lowered:
            return index
    return -1


def _set_header(headers: list[tuple[str, str]], name: str, value: str) -> None:
    index = _find_header(headers, name)
    if index >= 0:
        headers[index] = (headers[index][0], value)
    else:
        headers.append((name, value))


def _merge_cookie(headers: list[tuple[str, str]], cookies: dict[str, str]) -> None:
    index = _find_header(headers, "Cookie")
    existing: dict[str, str] = {}
    if index >= 0:
        for pair in headers[index][1].split(";"):
            if "=" in pair:
                key, _, val = pair.partition("=")
                existing[key.strip()] = val.strip()
    merged = {**existing, **cookies}
    cookie_value = "; ".join(f"{k}={v}" for k, v in merged.items())
    if index >= 0:
        headers[index] = (headers[index][0], cookie_value)
    else:
        headers.append(("Cookie", cookie_value))


# ── request-target helpers ──────────────────────────────────────────────────

def _set_path(target: str, new_path: str) -> str:
    """Replace the path of an origin-form or absolute-form request target."""
    normalized = new_path if new_path.startswith("/") else f"/{new_path}"
    if target.startswith(("http://", "https://")):
        split = urlsplit(target)
        return urlunsplit((split.scheme, split.netloc, normalized, split.query, split.fragment))
    split = urlsplit(target)
    return urlunsplit(("", "", normalized, split.query, split.fragment))


def _merge_query(target: str, params: dict[str, str]) -> str:
    if target.startswith(("http://", "https://")):
        split = urlsplit(target)
        existing = dict(parse_qsl(split.query, keep_blank_values=True))
        merged = {**existing, **params}
        return urlunsplit((split.scheme, split.netloc, split.path, urlencode(merged), split.fragment))
    split = urlsplit(target)
    existing = dict(parse_qsl(split.query, keep_blank_values=True))
    merged = {**existing, **params}
    return urlunsplit(("", "", split.path, urlencode(merged), split.fragment))


def _merge_form(body: str, fields: dict[str, str]) -> str:
    existing = dict(parse_qsl(body, keep_blank_values=True))
    merged = {**existing, **fields}
    return urlencode(merged)


def _json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)