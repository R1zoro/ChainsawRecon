from __future__ import annotations

from dataclasses import dataclass
import json
import os
import time
from collections import deque
from typing import Any
from urllib import error, request
from .trace import TraceLogger


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
    def __init__(self, base_url: str, api_key: str, model: str, timeout_seconds: int = 240,
                 num_ctx: int = 0, max_output_tokens: int = 4096, input_budget_tokens: int = 0,
                 nvidia_rpm: int = 40, keep_alive: bool = False,
                 keep_alive_probe_seconds: int = 180, trace: TraceLogger | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.trace = trace
        self.keep_alive = bool(keep_alive)
        self.keep_alive_probe_seconds = max(0, int(keep_alive_probe_seconds))
        self._keepalive_last_probe = 0.0
        # Strip provider prefixes if target is not openrouter
        if "openrouter.ai" not in self.base_url and model.startswith(("ollama/", "groq/", "gemini/", "google/", "nvidia/")):
            self.model = model.split("/", 1)[1]
        else:
            self.model = model
        self.timeout_seconds = max(30, timeout_seconds)
        self._is_ollama = self.base_url.endswith(":11434") or model.startswith("ollama/")
        self._is_gemini = "googleapis.com" in self.base_url or "gemini" in model.lower()
        self._is_nvidia = "integrate.api.nvidia.com" in self.base_url or model.startswith("nvidia/")
        self.ollama_keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "-1")
        self.nvidia_rpm = max(0, int(nvidia_rpm))
        self._nvidia_call_times: deque[float] = deque()
        self._last_call_time: float = 0.0
        # Enforce minimum delay between calls for online rate limits (default 4.0s for 15 RPM)
        self._min_delay_seconds: float = float(os.environ.get("LLM_MIN_DELAY_SECONDS", "4.0" if self._is_gemini else "0.0"))
        # ── Stage 7: Context budget ─────────────────────────────────────
        # Provider-aware defaults. Ollama defaults to 16k; Gemini/OpenRouter to 32k.
        if num_ctx > 0:
            self.num_ctx = num_ctx
        elif self._is_ollama:
            self.num_ctx = int(os.environ.get("OLLAMA_NUM_CTX", "16384"))
        elif self._is_gemini:
            self.num_ctx = 32768
        else:
            self.num_ctx = 16384
        self.max_output_tokens = max(256, max_output_tokens)
        # Safety margin: 10% of num_ctx, minimum 512 tokens.
        self.safety_margin = max(512, int(self.num_ctx * 0.1))
        if input_budget_tokens > 0:
            self.input_budget_tokens = input_budget_tokens
        else:
            self.input_budget_tokens = max(1024, self.num_ctx - self.max_output_tokens - self.safety_margin)

    def _maybe_probe_keep_alive(self) -> None:
        """Send a low-cost, route-gated Ollama health probe when idle.

        This exists only for Colab/Ollama-tunnel routes; it avoids polluting the
        investigation flow by never creating an extra reasoning step.
        """
        if not self.keep_alive or not self._is_ollama or self.keep_alive_probe_seconds <= 0:
            return
        now = time.time()
        idle_seconds = max(0.0, now - self._last_call_time)
        if self._last_call_time > 0 and idle_seconds < self.keep_alive_probe_seconds:
            return
        if self._keepalive_last_probe and now - self._keepalive_last_probe < self.keep_alive_probe_seconds:
            return
        probe_url = self.base_url.rstrip("/").removesuffix("/v1") + "/api/tags"
        try:
            req = request.Request(probe_url, method="GET", headers={
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "ChainsawRecon/keepalive",
            })
            with request.urlopen(req, timeout=min(10, self.timeout_seconds)) as response:
                response.read(1)
            self._keepalive_last_probe = now
            if self.trace:
                self.trace.write("ollama_keep_alive_probe_ok", route=self.base_url, model=self.model, idle_seconds=round(idle_seconds, 3))
        except Exception as exc:
            if self.trace:
                self.trace.write("ollama_keep_alive_probe_failed", route=self.base_url, model=self.model,
                                 idle_seconds=round(idle_seconds, 3), error=f"{type(exc).__name__}: {exc}")
            self._keepalive_last_probe = now

    def complete(self, messages: list[ChatMessage]) -> str:
        self._maybe_probe_keep_alive()
        self._pace_nvidia()
        if self._min_delay_seconds > 0 and self._last_call_time > 0:
            elapsed = time.time() - self._last_call_time
            if elapsed < self._min_delay_seconds:
                time.sleep(self._min_delay_seconds - elapsed)
        self._last_call_time = time.time()
        original_estimate = self._estimate_tokens(messages)
        # Enforce budget invariant: estimated_input + max_output + margin <= num_ctx
        messages = self._shrink_to_budget(messages)
        if self.trace:
            self.trace.write(
                "llm_context_budget",
                input_budget_tokens=self.input_budget_tokens,
                estimated_before=original_estimate,
                estimated_after=self._estimate_tokens(messages),
                message_count=len(messages),
                trimmed=original_estimate > self._estimate_tokens(messages),
            )
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "max_tokens": self.max_output_tokens,
        }
        if self._is_ollama:
            body["options"] = {
                "num_predict": self.max_output_tokens,
                "num_ctx": self.num_ctx,
                "temperature": 0.2,
                "keep_alive": self.ollama_keep_alive,
            }
        if self.trace:
            self.trace.write(
                "llm_request",
                model=self.model,
                route=f"{self.base_url}/chat/completions",
                messages=[{"role": item.role, "content": item.content} for item in messages],
                body=body,
            )
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
        if self.trace:
            self.trace.write("llm_success_payload", parsed_keys=list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__)
        return str(payload["choices"][0]["message"]["content"])

    def _pace_nvidia(self) -> None:
        """Keep hosted NVIDIA traffic below the configured rolling-minute limit.

        The server remains authoritative: 429 responses are still handled by the
        common retry path. This client-side window prevents avoidable bursts when
        a long-running engagement makes many sequential model decisions.
        """
        if not self._is_nvidia or self.nvidia_rpm <= 0:
            return
        now = time.monotonic()
        while self._nvidia_call_times and now - self._nvidia_call_times[0] >= 60.0:
            self._nvidia_call_times.popleft()
        if len(self._nvidia_call_times) >= self.nvidia_rpm:
            wait = max(0.0, 60.0 - (now - self._nvidia_call_times[0]) + 0.05)
            time.sleep(wait)
            now = time.monotonic()
            while self._nvidia_call_times and now - self._nvidia_call_times[0] >= 60.0:
                self._nvidia_call_times.popleft()
        self._nvidia_call_times.append(time.monotonic())

    def _estimate_tokens(self, messages: list[ChatMessage]) -> int:
        """Conservative token estimate: characters / 3."""
        total_chars = sum(len(item.content) for item in messages)
        return max(1, total_chars // 3)

    def _shrink_to_budget(self, messages: list[ChatMessage]) -> list[ChatMessage]:
        """Fit messages deterministically, with a hard final size guarantee.

        The coordinator already supplies compact working-memory hints. This
        client-side guard is the last safety boundary: low-value context is
        removed first, then oversized messages are clipped until the same
        conservative estimator is within budget.
        """
        current = list(messages)
        if self._estimate_tokens(current) <= self.input_budget_tokens:
            return current

        def priority(index: int, message: ChatMessage) -> int:
            text = message.content
            if message.role == "system" and index == 0:
                return 100  # scope, identity, and action protocol
            if "AUTO-SELECTED TRADECRAFT" in text:
                return 15
            if "Relevant prior evidence" in text or "Relevant prior tool outputs" in text:
                return 25
            if message.role == "system":
                return 65
            return 80 if index >= len(current) - 6 else 35

        while self._estimate_tokens(current) > self.input_budget_tokens and current:
            protected = [i for i, item in enumerate(current) if item.role == "system" and i == 0]
            candidates = [i for i in range(len(current)) if i not in protected]
            if not candidates:
                candidates = list(range(len(current)))
            index = min(candidates, key=lambda i: (priority(i, current[i]), -len(current[i].content)))
            item = current[index]
            over_chars = (self._estimate_tokens(current) - self.input_budget_tokens) * 3
            if len(item.content) <= 256:
                current.pop(index)
                continue
            keep = max(128, len(item.content) - max(128, over_chars))
            current[index] = ChatMessage(item.role, item.content[:keep] + "\n...[context clipped by budget]")

        # The loop above is based on the same estimator used for admission. The
        # final guard handles rounding and keeps the invariant explicit.
        while self._estimate_tokens(current) > self.input_budget_tokens and current:
            largest = max(range(len(current)), key=lambda i: len(current[i].content))
            item = current[largest]
            allowed = max(64, len(item.content) - 256)
            current[largest] = ChatMessage(item.role, item.content[:allowed])
            if allowed <= 64 and len(current) > 1:
                current.pop(largest)
        return current

    def _send_with_retry(self, req: request.Request) -> dict[str, Any]:
        # 5xx codes from standard servers plus Cloudflare edge codes (520-527,
        # 529-531) which indicate transient tunnel/origin issues.
        retryable_statuses = {429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 527, 529, 530, 531}
        attempts = 5
        payload_preview = ""
        try:
            raw = req.data.decode("utf-8", errors="replace") if isinstance(req.data, (bytes, bytearray)) else str(req.data)
            payload_preview = raw[:2000]
        except Exception:
            payload_preview = "<unreadable>"
        if self.trace:
            self.trace.write(
                "llm_request",
                url=req.full_url,
                method=getattr(req, "get_method", lambda: "POST")(),
                model=self.model,
                provider_prefix=self._is_ollama,
                timeout_seconds=self.timeout_seconds,
                payload_preview=payload_preview,
            )
        for attempt in range(1, attempts + 1):
            try:
                with request.urlopen(req, timeout=self.timeout_seconds) as response:
                    raw = response.read().decode("utf-8", errors="replace")
                    if self.trace:
                        self.trace.write(
                            "llm_response",
                            url=req.full_url,
                            attempt=attempt,
                            model=self.model,
                            status_code=getattr(response, "status", None),
                            response_preview=raw[:2000],
                        )
                    return json.loads(raw)
            except error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace").strip()
                parsed_msg = ""
                try:
                    err_json = json.loads(details)
                    if isinstance(err_json, dict) and "error" in err_json:
                        err_obj = err_json["error"]
                        parsed_msg = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
                except Exception:
                    pass
                message = f"HTTP {exc.code}: {parsed_msg or details[:1000] or exc.reason}"
                if self.trace:
                    self.trace.write(
                        "llm_http_error",
                        url=req.full_url,
                        attempt=attempt,
                        model=self.model,
                        status_code=exc.code,
                        message=message,
                        details=details[:2000],
                    )
                if exc.code not in retryable_statuses or attempt == attempts:
                    raise RuntimeError(message) from exc

                # Check for Retry-After header or parse "Please retry in X.Xs" from error message on 429 rate limit
                sleep_seconds = 2 * (2 ** (attempt - 1))
                if exc.code == 429:
                    if exc.headers and exc.headers.get("Retry-After") and exc.headers.get("Retry-After").isdigit():
                        sleep_seconds = max(sleep_seconds, int(exc.headers.get("Retry-After")))
                    elif "Please retry in " in details:
                        try:
                            after_str = details.split("Please retry in ", 1)[1].split("s", 1)[0]
                            parsed_delay = float(after_str)
                            sleep_seconds = max(sleep_seconds, parsed_delay + 1.0)
                        except Exception:
                            pass
                time.sleep(sleep_seconds)
            except error.URLError as exc:
                message = f"LLM connection failed: {exc.reason}"
                if self.trace:
                    self.trace.write(
                        "llm_url_error",
                        url=req.full_url,
                        attempt=attempt,
                        model=self.model,
                        error=f"{type(exc).__name__}: {message}",
                    )
                if attempt == attempts:
                    raise RuntimeError(message) from exc
                time.sleep(2 ** (attempt - 1))
            except Exception as exc:
                message = f"LLM parse/transport failed: {type(exc).__name__}: {exc}"
                if self.trace:
                    self.trace.write(
                        "llm_unexpected_error",
                        url=req.full_url,
                        attempt=attempt,
                        model=self.model,
                        error=message,
                    )
                if attempt == attempts:
                    raise RuntimeError(message) from exc
                time.sleep(2 ** (attempt - 1))
        raise RuntimeError("LLM request failed after retries.")
