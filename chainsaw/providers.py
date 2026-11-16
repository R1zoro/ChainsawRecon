"""OpenAI-compatible model provider client.

This is deliberately narrow: chat completions and model listing. It does not
own prompts, role routing, or state. Secrets are never included in errors or
representation.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

DEFAULT_TIMEOUT = 60.0
RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class ProviderError(RuntimeError):
    """Base error for provider calls."""


class ProviderUnavailable(ProviderError):
    pass


class ProviderResponseError(ProviderError):
    pass


class ProviderAuthError(ProviderError):
    pass


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass(frozen=True)
class Completion:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "model": self.model,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "finishReason": self.finish_reason,
        }


@dataclass
class ProviderConfig:
    base_url: str
    model: str = ""
    api_key: str = field(default="", repr=False)
    timeout: float = DEFAULT_TIMEOUT
    max_retries: int = 2
    extra_headers: dict[str, str] = field(default_factory=dict)

    def normalized_base_url(self) -> str:
        value = self.base_url.strip().rstrip("/")
        if not value:
            raise ProviderUnavailable("provider base URL is empty")
        if not value.endswith("/v1") and "/v1/" not in value:
            value = value + "/v1"
        return value


def resolve_api_key(entry: dict[str, Any]) -> str:
    """Resolve a key reference without persisting plaintext secrets.

    Accepted forms:
    - ``apiKeyRef`` = ``env:NAME``
    - ``apiKeyRef`` = ``NAME`` (environment variable)
    - ``apiKey`` (legacy/local development only)
    """

    ref = str(entry.get("apiKeyRef") or entry.get("api_key_ref") or "").strip()
    if ref.startswith("env:"):
        return os.environ.get(ref[4:], "")
    if ref:
        return os.environ.get(ref, "")
    return str(entry.get("apiKey") or entry.get("api_key") or "")


def config_from_entry(entry: dict[str, Any], *, model: str = "") -> ProviderConfig:
    base_url = str(entry.get("baseUrl") or entry.get("base_url") or "")
    requested_model = model or str(entry.get("model") or "")
    models = entry.get("models") or []
    if not requested_model and isinstance(models, list) and models:
        first = models[0]
        requested_model = str(first.get("id", "")) if isinstance(first, dict) else str(first)
    return ProviderConfig(
        base_url=base_url,
        model=requested_model,
        api_key=resolve_api_key(entry),
        timeout=float(entry.get("timeout") or DEFAULT_TIMEOUT),
        max_retries=int(entry.get("maxRetries") or 2),
    )


class OpenAICompatibleProvider:
    def __init__(
        self,
        config: ProviderConfig,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.config = config
        self.transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            **self.config.extra_headers,
        }
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _client(self) -> httpx.Client:
        return httpx.Client(
            timeout=self.config.timeout,
            transport=self.transport,
            trust_env=False,
        )

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        url = self.config.normalized_base_url() + path
        attempts = max(1, self.config.max_retries + 1)
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                with self._client() as client:
                    response = client.request(
                        method,
                        url,
                        headers=self._headers(),
                        json=payload,
                    )
            except httpx.TimeoutException as exc:
                last_error = ProviderUnavailable(f"provider timeout at {url}")
                if attempt + 1 < attempts:
                    time.sleep(min(2.0, 0.25 * (2**attempt)))
                    continue
                raise ProviderUnavailable(str(last_error)) from exc
            except httpx.HTTPError as exc:
                raise ProviderUnavailable(
                    f"provider transport failed: {exc.__class__.__name__}"
                ) from exc

            if response.status_code in {401, 403}:
                raise ProviderAuthError(
                    f"provider rejected credentials (HTTP {response.status_code})"
                )
            if response.status_code in RETRYABLE_STATUS and attempt + 1 < attempts:
                last_error = ProviderUnavailable(f"provider returned HTTP {response.status_code}")
                time.sleep(min(2.0, 0.25 * (2**attempt)))
                continue
            if response.status_code >= 400:
                raise ProviderResponseError(
                    f"provider returned HTTP {response.status_code}: {response.text[:200]}"
                )
            try:
                return response.json()
            except ValueError as exc:
                raise ProviderResponseError("provider returned non-JSON content") from exc
        raise ProviderUnavailable(str(last_error or "provider request failed"))

    def list_models(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/models")
        items = data.get("data") if isinstance(data, dict) else data
        return [item for item in items or [] if isinstance(item, dict)]

    def health(self) -> dict[str, Any]:
        models = self.list_models()
        return {
            "ok": True,
            "modelCount": len(models),
            "models": [str(item.get("id", "")) for item in models if item.get("id")],
        }

    def chat(
        self,
        messages: list[ChatMessage] | list[dict[str, str]],
        *,
        model: str = "",
        temperature: float = 0.1,
        max_tokens: int = 1024,
        response_format: dict[str, Any] | None = None,
    ) -> Completion:
        selected = model or self.config.model
        if not selected:
            raise ProviderUnavailable("no model configured for this provider")
        payload: dict[str, Any] = {
            "model": selected,
            "messages": [
                item.to_dict() if isinstance(item, ChatMessage) else item for item in messages
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if response_format is not None:
            payload["response_format"] = response_format
        data = self._request("POST", "/chat/completions", payload)
        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            raise ProviderResponseError("provider returned no choices")
        message = choices[0].get("message") or {}
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ProviderResponseError("provider returned an empty message")
        usage = data.get("usage") or {}
        return Completion(
            text=content,
            model=str(data.get("model") or selected),
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            finish_reason=str(choices[0].get("finish_reason") or ""),
        )


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract the first JSON object from a model response.

    Handles fenced blocks and leading/trailing prose. Never evals.
    """

    value = text.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        value = "\n".join(lines).strip()
    start = value.find("{")
    end = value.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ProviderResponseError("model response did not contain a JSON object")
    try:
        parsed = json.loads(value[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ProviderResponseError(f"invalid JSON from model: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ProviderResponseError("model JSON response must be an object")
    return parsed
