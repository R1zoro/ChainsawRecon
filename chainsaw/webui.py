"""Browser-backed chat provider for web-only model interfaces.

This is deliberately an optional adapter. It drives a real Chromium profile that
the operator has already logged into. It does not store passwords, solve CAPTCHAs,
or bypass bot controls.

The adapter is fragile by nature: web UIs change. Selectors are configurable and
the operator can fix them from the provider config without code changes.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .providers import (
    ChatMessage,
    Completion,
    ProviderError,
    ProviderUnavailable,
)

DEFAULT_TIMEOUT = 120.0
DEFAULT_LOGIN_TIMEOUT = 300.0
DEFAULT_STABILITY = 1.6
DEFAULT_BUSY_RETRIES = 20
DEFAULT_BUSY_DELAY = 3.0


class WebUIError(ProviderError):
    pass


class WebUINeedsLogin(WebUIError):
    pass


class WebUIBlocked(WebUIError):
    pass


@dataclass
class WebUISelectors:
    input: list[str] = field(default_factory=list)
    send: list[str] = field(default_factory=list)
    assistant: list[str] = field(default_factory=list)
    login: list[str] = field(default_factory=list)
    challenge: list[str] = field(default_factory=list)
    stop: list[str] = field(default_factory=list)
    busy: list[str] = field(default_factory=list)

    @classmethod
    def for_engine(cls, engine: str) -> WebUISelectors:
        engine = (engine or "custom").lower()
        if engine in {"chatgpt", "openai-web"}:
            return cls(
                input=[
                    "#prompt-textarea",
                    ".ProseMirror[contenteditable='true']",
                    "[contenteditable='true']",
                    "textarea",
                ],
                send=[
                    "[data-testid='send-button']",
                    "button[aria-label*='Send']",
                    "button[aria-label*='Envoyer']",
                ],
                assistant=[
                    "[data-message-author-role='assistant']",
                    "[data-testid*='assistant']",
                    "[class*='assistant']",
                ],
                login=[
                    "button[data-testid='login-button']",
                    "text=Log in",
                    "text=Sign up",
                ],
                challenge=[
                    "text=Verify you are human",
                    "text=Just a moment",
                    "iframe[src*='captcha']",
                ],
                stop=[
                    "button[data-testid='stop-button']",
                    "button[aria-label*='Stop']",
                    "button:has-text('Stop generating')",
                ],
                busy=[],
            )
        if engine in {"deepseek", "deepseek-web"}:
            return cls(
                input=[
                    "textarea[placeholder*='DeepSeek']",
                    "textarea",
                    "[contenteditable='true']",
                ],
                send=[
                    "button[aria-label*='Send']",
                    "[role='button'][aria-label*='Send']",
                    "button:has-text('Send')",
                    "button[aria-label*='发送']",
                ],
                assistant=[
                    "[data-message-author-role='assistant']",
                    "[data-role='assistant']",
                    "[data-testid*='assistant']",
                    ".ds-markdown",
                    "[class*='assistant']",
                ],
                login=[
                    "input[type='password']",
                    "text=Log in",
                    "text=登录",
                ],
                challenge=[
                    "text=Verify",
                    "text=Just a moment",
                    "iframe[src*='captcha']",
                ],
                stop=[
                    "button[aria-label*='Stop']",
                    "button:has-text('Stop')",
                    "button:has-text('停止')",
                ],
                busy=[
                    "text=server is busy",
                    "text=temporarily unavailable",
                    "button:has-text('Continue')",
                    "button:has-text('继续')",
                ],
            )
        return cls(
            input=["[contenteditable='true']", "textarea"],
            send=["button[type='submit']", "button[aria-label*='Send']"],
            assistant=["[data-message-author-role='assistant']", "[class*='assistant']"],
            login=["input[type='password']"],
            challenge=["iframe[src*='captcha']"],
            stop=["button[aria-label*='Stop']", "button:has-text('Stop')"],
            busy=["text=server is busy", "button:has-text('Continue')"],
        )


@dataclass
class WebUIConfig:
    engine: str = "custom"
    url: str = ""
    model: str = ""
    profile_dir: Path = field(default_factory=lambda: Path.home() / ".chainsawrecon" / "webui")
    headless: bool = False
    timeout: float = DEFAULT_TIMEOUT
    login_timeout: float = DEFAULT_LOGIN_TIMEOUT
    stability_seconds: float = DEFAULT_STABILITY
    busy_max_retries: int = DEFAULT_BUSY_RETRIES
    busy_retry_seconds: float = DEFAULT_BUSY_DELAY
    selectors: WebUISelectors = field(default_factory=WebUISelectors)

    @classmethod
    def from_entry(cls, entry: dict[str, Any], *, model: str = "") -> WebUIConfig:
        engine = str(
            entry.get("engine")
            or entry.get("type")
            or "custom"
        ).strip().lower()
        if engine in {"webui", "browser"}:
            engine = "custom"
        raw_selectors = entry.get("selectors") or {}
        selected = WebUISelectors.for_engine(engine)
        if isinstance(raw_selectors, dict):
            for name in ("input", "send", "assistant", "login", "challenge", "stop", "busy"):
                value = raw_selectors.get(name)
                if isinstance(value, str):
                    setattr(selected, name, [value])
                elif isinstance(value, list):
                    setattr(selected, name, [str(item) for item in value if str(item)])
        profile = Path(
            str(
                entry.get("profileDir")
                or entry.get("profile_dir")
                or Path.home() / ".chainsawrecon" / "webui" / engine
            )
        ).expanduser()
        return cls(
            engine=engine,
            url=str(entry.get("url") or entry.get("baseUrl") or entry.get("base_url") or ""),
            model=model or str(entry.get("model") or ""),
            profile_dir=profile,
            headless=bool(entry.get("headless", False)),
            timeout=float(entry.get("timeout") or DEFAULT_TIMEOUT),
            login_timeout=float(entry.get("loginTimeout") or entry.get("login_timeout") or DEFAULT_LOGIN_TIMEOUT),
            stability_seconds=float(entry.get("stabilitySeconds") or DEFAULT_STABILITY),
            busy_max_retries=int(entry.get("busyMaxRetries") or entry.get("busy_max_retries") or DEFAULT_BUSY_RETRIES),
            busy_retry_seconds=float(entry.get("busyRetrySeconds") or DEFAULT_BUSY_DELAY),
            selectors=selected,
        )


def compose_prompt(messages: list[ChatMessage] | list[dict[str, str]]) -> str:
    parts: list[str] = []
    for item in messages:
        if isinstance(item, ChatMessage):
            role, content = item.role, item.content
        else:
            role = str(item.get("role", "user"))
            content = str(item.get("content", ""))
        if not content:
            continue
        parts.append(f"[{role.upper()}]\n{content}")
    return "\n\n".join(parts).strip()


_TOOL_FENCE = re.compile(r"```(?:tool_call|json)?\s*([\[{].*?[\]}])\s*```", re.S)
_TOOL_TAG = re.compile(
    r"<[｜|]tool[▁_]?call[▁_]?begin[｜|]>\s*(.*?)\s*<[｜|]tool[▁_]?call[▁_]?end[｜|]>",
    re.S,
)


def parse_tool_calls(text: str) -> list[dict[str, Any]]:
    """Extract tool-call objects from common web-model formats.

    Supports fenced tool_call/json blocks, DeepSeek-style tool tags, and raw
    JSON arrays. Returns only name/arguments objects; never executes anything.
    """

    candidates: list[str] = []
    candidates.extend(match.group(1) for match in _TOOL_FENCE.finditer(text))
    candidates.extend(match.group(1) for match in _TOOL_TAG.finditer(text))
    stripped = text.strip()
    if stripped.startswith("[") or stripped.startswith("{"):
        candidates.append(stripped)
    parsed: list[dict[str, Any]] = []
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        items = value if isinstance(value, list) else [value]
        for item in items:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("tool") or item.get("tool_name")
            arguments = item.get("arguments", item.get("args", item.get("input", {})))
            if not name:
                continue
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {"raw": arguments}
            parsed.append({"name": str(name), "arguments": arguments or {}})
    return parsed



class BrowserDriver:
    """Minimal browser interface, implemented by Playwright and by tests."""

    def start(self) -> None:
        return

    def close(self) -> None:
        return

    def ask(self, prompt: str, config: WebUIConfig) -> str:
        raise NotImplementedError

    def health(self, config: WebUIConfig) -> dict[str, Any]:
        return {"ok": True, "loggedIn": True, "engine": config.engine, "url": config.url}


class PlaywrightChatDriver(BrowserDriver):
    def __init__(self) -> None:
        self._playwright: Any = None
        self._context: Any = None
        self._page: Any = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._context is not None:
            return
        try:
            from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]
        except ImportError as exc:
            raise ProviderUnavailable(
                "web UI provider requires the optional 'webui' extra: uv sync --extra webui"
            ) from exc
        self._playwright = sync_playwright().start()
        self._context = self._playwright.chromium.launch_persistent_context(
            str(self._config_profile_dir()),
            headless=self._headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        self._page = (
            self._context.pages[0] if self._context.pages else self._context.new_page()
        )

    def _config_profile_dir(self) -> Path:
        return self._profile_dir

    def close(self) -> None:
        try:
            if self._context is not None:
                self._context.close()
        finally:
            self._context = None
            self._page = None
            if self._playwright is not None:
                try:
                    self._playwright.stop()
                finally:
                    self._playwright = None

    def _ensure(self, config: WebUIConfig) -> Any:
        self._profile_dir = config.profile_dir
        self._headless = config.headless
        self.start()
        if self._page is None:
            raise ProviderUnavailable("browser page is not available")
        return self._page

    def ask(self, prompt: str, config: WebUIConfig) -> str:
        with self._lock:
            page = self._ensure(config)
            page.goto(config.url, wait_until="domcontentloaded", timeout=config.timeout * 1000)
            self._wait_for_input(page, config)
            self._wait_for_operator(page, config)
            before = self._extract_messages(page, config)
            self._fill(page, prompt, config)
            self._send(page, config)
            return self._wait_for_answer(page, before, prompt, config)

    def _input_selector(self, page: Any, config: WebUIConfig) -> str | None:
        for selector in config.selectors.input:
            try:
                locator = page.locator(selector).last
                if locator.count() > 0 and locator.first.is_visible():
                    return selector
            except Exception:
                continue
        return None

    def _wait_for_input(self, page: Any, config: WebUIConfig) -> str:
        deadline = time.monotonic() + config.timeout
        while time.monotonic() < deadline:
            selector = self._input_selector(page, config)
            if selector:
                return selector
            page.wait_for_timeout(250)
        raise WebUINeedsLogin("login or challenge page did not expose a chat input")

    def _visible(self, page: Any, selectors: list[str]) -> bool:
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible():
                    return True
            except Exception:
                continue
        return False

    def _wait_for_operator(self, page: Any, config: WebUIConfig) -> None:
        if not self._visible(page, config.selectors.login + config.selectors.challenge):
            return
        if config.headless:
            raise WebUINeedsLogin("web UI requires an operator login; run with headless=false")
        deadline = time.monotonic() + config.login_timeout
        while time.monotonic() < deadline:
            if self._input_selector(page, config) and not self._visible(
                page, config.selectors.login + config.selectors.challenge
            ):
                return
            page.wait_for_timeout(500)
        raise WebUINeedsLogin("operator did not complete login within the login timeout")

    def _fill(self, page: Any, prompt: str, config: WebUIConfig) -> None:
        selector = self._input_selector(page, config)
        if not selector:
            raise WebUINeedsLogin("chat input disappeared before sending")
        locator = page.locator(selector).last
        locator.click()
        tag = locator.evaluate("el => el.tagName.toLowerCase()")
        if tag in {"textarea", "input"}:
            locator.fill(prompt)
        else:
            page.keyboard.insert_text(prompt)

    def _send(self, page: Any, config: WebUIConfig) -> None:
        for selector in config.selectors.send:
            try:
                locator = page.locator(selector).last
                if locator.count() > 0 and locator.is_visible() and locator.is_enabled():
                    locator.click()
                    return
            except Exception:
                continue
        page.keyboard.press("Enter")

    def _extract_messages(self, page: Any, config: WebUIConfig) -> list[str]:
        selectors = config.selectors.assistant
        script = """
        (selectors) => {
          const out = [];
          const seen = new Set();
          for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              const text = (el.innerText || "").trim();
              if (!text || text.length > 200000) continue;
              if (seen.has(text)) continue;
              seen.add(text);
              out.push(text);
            }
          }
          return out;
        }
        """
        try:
            values = page.evaluate(script, selectors)
            return [str(value) for value in values if str(value).strip()]
        except Exception:
            return []

    def _wait_for_answer(
        self,
        page: Any,
        before: list[str],
        prompt: str,
        config: WebUIConfig,
    ) -> str:
        deadline = time.monotonic() + config.timeout
        last = ""
        stable_since = 0.0
        busy_retries = 0
        while time.monotonic() < deadline:
            if self._handle_busy(page, config):
                busy_retries += 1
                if busy_retries > config.busy_max_retries:
                    raise WebUIError(
                        f"web UI stayed busy after {config.busy_max_retries} retries"
                    )
                stable_since = 0.0
                page.wait_for_timeout(config.busy_retry_seconds * 1000)
                continue
            messages = self._extract_messages(page, config)
            candidates = [
                text
                for text in messages
                if text not in before and text.strip() != prompt.strip() and len(text.strip()) > 0
            ]
            current = candidates[-1] if candidates else ""
            if current:
                if current == last:
                    if stable_since and time.monotonic() - stable_since >= config.stability_seconds:
                        return current
                else:
                    last = current
                    stable_since = time.monotonic()
            if self._visible(page, config.selectors.stop):
                stable_since = 0.0
            page.wait_for_timeout(300)
        if last:
            return last
        raise WebUIError("web UI returned no assistant response within the timeout")

    def _handle_busy(self, page: Any, config: WebUIConfig) -> bool:
        if not config.selectors.busy:
            return False
        if not self._visible(page, config.selectors.busy):
            return False
        for selector in (
            "button:has-text('Continue')",
            "button:has-text('继续')",
            "[role='button']:has-text('Continue')",
        ):
            try:
                locator = page.locator(selector).last
                if locator.count() > 0 and locator.is_visible():
                    locator.click()
                    return True
            except Exception:
                continue
        return True

    def calibrate(self, config: WebUIConfig) -> dict[str, Any]:
        with self._lock:
            page = self._ensure(config)
            page.goto(config.url, wait_until="domcontentloaded", timeout=config.timeout * 1000)
            return page.evaluate(
                """
                (selectors) => {
                  const counts = {};
                  for (const [name, values] of Object.entries(selectors)) {
                    counts[name] = values.map((selector) => ({
                      selector,
                      count: document.querySelectorAll(selector).length,
                    }));
                  }
                  return {
                    title: document.title,
                    url: location.href,
                    hasPassword: document.querySelectorAll("input[type='password']").length > 0,
                    counts,
                  };
                }
                """,
                {
                    "input": config.selectors.input,
                    "send": config.selectors.send,
                    "assistant": config.selectors.assistant,
                    "login": config.selectors.login,
                    "challenge": config.selectors.challenge,
                    "stop": config.selectors.stop,
                    "busy": config.selectors.busy,
                },
            )

    def health(self, config: WebUIConfig) -> dict[str, Any]:
        with self._lock:
            page = self._ensure(config)
            page.goto(config.url, wait_until="domcontentloaded", timeout=config.timeout * 1000)
            has_input = self._input_selector(page, config) is not None
            blocked = self._visible(page, config.selectors.login + config.selectors.challenge)
            return {
                "ok": has_input and not blocked,
                "loggedIn": has_input and not blocked,
                "engine": config.engine,
                "url": config.url,
            }


class WebUIChatProvider:
    def __init__(self, config: WebUIConfig, *, driver: BrowserDriver | None = None) -> None:
        self.config = config
        self.driver = driver or PlaywrightChatDriver()
        self._lock = threading.Lock()

    def chat(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        *,
        model: str = "",
        temperature: float = 0.1,
        max_tokens: int = 1024,
        response_format: dict[str, Any] | None = None,
    ) -> Completion:
        del temperature, max_tokens, response_format
        if not self.config.url:
            raise ProviderUnavailable("web UI provider has no URL")
        prompt = compose_prompt(messages)
        if not prompt:
            raise ProviderUnavailable("web UI provider received an empty prompt")
        with self._lock:
            text = self.driver.ask(prompt, self.config)
        return Completion(
            text=text,
            model=model or self.config.model or self.config.engine,
            prompt_tokens=0,
            completion_tokens=0,
            finish_reason="stop",
        )

    def health(self) -> dict[str, Any]:
        with self._lock:
            return self.driver.health(self.config)

    def calibrate(self) -> dict[str, Any]:
        calibrate = getattr(self.driver, "calibrate", None)
        if not callable(calibrate):
            raise ProviderUnavailable("this web UI driver does not support calibration")
        with self._lock:
            return calibrate(self.config)

    def close(self) -> None:
        with self._lock:
            self.driver.close()
