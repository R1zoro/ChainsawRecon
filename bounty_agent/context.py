from __future__ import annotations

"""Small, deterministic working-memory helpers for LLM context assembly."""

from dataclasses import dataclass
import hashlib
import re
from typing import Iterable


@dataclass
class RetrievalMemory:
    key: str
    digest: str
    content: str
    first_step: int
    last_step: int
    presentations: int = 0


class ContextLedger:
    """Track retrieved evidence without replaying full blobs forever.

    The ledger is deliberately in-memory and run-scoped. Durable evidence stays
    in the existing retrieval/artifact stores; this class only controls what is
    allowed back into the next model context.
    """

    def __init__(self, *, full_turns: int = 2, item_chars: int = 1800, digest_chars: int = 260) -> None:
        self.full_turns = max(1, full_turns)
        self.item_chars = max(400, item_chars)
        self.digest_chars = max(80, digest_chars)
        self._items: dict[str, RetrievalMemory] = {}
        self.target = ""
        self.mission = ""
        self.hypothesis = ""
        self.security_question = ""
        self.last_action = ""
        self.last_result = ""
        self.next_question = ""

    def reset(self) -> None:
        self._items.clear()
        self.target = self.mission = self.hypothesis = self.security_question = ""
        self.last_action = self.last_result = self.next_question = ""

    def set_target(self, target: str, mission: str = "") -> None:
        self.target = _one_line(target)[:300]
        self.mission = _one_line(mission or f"Assess {target}")[:300]

    def observe(self, action: dict[str, object], ok: bool, content: str) -> None:
        name = str(action.get("action", "")).strip()
        self.last_action = name[:80]
        self.last_result = _redact(_one_line(content))[:420]
        if name == "create_hypothesis":
            self.hypothesis = _one_line(str(action.get("title", "candidate hypothesis")))[:240]
            self.security_question = _one_line(str(action.get("security_question", action.get("question", ""))))[:360]
            self.next_question = "What bounded experiment can answer the security question?"
        elif action.get("hypothesis_id"):
            self.next_question = "Does the latest evidence satisfy the hypothesis requirements?"
        elif not ok:
            self.next_question = "What alternative bounded action advances the mission?"
        else:
            self.next_question = "What is the highest-value unresolved evidence gap?"

    def render_working_memory(self) -> str:
        lines = ["ACTIVE WORKING MEMORY (compact; update from the latest result):"]
        if self.target:
            lines.append(f"Target: {self.target}")
        if self.mission:
            lines.append(f"Mission: {self.mission}")
        if self.hypothesis:
            lines.append(f"Hypothesis: {self.hypothesis}")
        if self.security_question:
            lines.append(f"Security question: {self.security_question}")
        if self.last_action:
            lines.append(f"Last action: {self.last_action}")
        if self.last_result:
            lines.append(f"Last result: {self.last_result}")
        if self.next_question:
            lines.append(f"Next question: {self.next_question}")
        return "\n".join(lines)

    def render_retrieval(self, step: int, documents: Iterable[object]) -> str:
        lines = ["Relevant prior evidence (bounded working memory):"]
        rendered = 0
        for document in documents:
            content = str(getattr(document, "content", ""))
            action = str(getattr(document, "action", {}))
            doc_step = int(getattr(document, "step", step))
            if not content:
                continue
            digest = hashlib.sha1(content.encode("utf-8", errors="replace")).hexdigest()[:12]
            # Content identity is stable across turns; the step remains
            # metadata so the same evidence is not treated as new merely
            # because retrieval found it again later.
            key = digest
            item = self._items.get(key)
            if item is None:
                item = RetrievalMemory(key, digest, content, doc_step, step)
                self._items[key] = item
            else:
                item.last_step = step
            item.presentations += 1
            if item.presentations <= self.full_turns:
                body = _clip(content, self.item_chars)
            else:
                body = _clip(_one_line(content), self.digest_chars)
            lines.append(f"Evidence {digest} (step {doc_step}, action={action}):")
            lines.append(body)
            lines.append("---")
            rendered += 1
        return "\n".join(lines) if rendered else ""


def _one_line(value: str) -> str:
    return " ".join(value.split())


def _redact(value: str) -> str:
    return re.sub(r"(?i)(authorization|cookie|set-cookie)\s*:\s*[^; ,]+", r"\1: <redacted>", value)


def _clip(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 40)] + f"\n...[context digest clipped; {len(value)} chars total]"

