"""Role-aware context budgeting and compression.

The controller never sends one unbounded conversation to every model. It builds a
bounded *context packet* per role from journal/project projections. This module
owns the deterministic part: section visibility, priority, token estimation,
compression levels, and overflow behavior.

Compression levels are intentionally simple and deterministic:

    FULL -> SUMMARY -> DIGEST -> POINTER -> DROP

A caller may supply a precomputed ``summary``/``digest``/``pointer``. If it does
not, this module produces a stable fallback (truncation + hash). Real LLM
summarization belongs in the controller, which can replace the section content
before assembly.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from enum import Enum

from .roles import Role


class Compression(str, Enum):
    FULL = "full"
    SUMMARY = "summary"
    DIGEST = "digest"
    POINTER = "pointer"
    DROP = "drop"

    @property
    def order(self) -> int:
        return _COMPRESSION_ORDER[self]


_COMPRESSION_ORDER = {
    Compression.FULL: 0,
    Compression.SUMMARY: 1,
    Compression.DIGEST: 2,
    Compression.POINTER: 3,
    Compression.DROP: 4,
}


def estimate_tokens(text: str) -> int:
    """Conservative, provider-independent estimate (~3 chars/token).

    This is deliberately the same rule the legacy client uses. It overestimates
    for English prose and underestimates for some CJK/code mixes, which is the
    safer direction for a hard input budget.
    """
    if not text:
        return 0
    return max(1, len(text) // 3)


@dataclass(frozen=True)
class ContextBudget:
    context_window: int
    max_output_tokens: int = 2048
    safety_margin: int = 0
    reserved_tokens: int = 0

    def __post_init__(self) -> None:
        if self.context_window <= 0:
            raise ValueError("context_window must be positive")
        if self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")
        if self.safety_margin < 0 or self.reserved_tokens < 0:
            raise ValueError("margins cannot be negative")

    @property
    def input_budget(self) -> int:
        value = (
            self.context_window
            - self.max_output_tokens
            - max(self.safety_margin, 512 if self.context_window >= 4096 else 128)
            - self.reserved_tokens
        )
        return max(0, value)


def budget_for_model(
    context_window: int,
    max_output_tokens: int,
    *,
    reserved_tokens: int = 0,
) -> ContextBudget:
    safety = max(512, int(context_window * 0.10))
    return ContextBudget(
        context_window=context_window,
        max_output_tokens=max_output_tokens,
        safety_margin=safety,
        reserved_tokens=reserved_tokens,
    )


@dataclass(frozen=True)
class ContextSection:
    name: str
    content: str
    priority: int | None = None
    summary: str | None = None
    digest: str | None = None
    pointer: str | None = None
    required: bool = False
    compressible: bool = True

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("section name is required")
        if self.priority is not None and not (0 <= self.priority <= 100):
            raise ValueError("priority must be between 0 and 100")


@dataclass(frozen=True)
class SectionDecision:
    name: str
    level: Compression
    original_tokens: int
    final_tokens: int
    reason: str


@dataclass(frozen=True)
class ContextReport:
    role: Role
    budget_tokens: int
    original_tokens: int
    final_tokens: int
    fit: bool
    decisions: tuple[SectionDecision, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def compression_ratio(self) -> float:
        if self.original_tokens <= 0:
            return 1.0
        return self.final_tokens / self.original_tokens

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "budgetTokens": self.budget_tokens,
            "originalTokens": self.original_tokens,
            "finalTokens": self.final_tokens,
            "fit": self.fit,
            "compressionRatio": round(self.compression_ratio, 3),
            "decisions": [
                {
                    "name": item.name,
                    "level": item.level.value,
                    "originalTokens": item.original_tokens,
                    "finalTokens": item.final_tokens,
                    "reason": item.reason,
                }
                for item in self.decisions
            ],
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class ContextPacket:
    role: Role
    sections: tuple[ContextSection, ...]
    report: ContextReport

    @property
    def estimated_tokens(self) -> int:
        return self.report.final_tokens

    def render(self, *, include_header: bool = True) -> str:
        parts: list[str] = []
        if include_header:
            parts.append(f"ROLE: {self.role.value}")
            parts.append(f"CONTEXT_TOKENS: {self.report.final_tokens}/{self.report.budget_tokens}")
        for section in self.sections:
            parts.append(f"## {section.name}\n{section.content}".rstrip())
        return "\n\n".join(parts)

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "estimatedTokens": self.estimated_tokens,
            "sections": [
                {"name": section.name, "content": section.content}
                for section in self.sections
            ],
            "report": self.report.to_dict(),
        }


class ContextOverflowError(RuntimeError):
    def __init__(self, message: str, *, report: ContextReport, budget: ContextBudget) -> None:
        self.report = report
        self.budget = budget
        super().__init__(
            f"{message} (required={report.final_tokens}, budget={budget.input_budget}). "
            "Decompose the task, raise the model context, or reduce the required evidence."
        )


@dataclass(frozen=True)
class RolePolicy:
    role: Role
    allowed_sections: frozenset[str] | None
    default_priorities: Mapping[str, int] = field(default_factory=dict)
    allow_drop: bool = True

    def priority_for(self, section: ContextSection) -> int:
        if section.priority is not None:
            return section.priority
        return self.default_priorities.get(section.name, 50)

    def visible(self, section: ContextSection) -> bool:
        return self.allowed_sections is None or section.name in self.allowed_sections


def _policy(role: Role, allowed: Iterable[str], priorities: Mapping[str, int]) -> RolePolicy:
    return RolePolicy(role=role, allowed_sections=frozenset(allowed), default_priorities=priorities)


DEFAULT_ROLE_POLICIES: dict[Role, RolePolicy] = {
    Role.ORCHESTRATOR: _policy(
        Role.ORCHESTRATOR,
        {
            "goal",
            "scope",
            "app_model",
            "tasks_open",
            "tasks_recent",
            "evidence_index",
            "budget",
            "provider_capabilities",
            "operator_notes",
            "checkpoint",
        },
        {
            "goal": 100,
            "scope": 95,
            "operator_notes": 90,
            "tasks_open": 85,
            "app_model": 75,
            "evidence_index": 70,
            "checkpoint": 65,
            "tasks_recent": 55,
            "budget": 50,
            "provider_capabilities": 40,
        },
    ),
    Role.RECON: _policy(
        Role.RECON,
        {"task", "batch", "labels", "schema", "examples", "checkpoint"},
        {
            "task": 100,
            "batch": 90,
            "labels": 80,
            "schema": 75,
            "examples": 40,
            "checkpoint": 35,
        },
    ),
    Role.OPERATOR: _policy(
        Role.OPERATOR,
        {
            "task",
            "allowed_tools",
            "observations",
            "retry_diagnostic",
            "schema",
            "checkpoint",
        },
        {
            "task": 100,
            "allowed_tools": 90,
            "observations": 80,
            "schema": 75,
            "retry_diagnostic": 60,
            "checkpoint": 40,
        },
    ),
    Role.VALIDATOR: _policy(
        Role.VALIDATOR,
        {"hypothesis", "evidence", "gate", "scope", "schema"},
        {
            "hypothesis": 100,
            "evidence": 95,
            "gate": 85,
            "scope": 80,
            "schema": 70,
        },
    ),
    Role.REPORTER: _policy(
        Role.REPORTER,
        {"findings", "evidence", "template", "app_entities", "scope"},
        {
            "findings": 100,
            "evidence": 90,
            "template": 80,
            "app_entities": 60,
            "scope": 50,
        },
    ),
}


@dataclass
class _Prepared:
    section: ContextSection
    priority: int
    level: Compression = Compression.FULL

    @property
    def required(self) -> bool:
        return self.section.required

    def current_content(self) -> str:
        return _content_at(self.level, self.section)

    def tokens(self, estimator: Callable[[str], int]) -> int:
        return estimator(self.current_content())


class ContextAssembler:
    """Builds a bounded packet for one role.

    The optional ``summarizer`` can replace a section's content with a model
    summary before assembly. It must be deterministic for a given input inside
    one task; the report records the compression decision either way.
    """

    def __init__(
        self,
        budget: ContextBudget,
        *,
        policies: Mapping[Role, RolePolicy] | None = None,
        estimator: Callable[[str], int] = estimate_tokens,
        summarizer: Callable[[str, int], str] | None = None,
    ) -> None:
        self.budget = budget
        self.policies = dict(policies or DEFAULT_ROLE_POLICIES)
        self.estimator = estimator
        self.summarizer = summarizer

    def assemble(
        self,
        role: Role,
        sections: Iterable[ContextSection],
        *,
        must_include: Iterable[str] = (),
    ) -> ContextPacket:
        policy = self.policies.get(role)
        if policy is None:
            raise ValueError(f"No context policy for role '{role.value}'")
        must = set(must_include)
        prepared: list[_Prepared] = []
        decisions: list[SectionDecision] = []
        warnings: list[str] = []

        for section in sections:
            if not policy.visible(section):
                decisions.append(
                    SectionDecision(
                        section.name,
                        Compression.DROP,
                        self.estimator(section.content),
                        0,
                        "not visible to this role",
                    )
                )
                warnings.append(f"{section.name}: hidden from {role.value}")
                continue
            if section.name in must:
                section = replace(section, required=True)
            prepared.append(_Prepared(section=section, priority=policy.priority_for(section)))

        if not prepared:
            report = ContextReport(
                role=role,
                budget_tokens=self.budget.input_budget,
                original_tokens=0,
                final_tokens=0,
                fit=True,
                decisions=tuple(decisions),
                warnings=tuple(warnings),
            )
            return ContextPacket(role=role, sections=(), report=report)

        prepared.sort(key=lambda item: (-item.priority, item.section.name))
        original_tokens = sum(item.tokens(self.estimator) for item in prepared)

        def total() -> int:
            return sum(item.tokens(self.estimator) for item in prepared)

        while total() > self.budget.input_budget:
            candidates = [
                item
                for item in prepared
                if item.level is not Compression.DROP
                and item.section.compressible
                and (not item.required or item.level is not Compression.POINTER)
            ]
            if not candidates:
                break
            # Compress the least important thing first; for ties, the largest.
            target = min(
                candidates,
                key=lambda item: (item.priority, -len(item.section.content), item.section.name),
            )
            next_level = _next_level(target.level)
            if target.required and next_level is Compression.DROP:
                next_level = Compression.POINTER
            if next_level is target.level:
                break
            target.level = next_level

        if total() > self.budget.input_budget and policy.allow_drop:
            # Last resort: drop optional sections, lowest priority first.
            for item in sorted(
                (entry for entry in prepared if not entry.required and entry.level is not Compression.DROP),
                key=lambda entry: (entry.priority, entry.section.name),
            ):
                item.level = Compression.DROP
                if total() <= self.budget.input_budget:
                    break

        final_tokens = total()
        fit = final_tokens <= self.budget.input_budget
        final_sections: list[ContextSection] = []
        for item in prepared:
            decision_tokens = 0 if item.level is Compression.DROP else item.tokens(self.estimator)
            decisions.append(
                SectionDecision(
                    item.section.name,
                    item.level,
                    self.estimator(item.section.content),
                    decision_tokens,
                    _reason(item.level),
                )
            )
            if item.level is Compression.DROP:
                continue
            final_sections.append(replace(item.section, content=item.current_content()))

        report = ContextReport(
            role=role,
            budget_tokens=self.budget.input_budget,
            original_tokens=original_tokens,
            final_tokens=final_tokens,
            fit=fit,
            decisions=tuple(decisions),
            warnings=tuple(warnings),
        )
        if not fit:
            raise ContextOverflowError(
                "Context packet exceeds the input budget",
                report=report,
                budget=self.budget,
            )
        return ContextPacket(role=role, sections=tuple(final_sections), report=report)


def _next_level(level: Compression) -> Compression:
    if level is Compression.FULL:
        return Compression.SUMMARY
    if level is Compression.SUMMARY:
        return Compression.DIGEST
    if level is Compression.DIGEST:
        return Compression.POINTER
    if level is Compression.POINTER:
        return Compression.DROP
    return Compression.DROP


def _content_at(level: Compression, section: ContextSection) -> str:
    if level is Compression.FULL:
        return section.content
    if level is Compression.SUMMARY:
        return section.summary or _fallback_summary(section.content)
    if level is Compression.DIGEST:
        return section.digest or _fallback_digest(section.name, section.content)
    if level is Compression.POINTER:
        return section.pointer or _fallback_pointer(section.name, section.content)
    return ""


def _fallback_summary(content: str, *, limit: int = 600) -> str:
    text = " ".join(content.split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + " …[summary]"


def _fallback_digest(name: str, content: str, *, limit: int = 200) -> str:
    first = next((line.strip() for line in content.splitlines() if line.strip()), "")
    digest = hashlib.sha1(content.encode("utf-8", errors="replace")).hexdigest()[:12]
    text = f"{name}: {first[:limit]} [{len(content)} chars, sha1:{digest}]"
    return text[:limit]


def _fallback_pointer(name: str, content: str) -> str:
    digest = hashlib.sha1(content.encode("utf-8", errors="replace")).hexdigest()[:12]
    return f"ref:{name}:{digest}"


def _reason(level: Compression) -> str:
    return {
        Compression.FULL: "fits as-is",
        Compression.SUMMARY: "compressed to summary",
        Compression.DIGEST: "compressed to digest",
        Compression.POINTER: "replaced with pointer",
        Compression.DROP: "dropped",
    }[level]


def packet_json(packet: ContextPacket) -> str:
    """Canonical JSON for journal/model-call logs."""
    return json.dumps(packet.to_dict(), ensure_ascii=False, sort_keys=True)
