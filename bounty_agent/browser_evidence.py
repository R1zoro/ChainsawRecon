from __future__ import annotations

"""Import browser evidence without requiring a live browser dependency.

HAR files are portable, user-supplied captures.  Treating them as evidence lets
the agent learn authenticated routes and request shapes while keeping execution
of any later replay subject to normal scope and authorization controls.
"""

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BrowserRequest:
    method: str
    url: str
    request_headers: dict[str, str]
    request_body: str
    response_status: int | None
    response_headers: dict[str, str]
    response_body_excerpt: str
    auth_context: str


@dataclass(frozen=True)
class BrowserSession:
    context: str
    cookies: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    cookie_scope: str | None = None
    samesite: str | None = None
    httponly: bool = False
    secure: bool = False
    browser_only: bool = True


@dataclass(frozen=True)
class BrowserCapture:
    path: str
    title: str
    requests: tuple[BrowserRequest, ...]
    sessions: tuple[BrowserSession, ...]


def parse_har(path: Path, *, max_entries: int = 2_000, body_limit: int = 4_000) -> BrowserCapture:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    log = data.get("log", {}) if isinstance(data, dict) else {}
    entries = log.get("entries", []) if isinstance(log, dict) else []
    if not isinstance(entries, list):
        raise ValueError("HAR log.entries must be a list")
    requests: list[BrowserRequest] = []
    sessions: dict[tuple[tuple[str, str], ...], BrowserSession] = {}
    for entry in entries[:max_entries]:
        if not isinstance(entry, dict):
            continue
        request = entry.get("request", {})
        response = entry.get("response", {})
        if not isinstance(request, dict) or not isinstance(response, dict):
            continue
        url = str(request.get("url") or "")
        method = str(request.get("method") or "GET").upper()
        if not url.startswith(("http://", "https://")):
            continue
        request_headers = _headers(request.get("headers"))
        response_headers = _headers(response.get("headers"))
        request_body = str((request.get("postData") or {}).get("text") or "")[:body_limit]
        content = response.get("content") or {}
        response_body = str(content.get("text") or "")[:body_limit] if isinstance(content, dict) else ""
        cookies = _cookies(request_headers.get("cookie", ""))
        auth_context = "authenticated" if cookies or "authorization" in request_headers else "guest"
        requests.append(BrowserRequest(
            method, url, request_headers, request_body,
            _as_int(response.get("status")), response_headers, response_body, auth_context,
        ))
        if cookies or "authorization" in request_headers:
            key = tuple(sorted(cookies.items())) + tuple(sorted((k, v) for k, v in request_headers.items() if k == "authorization"))
            sessions[key] = BrowserSession(
                context=auth_context,
                cookies=cookies,
                headers={k: v for k, v in request_headers.items() if k in {"authorization", "x-csrf-token"}},
                cookie_scope=_cookie_domain(response_headers.get("set-cookie", "")),
                samesite=_attribute(response_headers.get("set-cookie", ""), "samesite"),
                httponly="httponly" in response_headers.get("set-cookie", "").lower(),
                secure="secure" in response_headers.get("set-cookie", "").lower(),
            )
    title = str(log.get("creator", {}).get("name") or path.stem) if isinstance(log, dict) else path.stem
    return BrowserCapture(str(path), title, tuple(requests), tuple(sessions.values()))


def _headers(values: Any) -> dict[str, str]:
    if not isinstance(values, list):
        return {}
    return {str(item.get("name", "")).lower(): str(item.get("value", "")) for item in values if isinstance(item, dict) and item.get("name")}


def _cookies(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for piece in value.split(";"):
        name, separator, cookie_value = piece.strip().partition("=")
        if separator and name:
            result[name] = cookie_value
    return result


def _attribute(value: str, name: str) -> str | None:
    prefix = f"{name.lower()}="
    for part in value.split(";"):
        if part.strip().lower().startswith(prefix):
            return part.strip().split("=", 1)[1]
    return None


def _cookie_domain(value: str) -> str | None:
    return _attribute(value, "domain")


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
