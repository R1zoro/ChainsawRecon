"""Auth profile detection, login adapters, and encrypted session storage.

Browser automation is optional: HTTP form login works without Playwright. Browser
login requires the optional webui/desktop extra and a visible Chromium window so
the operator can complete CAPTCHA/2FA.

Secrets are stored encrypted under the global Chainsaw home, never in project
settings, the journal, prompts, or reports.
"""

from __future__ import annotations

import json
import os
import re
import time
from base64 import urlsafe_b64decode
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from cryptography.fernet import Fernet

from .governor import RateLimitExceeded, RequestGovernor
from .workbench import Flow, ScopePolicy

LOGIN_PATHS = ("/login", "/signin", "/sign-in", "/auth", "/auth/login", "/api/auth/login")
CSRF_NAMES = {
    "csrf",
    "csrf_token",
    "_csrf",
    "_token",
    "authenticity_token",
    "__requestverificationtoken",
    "xsrf",
    "xsrf_token",
}
BOT_SIGNALS = {
    "cloudflare": ("cf-ray", "cf-mitigated", "server: cloudflare"),
    "datadome": ("x-datadome", "datadome"),
    "akamai": ("x-akamai", "akamai"),
    "imperva": ("x-iinfo", "incap_ses", "visid_incap"),
    "perimeterx": ("x-perimeterx", "px-captcha"),
    "aws_waf": ("x-amzn-waf-action",),
    "sucuri": ("x-sucuri",),
}
CHALLENGE_TEXT = (
    "just a moment",
    "verify you are human",
    "attention required",
    "access denied",
    "checking your browser",
)
CAPTCHA_MARKERS = ("g-recaptcha", "hcaptcha", "cf-turnstile", "recaptcha/api.js")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry_from_timestamp(value: float | int | None) -> str:
    if not value:
        return ""
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return ""


def _jwt_expiry(headers: dict[str, str]) -> str:
    value = next(
        (item for key, item in headers.items() if key.lower() == "authorization"),
        "",
    )
    if not value.lower().startswith("bearer "):
        return ""
    token = value[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        return ""
    try:
        payload = json.loads(urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        exp = payload.get("exp")
        return _expiry_from_timestamp(float(exp)) if exp else ""
    except (ValueError, TypeError, json.JSONDecodeError):
        return ""


class AuthError(RuntimeError):
    pass


class AuthNeedsOperator(AuthError):
    pass


@dataclass(frozen=True)
class LoginCandidate:
    url: str
    method: str
    fields: list[dict[str, str]]
    password_field: str = ""
    username_field: str = ""
    csrf_field: str = ""
    has_captcha: bool = False
    has_oauth: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "method": self.method,
            "fields": self.fields,
            "passwordField": self.password_field,
            "usernameField": self.username_field,
            "csrfField": self.csrf_field,
            "hasCaptcha": self.has_captcha,
            "hasOAuth": self.has_oauth,
        }


@dataclass
class AuthDetection:
    mechanisms: list[str] = field(default_factory=list)
    bot_protection: dict[str, Any] = field(
        default_factory=lambda: {
            "detected": False,
            "vendor": "",
            "confidence": 0.0,
            "signals": [],
        }
    )
    login_candidates: list[LoginCandidate] = field(default_factory=list)
    recommended_adapter: str = "operator"
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "mechanisms": self.mechanisms,
            "botProtection": self.bot_protection,
            "loginCandidates": [item.to_dict() for item in self.login_candidates],
            "recommendedAdapter": self.recommended_adapter,
            "warnings": self.warnings,
        }


