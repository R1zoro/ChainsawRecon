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


class SessionRunCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    max_steps: int = Field(default=10, ge=1, le=200, alias="maxSteps")
    context_window: int = Field(default=8192, ge=1024, alias="contextWindow")
    max_output_tokens: int = Field(default=1024, ge=64, alias="maxOutputTokens")
    provider_id: str = Field(default="", alias="providerId")
    model: str = ""


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


class CoverageCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    risk_area: str = Field(alias="riskArea")
    outcome: str
    surface: str = ""
    evidence_id: str = Field(default="", alias="evidenceId")
    reason: str = ""
    worker: str = ""


class FindingTransition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    state: str
    reason: str = ""
    evidence_ids: list[str] = Field(default_factory=list, alias="evidenceIds")


class ReplayPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    query: dict[str, str] | None = None
    path: str | None = None
    url: str | None = None
    method: str | None = None
    header: dict[str, str] | None = None
    cookie: dict[str, str] | None = None
    form: dict[str, str] | None = None
    json_body: Any = Field(default=None, alias="json")


class ReplayCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    request_id: str = Field(alias="requestId")
    project_id: str = Field(default="", alias="projectId")
    patch: ReplayPatch = Field(default_factory=ReplayPatch)
    session_id: str = Field(default="", alias="sessionId")
    justification: str = ""


class CompareCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    baseline_id: str = Field(alias="baselineId")
    candidate_id: str = Field(alias="candidateId")


class EvidenceCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    request_id: str = Field(alias="requestId")
    response_id: str = Field(default="", alias="responseId")
    hypothesis_id: str = Field(default="", alias="hypothesisId")
    task_id: str = Field(default="", alias="taskId")
    note: str = ""
    session_id: str = Field(default="", alias="sessionId")


class ImportCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    project_id: str = Field(default="", alias="projectId")
    format: Literal["har", "burp_xml"] = "har"
    path: str


class ProxyStart(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    project_id: str = Field(alias="projectId")
    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=0, le=65535)
    verify_upstream: bool = Field(default=True, alias="verifyUpstream")


class ProxyStop(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    project_id: str = Field(alias="projectId")
