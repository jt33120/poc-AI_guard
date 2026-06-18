"""Control-API route: aggregated LLM token usage + estimated cost.

Powers the cost dashboard. Read-only, available to any tenant member; optionally
filtered to a single agent (gateway token) and/or a time window. Tenant-scoped by
RLS — never returns content or PII, only counts and an estimated price (§4.10).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import billing, db, usage
from core.schemas import CurrentUser, Role, UsageSummary

router = APIRouter(prefix="/v1/usage", tags=["usage"])


@router.get("", response_model=UsageSummary)
def get_usage(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    agent_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        summary = usage.summary(
            conn, agent_id=agent_id, from_ts=from_ts, to_ts=to_ts, client_id=client_id
        )
        summary["billed_cost_usd"] = billing.total_billed(
            conn, agent_id=agent_id, from_ts=from_ts, to_ts=to_ts, client_id=client_id
        )
        return summary
