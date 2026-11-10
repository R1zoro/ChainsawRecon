from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ScopeInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    program_name: str = Field(default="", alias="programName")
    allowed_domains: list[str] = Field(default_factory=list, alias="allowedDomains")
    excluded_domains: list[str] = Field(default_factory=list, alias="excludedDomains")
    allowed_urls: list[str] = Field(default_factory=list, alias="allowedUrls")
    notes: str = ""
    rate_limits: dict[str, Any] = Field(default_factory=dict, alias="rateLimits")


class AuthProfileInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: str = ""
    label: str = ""
    identity: str = ""
    role: str = ""
    tenant: str = ""
    kind: str = "none"
    persistence: Literal["none", "session_only", "credentials"] = "session_only"
    target_patterns: list[str] = Field(default_factory=list, alias="targetPatterns")
    login_url: str = Field(default="", alias="loginUrl")
    verify_url: str = Field(default="", alias="verifyUrl")
    verify_indicator: str = Field(default="", alias="verifyIndicator")
    maintain_cookies: list[str] = Field(default_factory=list, alias="maintainCookies")


class ProjectCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    path: str
    name: str
    targets: list[str] = Field(default_factory=list)
    raw_scope: str = Field(default="", alias="rawScope")
    scope: ScopeInput | None = None
    auth_profiles: list[AuthProfileInput] = Field(default_factory=list, alias="authProfiles")
    roles: dict[str, str] = Field(default_factory=dict)
    phases: list[str] = Field(default_factory=list)


class ProjectOpen(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    path: str
    initialize: bool = False


class SessionCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    title: str = "Session"
    mode: str = "auto"
    provider: str = ""
    model: str = ""
    targets: list[str] = Field(default_factory=list)


class ProviderCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: str
    type: str = "openai-compatible"
    base_url: str = Field(default="", alias="baseUrl")
    api_key_ref: str = Field(default="", alias="apiKeyRef")
    models: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "unknown"
    reliability: str = "stable"


class MessageCreate(BaseModel):
    content: str
    interrupt: bool = False


class ApprovalDecision(BaseModel):
    reason: str = ""


class NoteCreate(BaseModel):
    content: str
