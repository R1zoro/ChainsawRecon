from __future__ import annotations

"""Deterministic login/session pipeline for simple id+password web apps.

This module is the ChainsawRecon-side orchestration for the Playwright login
worker (:mod:`bounty_agent.login_worker`).  It owns three things:

1.  **LoginSpec loading** — the operator describes the login flow once in the
    engagement's auth JSON under a top-level ``"login"`` key.  Credentials are
    referenced by *environment variable name* (``username_env`` /
    ``password_env``); the secret values live in ``.env`` / ``secrets.env`` and
    never enter the spec file, the prompt, the trace, or artifacts.

2.  **Cookie-injection sessions** — when the operator has already captured a
    session manually (the auth JSON ``targets`` cookie groups), no login is
    performed: the pipeline validates the supplied cookies against a verify
    URL and maintains the operator-listed cookie names on renewal.

3.  **Renewal** — ``renew_session`` re-executes the login (credentials mode) or
    re-applies the maintained cookies (injection mode), then re-verifies and
    updates the :class:`~bounty_agent.session_manager.SessionManager` lane.

Subdomain-wide note: a session is scoped to the cookie domains the target
sets.  Subdomains that are in scope but carry no session stay on the
unauthenticated lane (httpx/katana/nuclei via the mapping worker); the session
``domains`` tuple records exactly which hosts the lane covers.
"""

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class LoginSpec:
    login_url: str
    username_env: str = "CHAINSAW_AUTH_USERNAME"
    password_env: str = "CHAINSAW_AUTH_PASSWORD"
    username_selector: str = ""
    password_selector: str = ""
    submit_selector: str = ""
    success_url_contains: str = ""
    success_selector: str = ""
    verify_url: str = ""
    verify_indicator: str = ""
    headless: bool = True
    session_alias: str = "main-user"
    role: str | None = None
    tenant: str | None = None
    # Cookie names the operator wants preserved/renewed across renewals
    # (e.g. a long-lived "remember_me" alongside the short-lived session id).
    maintain_cookies: tuple[str, ...] = ()

    @property
    def host(self) -> str:
        return (urlparse(self.login_url).hostname or "").lower()


@dataclass(frozen=True)
class LoginOutcome:
    success: bool
    final_url: str = ""
    title: str = ""
    cookies: tuple[dict[str, Any], ...] = ()
    verify_status: int | None = None
    verify_ok: bool | None = None
    error: str = ""

    @property
    def cookie_map(self) -> dict[str, str]:
        return {str(c.get("name")): str(c.get("value")) for c in self.cookies if c.get("name")}

    @property
    def cookie_domains(self) -> tuple[str, ...]:
        domains = {
            str(c.get("domain", "")).lstrip(".").lower()
            for c in self.cookies if c.get("domain")
        }
        return tuple(sorted(d for d in domains if d))


def load_login_spec(auth_context_path: Path | None) -> LoginSpec | None:
    """Read the top-level ``"login"`` block from the engagement auth JSON."""
    if auth_context_path is None or not auth_context_path.exists():
        return None
    try:
        raw = json.loads(auth_context_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    block = raw.get("login")
    if not isinstance(block, dict) or not block.get("url"):
        return None
    return LoginSpec(
        login_url=str(block["url"]),
        username_env=str(block.get("username_env", "CHAINSAW_AUTH_USERNAME")),
        password_env=str(block.get("password_env", "CHAINSAW_AUTH_PASSWORD")),
        username_selector=str(block.get("username_selector", "")),
        password_selector=str(block.get("password_selector", "")),
        submit_selector=str(block.get("submit_selector", "")),
        success_url_contains=str(block.get("success_url_contains", "")),
        success_selector=str(block.get("success_selector", "")),
        verify_url=str(block.get("verify_url", "")),
        verify_indicator=str(block.get("verify_indicator", "")),
        headless=bool(block.get("headless", True)),
        session_alias=str(block.get("session_alias", "main-user")),
        role=block.get("role") or None,
        tenant=block.get("tenant") or None,
        maintain_cookies=tuple(str(c) for c in block.get("maintain_cookies", [])),
    )


def worker_spec_payload(spec: LoginSpec, *, verify_only: bool = False,
                        cookies: dict[str, str] | None = None) -> dict[str, Any]:
    """Serialize the spec for the worker.  Contains NO secret values — only the
    names of the environment variables the worker should read them from."""
    payload: dict[str, Any] = {
        "login_url": spec.login_url,
        "username_env": spec.username_env,
        "password_env": spec.password_env,
        "username_selector": spec.username_selector,
        "password_selector": spec.password_selector,
        "submit_selector": spec.submit_selector,
        "success_url_contains": spec.success_url_contains,
        "success_selector": spec.success_selector,
        "verify_url": spec.verify_url,
        "verify_indicator": spec.verify_indicator,
        "headless": spec.headless,
    }
    if verify_only:
        payload["verify_only"] = True
        payload["cookies"] = dict(cookies or {})
    return payload


def parse_login_output(text: str) -> LoginOutcome:
    """Parse the worker's JSON output file, tolerating partial writes."""
    try:
        raw = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return LoginOutcome(False, error="login worker produced no readable output")
    if not isinstance(raw, dict):
        return LoginOutcome(False, error="login worker output was not a JSON object")
    cookies = raw.get("cookies")
    return LoginOutcome(
        success=bool(raw.get("success")),
        final_url=str(raw.get("final_url", "")),
        title=str(raw.get("title", "")),
        cookies=tuple(c for c in (cookies or []) if isinstance(c, dict)),
        verify_status=raw.get("verify_status") if isinstance(raw.get("verify_status"), int) else None,
        verify_ok=raw.get("verify_ok") if isinstance(raw.get("verify_ok"), bool) else None,
        error=str(raw.get("error", "")),
    )


def merge_maintained_cookies(fresh: dict[str, str], prior: dict[str, str],
                             maintain: tuple[str, ...]) -> dict[str, str]:
    """Overlay operator-maintained cookies onto a fresh capture.

    If the fresh login did not re-issue a maintained cookie (e.g. a remember-me
    token the server only sets once), keep the prior value so renewal does not
    silently drop it.
    """
    merged = dict(fresh)
    for name in maintain:
        if name not in merged and name in prior:
            merged[name] = prior[name]
    return merged


def render_session_line(alias: str, status: str, mechanism: str, *,
                        role: str | None = None, domains: tuple[str, ...] = (),
                        failure: str = "") -> str:
    line = f"- {alias}: {status} ({mechanism})"
    if role:
        line += f" role={role}"
    if domains:
        line += f" domains={','.join(domains[:5])}"
    if failure:
        line += f" failure={failure}"
    return line
