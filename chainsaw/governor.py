"""Per-host request governor.

The governor is a safety feature, not a security boundary. It keeps automated
testing from turning into accidental load: token-bucket pacing, bounded
in-flight requests, jitter, and short backoff after 429/503.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class RatePolicy:
    requests_per_second: float = 5.0
    burst: int = 10
    max_in_flight: int = 2
    cache_get_seconds: int = 30
    jitter_ratio: float = 0.10
    max_wait_seconds: float = 30.0
    backoff_seconds: float = 5.0

    @property
    def enabled(self) -> bool:
        return self.requests_per_second > 0


PROFILES: dict[str, RatePolicy] = {
    "off": RatePolicy(requests_per_second=0, burst=1, max_in_flight=100, cache_get_seconds=0),
    "quiet": RatePolicy(2, burst=4, max_in_flight=1, cache_get_seconds=60),
    "balanced": RatePolicy(5, burst=10, max_in_flight=2, cache_get_seconds=30),
    "aggressive": RatePolicy(20, burst=40, max_in_flight=4, cache_get_seconds=10),
}


def policy_for(name: str | None) -> RatePolicy:
    return PROFILES.get((name or "balanced").strip().lower(), PROFILES["balanced"])


class RateLimitExceeded(RuntimeError):
    pass


@dataclass
class _HostState:
    tokens: float
    last_refill: float
    in_flight: int = 0
    backoff_until: float = 0.0


class RequestGovernor:
    def __init__(
        self,
        policy: RatePolicy,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.policy = policy
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._hosts: dict[str, _HostState] = {}

    @classmethod
    def from_profile(cls, name: str | None, **kwargs: object) -> RequestGovernor:
        return cls(policy_for(name), **kwargs)  # type: ignore[arg-type]

    def _host(self, url: str) -> str:
        return (urlsplit(url).hostname or "").lower()

    def _state(self, host: str, now: float) -> _HostState:
        state = self._hosts.get(host)
        if state is None:
            state = _HostState(tokens=float(self.policy.burst), last_refill=now)
            self._hosts[host] = state
        return state

    def acquire(self, url: str, *, method: str = "GET") -> None:
        if not self.policy.enabled:
            return
        host = self._host(url)
        if not host:
            return
        deadline = self._clock() + self.policy.max_wait_seconds
        while True:
            with self._lock:
                now = self._clock()
                state = self._state(host, now)
                if state.backoff_until > now:
                    wait = min(0.5, state.backoff_until - now)
                else:
                    elapsed = max(0.0, now - state.last_refill)
                    state.tokens = min(
                        float(self.policy.burst),
                        state.tokens + elapsed * self.policy.requests_per_second,
                    )
                    state.last_refill = now
                    if state.in_flight >= self.policy.max_in_flight:
                        wait = 0.05
                    elif state.tokens >= 1.0:
                        state.tokens -= 1.0
                        state.in_flight += 1
                        return
                    else:
                        wait = (1.0 - state.tokens) / self.policy.requests_per_second
                        wait *= 1.0 + self.policy.jitter_ratio
            if self._clock() + wait > deadline:
                raise RateLimitExceeded(f"rate limit wait exceeded for {host}")
            self._sleep(max(0.01, min(wait, 2.0)))

    def release(self, url: str) -> None:
        if not self.policy.enabled:
            return
        host = self._host(url)
        with self._lock:
            state = self._hosts.get(host)
            if state is not None and state.in_flight > 0:
                state.in_flight -= 1

    def observe(self, url: str, status_code: int) -> None:
        if not self.policy.enabled or status_code not in {429, 503}:
            return
        host = self._host(url)
        if not host:
            return
        with self._lock:
            state = self._state(host, self._clock())
            state.backoff_until = max(
                state.backoff_until,
                self._clock() + self.policy.backoff_seconds,
            )

    def snapshot(self) -> dict[str, dict[str, float]]:
        with self._lock:
            return {
                host: {
                    "tokens": round(state.tokens, 3),
                    "inFlight": state.in_flight,
                    "backoffUntil": round(state.backoff_until, 3),
                }
                for host, state in self._hosts.items()
            }


def governor_for(name: str | None) -> RequestGovernor:
    return RequestGovernor.from_profile(name)
