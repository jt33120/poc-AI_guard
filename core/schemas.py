"""Shared Pydantic models and domain enums."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


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
