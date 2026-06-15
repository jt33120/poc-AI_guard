"""Shared Pydantic models and domain enums."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

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


class ToolView(BaseModel):
    """A tool exposed to the agent with its effective policy classification."""

    name: str
    canonical: str
    action_class: str | None
    decision: str
