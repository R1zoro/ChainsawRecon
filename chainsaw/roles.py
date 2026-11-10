"""Model role routing.

Roles are contracts, not separate agents. Any configured model can fill any
role, and a single model can fill every role. The routing object only describes
the assignment and its fallbacks; the controller enforces it at call time.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any


class Role(str, Enum):
    ORCHESTRATOR = "orchestrator"
    RECON = "recon"
    OPERATOR = "operator"
    VALIDATOR = "validator"
    REPORTER = "reporter"

    @classmethod
    def all(cls) -> tuple[Role, ...]:
        return (
            cls.ORCHESTRATOR,
            cls.RECON,
            cls.OPERATOR,
            cls.VALIDATOR,
            cls.REPORTER,
        )


class Reliability(str, Enum):
    STABLE = "stable"
    BEST_EFFORT = "best-effort"


@dataclass(frozen=True)
class ModelRef:
    """A configured provider/model plus the capabilities the router needs."""

    provider_id: str
    model_id: str
    context_window: int
    max_output_tokens: int = 2048
    supports_tools: bool = False
    reliability: Reliability = Reliability.STABLE
    available: bool = True

    def __post_init__(self) -> None:
        if not self.provider_id or not self.model_id:
            raise ValueError("model reference requires provider_id and model_id")
        if self.context_window <= 0:
            raise ValueError("context_window must be positive")
        if self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")
        if self.max_output_tokens >= self.context_window:
            raise ValueError("max_output_tokens must be smaller than context_window")


@dataclass(frozen=True)
class RoleAssignment:
    role: Role
    model: ModelRef
    fallback: tuple[ModelRef, ...] = ()
    max_output_tokens: int | None = None
    context_limit: int | None = None
    timeout_seconds: int = 180
    enabled: bool = True

    def __post_init__(self) -> None:
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")
        if self.context_limit is not None and self.context_limit <= 0:
            raise ValueError("context_limit must be positive")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")

    @property
    def output_budget(self) -> int:
        return self.max_output_tokens or self.model.max_output_tokens

    @property
    def context_budget(self) -> int:
        return self.context_limit or self.model.context_window

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role.value,
            "providerId": self.model.provider_id,
            "modelId": self.model.model_id,
            "fallback": [
                {"providerId": item.provider_id, "modelId": item.model_id}
                for item in self.fallback
            ],
            "maxOutputTokens": self.output_budget,
            "contextLimit": self.context_limit,
            "timeoutSeconds": self.timeout_seconds,
            "enabled": self.enabled,
        }


class RoleRoutingError(ValueError):
    pass


class RoleUnavailableError(RoleRoutingError):
    def __init__(self, role: Role, reason: str) -> None:
        self.role = role
        self.reason = reason
        super().__init__(
            f"Role '{role.value}' has no usable model: {reason}. "
            "Connect a provider in Models and assign a model to this role."
        )


@dataclass(frozen=True)
class RoleRouting:
    assignments: Mapping[Role, RoleAssignment]
    preset: str = "custom"

    def __post_init__(self) -> None:
        missing = [role for role in Role.all() if role not in self.assignments]
        if missing:
            names = ", ".join(role.value for role in missing)
            raise RoleRoutingError(
                f"Every role must be assigned. Missing: {names}. "
                "Connect a provider first, then assign a model to each role."
            )

    @classmethod
    def solo(cls, model: ModelRef, *, preset: str = "solo") -> RoleRouting:
        """One model fills every role. Role prompts still differ at call time."""
        return cls(
            assignments={
                role: RoleAssignment(role=role, model=model) for role in Role.all()
            },
            preset=preset,
        )

    @classmethod
    def from_mapping(
        cls,
        assignments: Mapping[Role | str, RoleAssignment],
        *,
        preset: str = "custom",
    ) -> RoleRouting:
        normalized: dict[Role, RoleAssignment] = {}
        for key, value in assignments.items():
            role = key if isinstance(key, Role) else Role(str(key))
            normalized[role] = value
        return cls(assignments=normalized, preset=preset)

    def assignment(self, role: Role) -> RoleAssignment:
        try:
            return self.assignments[role]
        except KeyError as exc:
            raise RoleUnavailableError(role, "no assignment") from exc

    def effective(self, role: Role) -> tuple[ModelRef, bool]:
        """Return the first available model and whether a fallback was used."""
        assignment = self.assignment(role)
        if not assignment.enabled:
            raise RoleUnavailableError(role, "assignment is disabled")
        if assignment.model.available:
            return assignment.model, False
        for candidate in assignment.fallback:
            if candidate.available:
                return candidate, True
        raise RoleUnavailableError(role, "primary and all fallbacks are unavailable")

    def validate(self, available: Mapping[str, Iterable[str]] | None = None) -> list[str]:
        """Return warnings; raise only for a structurally unusable routing.

        ``available`` maps provider_id -> iterable of model IDs. When supplied,
        every assignment and fallback must exist in that catalog. This is how
        the UI prevents ghost providers.
        """
        warnings: list[str] = []
        catalog = (
            {provider: set(models) for provider, models in available.items()}
            if available is not None
            else None
        )
        for role in Role.all():
            assignment = self.assignment(role)
            refs = (assignment.model, *assignment.fallback)
            if catalog is not None:
                for ref in refs:
                    models = catalog.get(ref.provider_id)
                    if models is None:
                        raise RoleRoutingError(
                            f"Role '{role.value}' references unconfigured provider "
                            f"'{ref.provider_id}'."
                        )
                    if ref.model_id not in models:
                        raise RoleRoutingError(
                            f"Role '{role.value}' references model "
                            f"'{ref.model_id}' that is not available from "
                            f"'{ref.provider_id}'."
                        )
            if not assignment.model.supports_tools and role in {Role.OPERATOR}:
                warnings.append(
                    f"{role.value}: model '{assignment.model.model_id}' has no native "
                    "tool calling; the operator will use the JSON action protocol."
                )
            if assignment.context_budget < 4096:
                warnings.append(
                    f"{role.value}: context budget is only "
                    f"{assignment.context_budget} tokens; the controller will "
                    "decompose or refuse oversized tasks."
                )
            if assignment.model.reliability is Reliability.BEST_EFFORT:
                warnings.append(
                    f"{role.value}: '{assignment.model.model_id}' is best-effort; "
                    "configure a fallback."
                )
        return warnings

    def to_dict(self) -> dict[str, Any]:
        return {
            "preset": self.preset,
            "roles": [
                self.assignment(role).to_dict() for role in Role.all()
            ],
        }


def manual_routing(
    *,
    orchestrator: ModelRef,
    recon: ModelRef | None = None,
    operator: ModelRef | None = None,
    validator: ModelRef | None = None,
    reporter: ModelRef | None = None,
    preset: str = "custom",
) -> RoleRouting:
    """Build a routing where each role may use a different model.

    Omitted roles inherit the orchestrator, which keeps single-provider setups
    trivial without forcing a fixed model per role.
    """
    return RoleRouting(
        assignments={
            Role.ORCHESTRATOR: RoleAssignment(Role.ORCHESTRATOR, orchestrator),
            Role.RECON: RoleAssignment(Role.RECON, recon or orchestrator),
            Role.OPERATOR: RoleAssignment(Role.OPERATOR, operator or orchestrator),
            Role.VALIDATOR: RoleAssignment(Role.VALIDATOR, validator or orchestrator),
            Role.REPORTER: RoleAssignment(Role.REPORTER, reporter or orchestrator),
        },
        preset=preset,
    )
