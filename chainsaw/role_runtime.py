"""Resolve role assignments to concrete providers and models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .providers import ChatProvider, build_provider
from .roles import Role, RoleRoutingError
from .runner import LLMActionProvider, LLMDecisionProvider
from .workbench import WorkbenchStore


@dataclass(frozen=True)
class RoleModel:
    provider_id: str
    model_id: str

    def to_dict(self) -> dict[str, str]:
        return {"providerId": self.provider_id, "modelId": self.model_id}


@dataclass
class RoleProviderSet:
    decision_provider: LLMDecisionProvider
    action_provider: LLMActionProvider
    providers: dict[str, ChatProvider] = field(default_factory=dict)
    models: dict[str, RoleModel] = field(default_factory=dict)

    def close(self) -> None:
        closed: set[str] = set()
        for provider_id, provider in self.providers.items():
            if provider_id in closed:
                continue
            closed.add(provider_id)
            close = getattr(provider, "close", None)
            if callable(close):
                close()

    def model_summary(self) -> dict[str, dict[str, str]]:
        return {role: model.to_dict() for role, model in self.models.items()}


def normalize_role_models(
    roles: dict[str, Any] | None,
    *,
    default_provider_id: str,
    default_model: str,
    known_providers: set[str],
) -> dict[str, RoleModel]:
    """Normalize API/project role config into concrete provider/model refs.

    Accepted value shapes:
    - ``"model"`` -> default provider
    - ``"provider/model"`` when provider is known
    - ``"provider::model"``
    - ``{"providerId": "...", "model": "..."}``
    """

    values = roles or {}
    result: dict[str, RoleModel] = {}
    for role in Role.all():
        raw = values.get(role.value)
        if raw is None or raw == "":
            if not default_provider_id:
                raise RoleRoutingError(
                    f"Role '{role.value}' has no model and no default provider is configured."
                )
            result[role.value] = RoleModel(default_provider_id, default_model)
            continue
        if isinstance(raw, dict):
            provider_id = str(
                raw.get("providerId")
                or raw.get("provider_id")
                or raw.get("provider")
                or default_provider_id
            ).strip()
            model_id = str(raw.get("modelId") or raw.get("model") or raw.get("id") or "").strip()
        else:
            text = str(raw).strip()
            provider_id = default_provider_id
            model_id = text
            if "::" in text:
                provider_id, model_id = (part.strip() for part in text.split("::", 1))
            elif "/" in text:
                prefix, suffix = text.split("/", 1)
                if prefix in known_providers:
                    provider_id, model_id = prefix, suffix
        if not provider_id:
            raise RoleRoutingError(
                f"Role '{role.value}' has no provider; set a default provider first."
            )
        if not model_id:
            raise RoleRoutingError(f"Role '{role.value}' has no model id.")
        result[role.value] = RoleModel(provider_id, model_id)
    return result


def build_role_providers(
    *,
    entries: list[dict[str, Any]],
    roles: dict[str, Any] | None,
    default_provider_id: str,
    default_model: str,
    store: WorkbenchStore,
    provider_factory=build_provider,
) -> RoleProviderSet:
    index: dict[str, dict[str, Any]] = {}
    for entry in entries:
        for key in (str(entry.get("id", "")), str(entry.get("name", ""))):
            if key:
                index[key] = entry
    known = set(index)
    models = normalize_role_models(
        roles,
        default_provider_id=default_provider_id,
        default_model=default_model,
        known_providers=known,
    )
    providers: dict[str, ChatProvider] = {}
    for role, ref in models.items():
        if ref.provider_id not in index:
            raise RoleRoutingError(
                f"Role '{role}' references unknown provider '{ref.provider_id}'."
            )
        if ref.provider_id not in providers:
            providers[ref.provider_id] = provider_factory(
                index[ref.provider_id], model=ref.model_id
            )
    orchestrator = models[Role.ORCHESTRATOR.value]
    operator = models[Role.OPERATOR.value]
    decision = LLMDecisionProvider(
        providers[orchestrator.provider_id],
        model=orchestrator.model_id,
    )
    action = LLMActionProvider(
        providers[operator.provider_id],
        store,
        model=operator.model_id,
    )
    return RoleProviderSet(
        decision_provider=decision,
        action_provider=action,
        providers=providers,
        models=models,
    )
