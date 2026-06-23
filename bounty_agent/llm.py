from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any
from urllib import error, request


@dataclass
class ChatMessage:
    role: str
    content: str


class LLMClient:
    def complete(self, messages: list[ChatMessage]) -> str:
        raise NotImplementedError


class NullLLMClient(LLMClient):
    def complete(self, messages: list[ChatMessage]) -> str:
        return json.dumps({"action": "finish", "summary": "No LLM configured."})


class OpenAICompatibleClient(LLMClient):
    def __init__(self, base_url: str, api_key: str, model: str, timeout_seconds: int = 240) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        if model.startswith(("ollama/", "groq/")):
            self.model = model.split("/", 1)[1]
        else:
            self.model = model
        self.timeout_seconds = max(30, timeout_seconds)

    def complete(self, messages: list[ChatMessage]) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        data = json.dumps(body).encode("utf-8")
        req = request.Request(
            f"{self.base_url}/chat/completions",
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        payload = self._send_with_retry(req)
        return str(payload["choices"][0]["message"]["content"])

    def _send_with_retry(self, req: request.Request) -> dict[str, Any]:
        retryable_statuses = {429, 500, 502, 503, 504}
        attempts = 3
        for attempt in range(1, attempts + 1):
            try:
                with request.urlopen(req, timeout=self.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8", errors="replace"))
            except error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace").strip()
                message = f"HTTP {exc.code}: {details[:1000] or exc.reason}"
                if exc.code not in retryable_statuses or attempt == attempts:
                    raise RuntimeError(message) from exc
            except error.URLError as exc:
                message = f"LLM connection failed: {exc.reason}"
                if attempt == attempts:
                    raise RuntimeError(message) from exc
            time.sleep(2 ** (attempt - 1))
        raise RuntimeError("LLM request failed after retries.")
