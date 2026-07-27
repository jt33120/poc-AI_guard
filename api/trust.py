"""Control-API route for earned-trust observability (M11, axis C).

``GET /v1/trust`` — per-tool earned-trust view for the tenant (how many clean
approvals each tool has accrued, and whether it has crossed the trust threshold
that discounts its risk score). Read-only, RLS-scoped; any member may read.

Trust is scoped per (tenant, tool) — the same key the risk engine uses — not per
agent, since the gateway audit path does not carry an agent id.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import db, trust
from core.schemas import CurrentUser, Role, ToolTrustRow

router = APIRouter(prefix="/v1", tags=["trust"])


@router.get("/trust", response_model=list[ToolTrustRow])
def list_trust(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return trust.summary(conn, tenant_id)
