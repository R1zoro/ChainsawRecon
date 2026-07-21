"""Strategy memory for tracking attempt outcomes and preventing loops.

Stores per-surface attempt history so the agent can answer:
- "Have we already tried this surface+attack combination?"
- "What was the outcome of our last attempt?"
- "What strategy should we use instead?"

Prevents the infinite loops seen in the trace where the model repeats
the same hypothesis → verifier → finding rejection cycle 7+ times.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


@dataclass
class AttemptRecord:
    """Record of a single attempt on a surface."""
    surface_key: str
    attempt_type: str  # "hypothesis", "verifier", "finding", "bash", "tool"
    outcome: str       # "accepted", "rejected", "blocked", "error", "inconclusive"
    reason: str = ""
    target: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    next_strategy: str = ""  # Suggested next strategy instead of retry

    def to_dict(self) -> Dict[str, Any]:
        return {
            "surface_key": self.surface_key,
            "attempt_type": self.attempt_type,
            "outcome": self.outcome,
            "reason": self.reason,
            "target": self.target,
            "timestamp": self.timestamp,
            "next_strategy": self.next_strategy,
        }


# Mapping from rejection rungs to actionable strategy changes
_RUNG_TO_STRATEGY: Dict[str, str] = {
    "suspicious": "Need stronger evidence. Try different method, auth context, or parameter combination.",
    "candidate": "Evidence is too weak. Enumerate more endpoints of this class before retrying.",
    "reproduced": "Issue is reproducible. Prepare full evidence package.",
    "validated": "Validated. Report.",
}


class StrategyMemory:
    """Tracks attempt history per surface to prevent redundant cycles.

    Maintains a compact record of what was tried, what happened, and
    what to do next. Exposes a summary string for LLM prompts so the
    model sees: "Surface X: 3 attempts → all blocked by Cloudflare."
    """

    def __init__(self, path: Optional[Path] = None) -> None:
        self._attempts: Dict[str, List[AttemptRecord]] = {}
        self._path = path
        self._consecutive_rejections: Dict[str, int] = {}  # surface_key -> count
        if path and path.exists():
            self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            for surface_key, records in raw.items():
                self._attempts[surface_key] = [
                    AttemptRecord(**r) if isinstance(r, dict) else r
                    for r in records
                ]
        except (OSError, json.JSONDecodeError, TypeError):
            pass

    def _save(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                surface: [r.to_dict() for r in records]
                for surface, records in self._attempts.items()
            }
            self._path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass

    def record_attempt(
        self,
        surface_key: str,
        attempt_type: str,
        outcome: str,
        reason: str = "",
        target: str = "",
        next_strategy: str = "",
    ) -> None:
        """Record an attempt outcome for a surface."""
        record = AttemptRecord(
            surface_key=surface_key,
            attempt_type=attempt_type,
            outcome=outcome,
            reason=reason,
            target=target,
            next_strategy=next_strategy,
        )
        self._attempts.setdefault(surface_key, []).append(record)

        # Track consecutive rejections
        if outcome in ("rejected", "blocked", "error"):
            self._consecutive_rejections[surface_key] = self._consecutive_rejections.get(surface_key, 0) + 1
        else:
            self._consecutive_rejections[surface_key] = 0

        self._save()

    def record_finding_rejection(self, surface_key: str, rung: str) -> None:
        """Record a finding rejection with an automatic strategy suggestion."""
        strategy = _RUNG_TO_STRATEGY.get(rung, "Change surface or attack type.")
        self.record_attempt(
            surface_key=surface_key,
            attempt_type="finding",
            outcome="rejected",
            reason=f"Rejected at rung: {rung}",
            next_strategy=strategy,
        )

    def consecutive_rejections(self, surface_key: str) -> int:
        """Get the number of consecutive rejected attempts for a surface."""
        return self._consecutive_rejections.get(surface_key, 0)

    def should_switch_strategy(self, surface_key: str) -> bool:
        """Check if the agent should stop trying this surface with current strategy.

        Returns True after 3 consecutive rejections/blocked attempts on the same surface.
        """
        return self.consecutive_rejections(surface_key) >= 3

    def get_last_outcome(self, surface_key: str) -> Optional[str]:
        """Get the outcome of the last attempt on this surface."""
        records = self._attempts.get(surface_key, [])
        if not records:
            return None
        return records[-1].outcome

    def get_summary(self, surface_keys: Optional[List[str]] = None) -> str:
        """Get a compact summary for LLM prompts.

        Shows surfaces with problems, not every successful attempt.
        """
        if surface_keys:
            relevant = {k: self._attempts.get(k, []) for k in surface_keys if k in self._attempts}
        else:
            relevant = self._attempts

        lines: List[str] = []
        for surface_key, records in relevant.items():
            if not records:
                continue
            last = records[-1]
            rejections = self._consecutive_rejections.get(surface_key, 0)

            # Only show problematic surfaces (rejected/blocked/error)
            if last.outcome in ("rejected", "blocked", "error") and rejections >= 2:
                lines.append(
                    f"  {surface_key}: {rejections}x {last.outcome} "
                    f"({last.attempt_type}) - {last.reason[:80]}"
                )
                if last.next_strategy:
                    lines.append(f"    → {last.next_strategy}")

        if not lines:
            return ""

        return "Strategy memory (previous attempts with repeated problems):\n" + "\n".join(lines)

    def get_recommendation(self, surface_key: str) -> str:
        """Get a specific recommendation for a surface based on history."""
        records = self._attempts.get(surface_key, [])
        if not records:
            return "No prior attempts on this surface."

        last = records[-1]
        rejections = self._consecutive_rejections.get(surface_key, 0)

        if rejections >= 3:
            return (
                f"Surface {surface_key} has been attempted {len(records)} times "
                f"with {rejections} consecutive failures ({last.outcome}: {last.reason[:60]}). "
                "Switch to a different surface or completely change the attack strategy."
            )

        if last.next_strategy:
            return f"Previous attempt: {last.outcome}. Next: {last.next_strategy}"

        return f"Previous attempt: {last.outcome} ({last.attempt_type})"

    def surfaces_with_problems(self) -> List[str]:
        """Get all surfaces that have repeated problems."""
        return [
            surface for surface, count in self._consecutive_rejections.items()
            if count >= 2
        ]

    def clear(self) -> None:
        """Clear all memory."""
        self._attempts.clear()
        self._consecutive_rejections.clear()
        if self._path and self._path.exists():
            self._path.unlink()