"""Control-API route: the customer and its monitored agents (gateway tokens).

Read-only and available to any tenant member (including viewers) so the agent
selector works for the demo/read-only account. Tenant-scoped by RLS.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import agents, db
from core.schemas import AgentsOverview, CurrentUser, Role

router = APIRouter(prefix="/v1/agents", tags=["agents"])


@router.get("", response_model=AgentsOverview)
def get_agents(request: Request, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return agents.overview(conn, tenant_id)