_FORM_RE = re.compile(r"<form\b(?P<attrs>[^>]*)>(?P<body>.*?)</form>", re.I | re.S)
_INPUT_RE = re.compile(r"<input\b(?P<attrs>[^>]*)>", re.I | re.S)
_ATTR_RE = re.compile(r"([\w:-]+)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)


def _attrs(tag: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for match in _ATTR_RE.finditer(tag):
        value = match.group(2).strip("\"'")
        values[match.group(1).lower()] = value
    return values


def _headers_text(headers: dict[str, str]) -> str:
    return "\n".join(f"{key.lower()}: {value}" for key, value in headers.items())


def detect_bot_protection(headers: dict[str, str], body: str) -> dict[str, Any]:
    haystack = (_headers_text(headers) + "\n" + body[:20000]).lower()
    signals: list[str] = []
    vendor = ""
    confidence = 0.0
    for name, markers in BOT_SIGNALS.items():
        matched = [marker for marker in markers if marker in haystack]
        if matched:
            vendor = name
            signals.extend(matched)
            confidence = max(confidence, 0.9)
            break
    for marker in CHALLENGE_TEXT:
        if marker in haystack:
            signals.append(marker)
            confidence = max(confidence, 0.7)
    for marker in CAPTCHA_MARKERS:
        if marker in haystack:
            signals.append(marker)
            confidence = max(confidence, 0.8)
            vendor = vendor or "captcha"
    return {
        "detected": bool(signals),
        "vendor": vendor,
        "confidence": confidence,
        "signals": sorted(set(signals)),
    }


def parse_login_forms(url: str, body: str) -> list[LoginCandidate]:
    candidates: list[LoginCandidate] = []
    has_captcha = any(marker in body.lower() for marker in CAPTCHA_MARKERS)
    has_oauth = any(
        marker in body.lower()
        for marker in ("oauth", "openid", "samlrequest", "accounts.google.com", "login.microsoftonline.com")
    )
    for match in _FORM_RE.finditer(body):
        attrs = _attrs(match.group("attrs"))
        form_body = match.group("body")
        fields: list[dict[str, str]] = []
        password_field = ""
        username_field = ""
        csrf_field = ""
        for input_match in _INPUT_RE.finditer(form_body):
            input_attrs = _attrs(input_match.group("attrs"))
            name = input_attrs.get("name", "")
            input_type = input_attrs.get("type", "text").lower()
            if not name or input_type in {"submit", "button", "reset", "image", "file"}:
                continue
            field = {
                "name": name,
                "type": input_type,
                "value": input_attrs.get("value", ""),
            }
            fields.append(field)
            if input_type == "password" and not password_field:
                password_field = name
            if input_type in {"email", "text"} and not username_field:
                username_field = name
            if name.lower() in CSRF_NAMES:
                csrf_field = name
        action = urljoin(url, attrs.get("action", "") or url)
        method = (attrs.get("method") or "post").upper()
        score = (2 if password_field else 0) + (1 if has_oauth else 0)
        if password_field or "login" in action.lower() or "signin" in action.lower():
            if score:
                candidates.append(
                    LoginCandidate(
                        url=action,
                        method=method,
                        fields=fields,
                        password_field=password_field,
                        username_field=username_field,
                        csrf_field=csrf_field,
                        has_captcha=has_captcha,
                        has_oauth=has_oauth,
                    )
                )
    candidates.sort(key=lambda item: (bool(item.password_field), not item.has_captcha), reverse=True)
    return candidates


def detect_from_flow(flow: Flow) -> AuthDetection:
    detection = AuthDetection()
    headers = {key.lower(): value for key, value in flow.request_headers.items()}
    response_headers = {key.lower(): value for key, value in flow.response_headers.items()}
    auth = headers.get("authorization", "")
    if auth.lower().startswith("basic "):
        detection.mechanisms.append("basic")
    elif auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token.count(".") == 2:
            detection.mechanisms.append("jwt_bearer")
        else:
            detection.mechanisms.append("bearer")
    if any(key in headers for key in ("x-api-key", "api-key", "x-auth-token")):
        detection.mechanisms.append("api_key")
    if "cookie" in headers or "set-cookie" in response_headers:
        detection.mechanisms.append("cookie_session")
    if any(path in flow.path.lower() for path in LOGIN_PATHS):
        detection.mechanisms.append("login_page")
    detection.bot_protection = detect_bot_protection(response_headers, flow.response_body)
    candidates = parse_login_forms(flow.url, flow.response_body)
    detection.login_candidates.extend(candidates)
    if candidates and any(item.has_oauth for item in candidates):
        detection.mechanisms.append("oauth_or_sso")
    if detection.bot_protection["detected"]:
        detection.warnings.append(
            "Bot protection or CAPTCHA indicators were observed; browser login is recommended."
        )
    return detection


def detect_flows(flows: list[Flow]) -> AuthDetection:
    aggregated = AuthDetection()
    mechanisms: set[str] = set()
    candidates: dict[str, LoginCandidate] = {}
    bot: dict[str, Any] = {
        "detected": False,
        "vendor": "",
        "confidence": 0.0,
        "signals": [],
    }
    for flow in flows:
        item = detect_from_flow(flow)
        mechanisms.update(item.mechanisms)
        for candidate in item.login_candidates:
            candidates[candidate.url] = candidate
        if item.bot_protection["confidence"] > bot["confidence"]:
            bot = item.bot_protection
    aggregated.mechanisms = sorted(mechanisms)
    aggregated.bot_protection = bot
    aggregated.login_candidates = list(candidates.values())
    if bot["detected"] or any(item.has_captcha for item in candidates.values()):
        aggregated.recommended_adapter = "browser"
    elif candidates:
        aggregated.recommended_adapter = "http_form"
    elif any(item in mechanisms for item in ("basic", "bearer", "jwt_bearer", "api_key")):
        aggregated.recommended_adapter = "headers"
    else:
        aggregated.recommended_adapter = "operator"
    if bot["detected"]:
        aggregated.warnings.append(
            "Use a real browser and operator handover; do not bypass bot controls."
        )
    if "oauth_or_sso" in mechanisms:
        aggregated.warnings.append("OAuth/SSO login requires browser handover.")
    return aggregated


@dataclass
class AuthSession:
    profile_id: str
    project_id: str
    status: str = "none"
    cookies: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    storage_state: dict[str, Any] | None = None
    credentials: dict[str, str] = field(default_factory=dict)
    verified_at: str = ""
    expires_at: str = ""
    adapter: str = ""
    warning: str = ""

    def is_expired(self) -> bool:
        if not self.expires_at:
            return False
        try:
            expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        return expires <= datetime.now(timezone.utc)

    def public(self) -> dict[str, Any]:
        return {
            "profileId": self.profile_id,
            "projectId": self.project_id,
            "status": "expired" if self.is_expired() and self.status == "active" else self.status,
            "adapter": self.adapter,
            "verifiedAt": self.verified_at,
            "expiresAt": self.expires_at,
            "expired": self.is_expired(),
            "hasCookies": bool(self.cookies),
            "hasStorageState": bool(self.storage_state),
            "warning": self.warning,
        }

    def to_payload(self) -> dict[str, Any]:
        return {
            "profileId": self.profile_id,
            "projectId": self.project_id,
            "status": self.status,
            "cookies": self.cookies,
            "headers": self.headers,
            "storageState": self.storage_state,
            "credentials": self.credentials,
            "verifiedAt": self.verified_at,
            "expiresAt": self.expires_at,
            "adapter": self.adapter,
            "warning": self.warning,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> AuthSession:
        return cls(
            profile_id=str(payload.get("profileId", "")),
            project_id=str(payload.get("projectId", "")),
            status=str(payload.get("status", "none")),
            cookies=dict(payload.get("cookies") or {}),
            headers=dict(payload.get("headers") or {}),
            storage_state=payload.get("storageState"),
            credentials=dict(payload.get("credentials") or {}),
            verified_at=str(payload.get("verifiedAt", "")),
            expires_at=str(payload.get("expiresAt", "")),
            adapter=str(payload.get("adapter", "")),
            warning=str(payload.get("warning", "")),
        )


class AuthSessionStore:
    def __init__(self, home_root: Path, *, use_keyring: bool | None = None) -> None:
        self.root = home_root / "auth"
        self.root.mkdir(parents=True, exist_ok=True)
        self.key_path = self.root / "session.key"
        self.key_source = "file"
        key: bytes | None = None
        if use_keyring is None:
            use_keyring = os.environ.get("CHAINSAW_DISABLE_KEYRING", "") not in {"1", "true", "yes"}
        if use_keyring:
            try:
                import keyring  # type: ignore[import-not-found]

                stored = keyring.get_password("chainsawrecon", "auth-session-key")
                if not stored:
                    stored = Fernet.generate_key().decode("ascii")
                    keyring.set_password("chainsawrecon", "auth-session-key", stored)
                key = stored.encode("ascii")
                self.key_source = "keyring"
            except Exception:
                key = None
        if key is None:
            if not self.key_path.exists():
                self.key_path.write_bytes(Fernet.generate_key())
                try:
                    os.chmod(self.key_path, 0o600)
                except OSError:
                    pass
            key = self.key_path.read_bytes()
        self._fernet = Fernet(key)

    def _path(self, project_id: str, profile_id: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", profile_id)
        path = self.root / "sessions" / project_id / f"{safe}.enc"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def save(self, session: AuthSession) -> None:
        payload = json.dumps(session.to_payload(), ensure_ascii=False).encode("utf-8")
        self._path(session.project_id, session.profile_id).write_bytes(
            self._fernet.encrypt(payload)
        )

    def load(self, project_id: str, profile_id: str) -> AuthSession | None:
        path = self._path(project_id, profile_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(self._fernet.decrypt(path.read_bytes()))
        except Exception:
            return None
        if isinstance(payload, dict):
            return AuthSession.from_payload(payload)
        return None

    def delete(self, project_id: str, profile_id: str) -> None:
        path = self._path(project_id, profile_id)
        if path.exists():
            path.unlink()


def _request(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    policy: ScopePolicy,
    governor: RequestGovernor | None = None,
    **kwargs: Any,
) -> httpx.Response:
    decision = policy.check(url)
    if not decision.allowed:
        raise AuthError(f"auth request blocked by scope: {decision.reason}")
    if governor is not None:
        try:
            governor.acquire(url, method=method)
        except RateLimitExceeded as exc:
            raise AuthError(str(exc)) from exc
    try:
        response = client.request(method, url, **kwargs)
    finally:
        if governor is not None:
            governor.release(url)
    if governor is not None:
        governor.observe(url, response.status_code)
    final = policy.check(str(response.url))
    if not final.allowed:
        raise AuthError(f"auth redirect left scope: {final.reason}")
    return response


def _field_value(fields: list[dict[str, str]], name: str) -> str:
    for item in fields:
        if item["name"] == name:
            return str(item.get("value", ""))
    return ""


def http_login(
    *,
    profile: dict[str, Any],
    project_id: str,
    username: str,
    password: str,
    policy: ScopePolicy,
    governor: RequestGovernor | None = None,
    transport: httpx.BaseTransport | None = None,
    verify_cookies: bool = True,
) -> AuthSession:
    login_url = str(profile.get("loginUrl") or profile.get("login_url") or "")
    if not login_url:
        raise AuthError("auth profile has no loginUrl")
    if not username or not password:
        raise AuthError("username and password are required")
    verify_url = str(profile.get("verifyUrl") or profile.get("verify_url") or "")
    indicator = str(profile.get("verifyIndicator") or profile.get("verify_indicator") or "")
    timeout = float(profile.get("timeout") or 30)
    with httpx.Client(
        follow_redirects=True,
        timeout=timeout,
        trust_env=False,
        transport=transport,
        verify=bool(profile.get("verifyTls", True)),
    ) as client:
        response = _request(
            client,
            "GET",
            login_url,
            policy=policy,
            governor=governor,
        )
        if response.status_code >= 400:
            raise AuthError(f"login page returned HTTP {response.status_code}")
        candidates = parse_login_forms(str(response.url), response.text)
        if not candidates:
            raise AuthError("no login form found; use browser login")
        candidate = candidates[0]
        if candidate.has_captcha:
            raise AuthNeedsOperator("login form contains a CAPTCHA; use browser login")

        fields: dict[str, str] = {}
        for item in candidate.fields:
            if item["type"] == "hidden":
                fields[item["name"]] = item["value"]
        for key, value in dict(profile.get("extraFields") or {}).items():
            fields[str(key)] = str(value)
        user_field = str(
            profile.get("usernameField")
            or profile.get("username_field")
            or candidate.username_field
            or "username"
        )
        pass_field = str(
            profile.get("passwordField")
            or profile.get("password_field")
            or candidate.password_field
            or "password"
        )
        fields[user_field] = username
        fields[pass_field] = password

        login_response = _request(
            client,
            candidate.method,
            candidate.url,
            policy=policy,
            governor=governor,
            data=fields,
        )
        if login_response.status_code >= 400:
            raise AuthError(f"login POST returned HTTP {login_response.status_code}")

        cookies = {
            cookie.name: str(cookie.value or "") for cookie in client.cookies.jar
        }
        headers: dict[str, str] = {}
        cookie_expiry = max(
            (
                _expiry_from_timestamp(getattr(cookie, "expires", None))
                for cookie in client.cookies.jar
            ),
            default="",
        )
        expires_at = max(cookie_expiry, _jwt_expiry(headers))
        status = "needs_verification"
        warning = ""
        if verify_url:
            verified, warning = _verify(
                client,
                verify_url=verify_url,
                indicator=indicator,
                policy=policy,
                governor=governor,
                negative_control=verify_cookies,
                transport=transport,
            )
            status = "active" if verified else "failed"
        else:
            warning = "No verifyUrl configured; login succeeded but is unverified."
        session = AuthSession(
            profile_id=str(profile.get("id") or ""),
            project_id=project_id,
            status=status,
            cookies=cookies,
            headers=headers,
            credentials={"username": username, "password": password}
            if profile.get("persistence") == "credentials"
            else {},
            verified_at=_now() if status == "active" else "",
            expires_at=expires_at,
            adapter="http_form",
            warning=warning,
        )
        return session


def _verify(
    client: httpx.Client,
    *,
    verify_url: str,
    indicator: str,
    policy: ScopePolicy,
    governor: RequestGovernor | None,
    negative_control: bool,
    transport: httpx.BaseTransport | None,
) -> tuple[bool, str]:
    response = _request(
        client,
        "GET",
        verify_url,
        policy=policy,
        governor=governor,
    )
    if response.status_code >= 400:
        return False, f"verification request returned HTTP {response.status_code}"
    if not indicator:
        return False, "No verifyIndicator configured; cannot prove authentication."
    positive = indicator.lower() in response.text.lower()
    if not positive:
        return False, "Verification marker was not found."
    if negative_control:
        with httpx.Client(
            follow_redirects=True,
            timeout=client.timeout,
            trust_env=False,
            transport=transport,
        ) as anonymous:
            anonymous_response = _request(
                anonymous,
                "GET",
                verify_url,
                policy=policy,
                governor=governor,
            )
        if indicator.lower() in anonymous_response.text.lower():
            return False, "Verification marker is also visible without the session."
    return True, ""


def browser_login(
    *,
    profile: dict[str, Any],
    project_id: str,
    home_root: Path,
    username: str = "",
    password: str = "",
    policy: ScopePolicy,
    login_timeout: float = 300.0,
) -> AuthSession:
    """Open a real Chromium window and let the operator log in.

    Credentials are optional: if supplied, the adapter attempts a best-effort
    fill, but the operator remains responsible for CAPTCHA/2FA and final login.
    """

    login_url = str(profile.get("loginUrl") or profile.get("login_url") or "")
    if not login_url:
        raise AuthError("auth profile has no loginUrl")
    decision = policy.check(login_url)
    if not decision.allowed:
        raise AuthError(f"login URL is out of scope: {decision.reason}")
    try:
        from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]
    except ImportError as exc:
        raise AuthError(
            "browser login requires Playwright: uv sync --extra webui && uv run playwright install chromium"
        ) from exc
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(profile.get("id") or "profile"))
    profile_dir = home_root / "auth" / "browser" / project_id / safe
    profile_dir.mkdir(parents=True, exist_ok=True)
    playwright = sync_playwright().start()
    context = None
    try:
        context = playwright.chromium.launch_persistent_context(
            str(profile_dir),
            headless=bool(profile.get("headless", False)),
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(login_url, wait_until="domcontentloaded", timeout=login_timeout * 1000)
        selectors = profile.get("selectors") or {}
        if username and password:
            _best_effort_fill(
                page,
                username=username,
                password=password,
                username_selectors=list(selectors.get("username") or []),
                password_selectors=list(selectors.get("password") or []),
                submit_selectors=list(selectors.get("submit") or []),
            )
        verify_url = str(profile.get("verifyUrl") or profile.get("verify_url") or "")
        indicator = str(profile.get("verifyIndicator") or profile.get("verify_indicator") or "")
        deadline = time.monotonic() + login_timeout
        verified = False
        while time.monotonic() < deadline:
            if verify_url:
                page.goto(verify_url, wait_until="domcontentloaded", timeout=login_timeout * 1000)
                if indicator and indicator.lower() in page.content().lower():
                    verified = True
                    break
                page.goto(login_url, wait_until="domcontentloaded", timeout=login_timeout * 1000)
            elif "/login" not in page.url.lower() and "signin" not in page.url.lower():
                verified = True
                break
            page.wait_for_timeout(1000)
        if not verified:
            raise AuthNeedsOperator("operator did not complete login within the timeout")
        cookies_list = context.cookies()
        cookies = {
            str(item["name"]): str(item["value"])
            for item in cookies_list
            if item.get("name")
        }
        cookie_expiry = max(
            (
                _expiry_from_timestamp(item.get("expires"))
                for item in cookies_list
                if item.get("expires")
            ),
            default="",
        )
        storage_state = dict(context.storage_state())
        return AuthSession(
            profile_id=str(profile.get("id") or ""),
            project_id=project_id,
            status="active" if indicator else "needs_verification",
            cookies=cookies,
            storage_state=storage_state,
            credentials={"username": username, "password": password}
            if profile.get("persistence") == "credentials"
            else {},
            verified_at=_now() if verified and indicator else "",
            expires_at=cookie_expiry,
            adapter="browser",
            warning="" if indicator else "No verifyIndicator configured; login is unverified.",
        )
    finally:
        if context is not None:
            context.close()
        playwright.stop()


def _best_effort_fill(
    page: Any,
    *,
    username: str,
    password: str,
    username_selectors: list[str],
    password_selectors: list[str],
    submit_selectors: list[str],
) -> None:
    user_selectors = username_selectors or [
        "input[type='email']",
        "input[name='username']",
        "input[name='email']",
        "input[type='text']",
    ]
    pass_selectors = password_selectors or ["input[type='password']"]
    for selector in user_selectors:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0 and locator.is_visible():
                locator.fill(username)
                break
        except Exception:
            continue
    for selector in pass_selectors:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0 and locator.is_visible():
                locator.fill(password)
                break
        except Exception:
            continue
    for selector in submit_selectors or ["button[type='submit']", "input[type='submit']"]:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0 and locator.is_visible():
                locator.click()
                return
        except Exception:
            continue


def verify_session(
    session: AuthSession,
    *,
    verify_url: str,
    indicator: str,
    policy: ScopePolicy,
    governor: RequestGovernor | None = None,
    transport: httpx.BaseTransport | None = None,
) -> tuple[bool, str]:
    if not verify_url or not indicator:
        return False, "verifyUrl and verifyIndicator are required"
    with httpx.Client(
        follow_redirects=True,
        timeout=30,
        trust_env=False,
        transport=transport,
        cookies=session.cookies,
    ) as client:
        return _verify(
            client,
            verify_url=verify_url,
            indicator=indicator,
            policy=policy,
            governor=governor,
            negative_control=True,
            transport=transport,
        )
