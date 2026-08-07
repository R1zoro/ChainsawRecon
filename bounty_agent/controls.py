"""Milestone 4 — Controls & Validation.

M4.1 Rate-limit boundary probing + dynamic maintenance.
M4.2 Cross-model validation (Gemini API adjudicator on the 7-Question Gate).
M4.3 Auto-register cleanup (reverse-order cleanup registry on exit/crash).
"""
from __future__ import annotations

import atexit
import json
import os
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .trace import TraceLogger


# ── M4.1: Rate-limit boundary probing & dynamic maintenance ──────────────────

class RateLimitProbe:
    """Probe the real rate limit once (X/X+1/X+2) and record it as a fact.

    The probe sends a small burst of requests to a low-impact in-scope URL and
    observes where the 429/403 rate-limit boundary lands. The discovered limit
    is then used to maintain the CommandRateLimiter below it.
    """

    def __init__(self, trace: TraceLogger, base_delay_seconds: float = 0.0) -> None:
        self.trace = trace
        self.base_delay_seconds = max(0.0, base_delay_seconds)
        self.discovered_limit: int | None = None
        self.probed = False

    def probe(self, probe_url: str, max_burst: int = 3) -> int | None:
        """Probe the rate limit with a bounded burst (X, X+1, X+2).

        Returns the discovered max requests-per-minute, or None if the probe
        could not be completed (e.g., no URL, network failure, or no limit hit).
        """
        if self.probed:
            return self.discovered_limit
        self.probed = True
        if not probe_url:
            return None
        # Use a conservative burst: 3 requests spaced by base delay
        hits = 0
        for i in range(1, max_burst + 1):
            try:
                req = Request(probe_url, headers={"User-Agent": "chainsaw-recon/1.0"})
                with urlopen(req, timeout=10) as resp:
                    status = resp.status
            except HTTPError as exc:
                status = exc.code
            except (URLError, TimeoutError, OSError):
                status = 0
            if status in (429, 403):
                hits += 1
                self.trace.write("rate_limit_probe_hit", attempt=i, status=status, url=probe_url)
            if self.base_delay_seconds > 0:
                time.sleep(self.base_delay_seconds)
        # If we hit the limit at burst size N, the real limit is ~N-1
        if hits > 0:
            self.discovered_limit = max(1, max_burst - hits)
            self.trace.write("rate_limit_discovered", limit=self.discovered_limit, hits=hits)
        else:
            self.discovered_limit = max_burst
            self.trace.write("rate_limit_probe_clean", burst=max_burst)
        return self.discovered_limit


