"""Shared Pydantic models and domain enums."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class Role(StrEnum):
    """Tenant-scoped RBAC roles (mirrors the memberships.role check constraint)."""

    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class CurrentUser(BaseModel):
    """Authenticated principal resolved from a verified Supabase JWT."""

    user_id: str = Field(max_length=64)
    tenant_id: str | None = Field(default=None, max_length=64)
    role: Role | None = None


class Transport(StrEnum):
    """Downstream MCP transport kind."""

    stdio = "stdio"
    http = "http"


class ServerCreate(BaseModel):
    """Payload to declare a downstream MCP server."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)
    transport: Transport
    config: dict[str, Any]
    enabled: bool = True

    @model_validator(mode="after")
    def _check_transport_config(self) -> ServerCreate:
        if self.transport is Transport.stdio and not self.config.get("command"):
            raise ValueError("stdio transport requires config.command")
        if self.transport is Transport.http and not self.config.get("url"):
            raise ValueError("http transport requires config.url")
        return self


class ServerUpdate(BaseModel):
    """Partial update for a downstream server."""

    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=80)
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class ServerOut(BaseModel):
    """A downstream server as returned by the API."""

    id: str
    name: str
    transport: Transport
    config: dict[str, Any]
    enabled: bool


class PolicyDocument(BaseModel):
    """A tenant's policy document and its version."""

    yaml: str
    version: int


class PolicyUpdate(BaseModel):
    """Payload to replace a tenant's policy YAML."""

    model_config = {"extra": "forbid"}

    yaml: str = Field(min_length=1, max_length=100_000)


class PolicyDraftRequest(BaseModel):
    """Natural-language description to draft a policy from (LLM assistant)."""

    model_config = {"extra": "forbid"}

    prompt: str = Field(min_length=1, max_length=2000)


class ToolView(BaseModel):
    """A tool exposed to the agent with its effective policy classification."""

    name: str
    canonical: str
    action_class: str | None
    decision: str


class ApprovalOut(BaseModel):
    """An approval request as shown in the approval queue."""

    id: str
    request_id: str
    tool_name: str
    action_class: str | None
    status: str
    dry_run: dict[str, Any]
    required_count: int
    approved_by: list[str]
    created_at: str | None
    expires_at: str | None
    decided_at: str | None
    decided_by: str | None


class DecisionRequest(BaseModel):
    """Operator decision on a pending approval."""

    model_config = {"extra": "forbid"}

    decision: Literal["approve", "deny"]


class AuthorizeRequest(BaseModel):
    """An agent asking permission to perform an action (cooperative gating)."""

    model_config = {"extra": "forbid"}

    tool: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = Field(default=None, max_length=128)


class AuthorizeResponse(BaseModel):
    """The verdict returned to the agent: allow / deny / hold (+ approval to poll)."""

    decision: Literal["allow", "deny", "hold"]
    status: str | None = None
    approval_id: str | None = None
    action_class: str | None = None
    reason: str | None = None
    summary: str | None = None


class GatewayTokenCreate(BaseModel):
    """Payload to mint a tenant gateway token."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=80)


class GatewayTokenOut(BaseModel):
    """A gateway token's metadata (never the raw secret)."""

    id: str
    name: str
    created_at: str | None
    last_used_at: str | None
    revoked_at: str | None


class GatewayTokenCreated(GatewayTokenOut):
    """A freshly minted token — includes the raw secret, shown exactly once."""

    token: str


class AuditEntry(BaseModel):
    """An immutable audit-log entry (metadata only)."""

    id: int
    ts: str | None
    tool_name: str | None
    action_class: str | None
    decision: str | None
    policy_rule_id: str | None
    judge_used: bool
    args_hash: str | None
    latency_ms: int | None
    error: str | None
    user_id: str | None
    request_id: str | None