class DynamicRateLimiter:
    """CommandRateLimiter that maintains below a discovered rate limit.

    Wraps the existing CommandRateLimiter and dynamically lowers the effective
    max-commands-per-minute when a rate-limit hit (429/403) is observed, so the
    agent stays below the real boundary.
    """

    def __init__(self, base_max_per_minute: int, trace: TraceLogger) -> None:
        self.base_max_per_minute = max(0, base_max_per_minute)
        self.trace = trace
        self._current_max = self.base_max_per_minute
        self._rate_limit_hits = 0
        self._last_hit_at = 0.0

    def record_rate_limit_hit(self) -> None:
        """Record a 429/403 rate-limit hit and back off the effective limit."""
        self._rate_limit_hits += 1
        self._last_hit_at = time.monotonic()
        # Halve the effective limit on each hit, floor at 1 req/min
        if self._current_max > 1:
            self._current_max = max(1, self._current_max // 2)
            self.trace.write("rate_limit_backoff", new_max=self._current_max, hits=self._rate_limit_hits)

    def effective_max_per_minute(self) -> int:
        """Current effective max commands per minute (after backoff)."""
        return self._current_max

    def set_effective_limit(self, max_per_minute: int | None) -> None:
        """Initialize or tighten the current effective limit based on a probe."""
        if max_per_minute is None:
            return
        effective = max(1, int(max_per_minute))
        if self.base_max_per_minute > 0:
            effective = min(effective, self.base_max_per_minute)
        self._current_max = effective
        self.trace.write("rate_limit_effective_limit", effective=self._current_max)

    def min_interval_seconds(self) -> float:
        """Minimum interval between commands based on the effective limit."""
        if self._current_max <= 0:
            return 0.0
        return 60.0 / self._current_max

    def reset(self) -> None:
        """Reset to the base limit (e.g., after a cooldown period)."""
        self._current_max = self.base_max_per_minute
        self._rate_limit_hits = 0


# ── M4.2: Cross-model validation (Gemini adjudicator) ───────────────────────

class GeminiAdjudicator:
    """Runs the 7-Question Gate on a finding candidate via the Gemini API.

    The primary model (Ollama) proposes findings; this adjudicator independently
    re-runs the evidence gate with a second model to reduce false positives.
    Requires GEMINI_API_KEY in the environment (or passed explicitly).
    """

    GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

    def __init__(self, api_key: str = "", model: str = "gemini-2.0-flash", trace: TraceLogger | None = None) -> None:
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.model = model
        self.trace = trace

    def available(self) -> bool:
        return bool(self.api_key)

    def adjudicate(self, finding: Any) -> dict[str, Any]:
        """Run the 7-Question Gate on a finding via Gemini.

        Returns a dict with 'verdict' ('validated'|'candidate'), 'reasons',
        and 'model'. If the API is unavailable, returns a neutral verdict.
        """
        if not self.available():
            return {"verdict": "candidate", "reasons": ["Gemini adjudicator unavailable (no GEMINI_API_KEY)"], "model": "none"}

        prompt = self._build_prompt(finding)
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0, "maxOutputTokens": 300},
        }
        req = Request(
            f"{self.GEMINI_URL}?key={self.api_key}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            if self.trace:
                self.trace.write("gemini_adjudicator_error", error=f"{type(exc).__name__}: {exc}")
            return {"verdict": "candidate", "reasons": [f"Gemini API error: {type(exc).__name__}"], "model": self.model}

        text = ""
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError):
            pass
        verdict, reasons = self._parse_verdict(text)
        if self.trace:
            self.trace.write("gemini_adjudication", verdict=verdict, reasons=reasons, model=self.model)
        return {"verdict": verdict, "reasons": reasons, "model": self.model}

    def _build_prompt(self, finding: Any) -> str:
        return (
            "You are an independent bug bounty finding adjudicator. Run the 7-Question Gate on this finding candidate.\n"
            "The 7 questions are:\n"
            "1. In-scope: Is the asset explicitly within the engagement program scope?\n"
            "2. Reproducible: Is there an exact request + response pair that anyone can replay?\n"
            "3. Real impact: Does the evidence demonstrate unauthorized access, data exposure, or security control bypass?\n"
            "4. Not auth-gate: Is this a true bypass or cross-tenant access, not merely a login wall or expected 401/403?\n"
            "5. Business relevance: Does this affect user data, tenant isolation, or a core application function?\n"
            "6. VRT severity: Does this map to a VRT category at Low or above?\n"
            "7. POE complete: Is the full Proof of Exploit (request, response, and why-interesting) present and complete?\n\n"
            f"Finding title: {finding.title}\n"
            f"Severity: {finding.severity}\n"
            f"Asset: {finding.asset}\n"
            f"Evidence: {finding.evidence}\n"
            f"Impact: {finding.impact}\n"
            f"Request: {finding.request}\n"
            f"Response: {finding.response}\n\n"
            "Reply with a single JSON object: {\"verdict\": \"validated\" or \"candidate\", \"reasons\": [list of failing question numbers or \"all pass\"]}"
        )

    def _parse_verdict(self, text: str) -> tuple[str, list[str]]:
        """Parse the Gemini response into (verdict, reasons)."""
        text = text.strip()
        try:
            data = json.loads(text)
            verdict = str(data.get("verdict", "candidate")).lower()
            reasons = [str(r) for r in data.get("reasons", [])]
            if verdict not in ("validated", "candidate"):
                verdict = "candidate"
            return verdict, reasons
        except (json.JSONDecodeError, AttributeError):
            # Fallback: look for the verdict keyword in the raw text
            lowered = text.lower()
            if "validated" in lowered and "candidate" not in lowered:
                return "validated", ["all pass"]
            return "candidate", ["unparseable adjudicator response"]


# ── M4.3: Auto-register cleanup ──────────────────────────────────────────────

class CleanupRegistry:
    """Reverse-order cleanup registry.

    Components register cleanup callbacks; on exit (normal, SIGINT, or crash)
    they run in reverse registration order so dependencies are torn down last.
    """

    def __init__(self) -> None:
        self._callbacks: list[tuple[str, Callable[[], None]]] = []
        self._ran = False

    def register(self, name: str, callback: Callable[[], None]) -> None:
        """Register a cleanup callback. Callbacks run in reverse registration order."""
        self._callbacks.append((name, callback))

    def run_all(self) -> None:
        """Run all registered cleanup callbacks in reverse order, exactly once."""
        if self._ran:
            return
        self._ran = True
        for name, callback in reversed(self._callbacks):
            try:
                callback()
            except Exception:
                pass  # Best-effort cleanup; never block shutdown

    def __len__(self) -> int:
        return len(self._callbacks)


# Global cleanup registry + atexit hook
_cleanup_registry = CleanupRegistry()
atexit.register(_cleanup_registry.run_all)


def get_cleanup_registry() -> CleanupRegistry:
    """Return the global cleanup registry."""
    return _cleanup_registry