"""Control-API route for the supervision room: verdicts, guard latency, approvals, probes.

One read of the tenant's own audit log and approvals, aggregated in SQL over the
whole window (`core/supervision.py`). Metadata and counts only: no argument, no
prompt, no detected value ever leaves through it (CLAUDE.md §4.10).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.deps import database_url, require_tenant
from api.ratelimit import limiter, supervision_rate_limit
from api.security import get_current_user
from core import db, supervision
from core.schemas import CurrentUser, Role

router = APIRouter(prefix="/v1/supervision", tags=["supervision"])


@router.get("", response_model=supervision.Supervision)
@limiter.limit(supervision_rate_limit)
def read_supervision(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    window: Annotated[supervision.Window, Query()] = "24h",
    agent_id: Annotated[UUID | None, Query()] = None,
    client_id: Annotated[UUID | None, Query()] = None,
) -> supervision.Supervision:
    tenant_id = require_tenant(user)
    with db.tenant_reader(
        database_url(request),
        user_id=user.user_id,
        tenant_id=tenant_id,
        role=(user.role or Role.viewer),
    ) as conn:
        return supervision.build(
            conn,
            tenant_id=tenant_id,
            window=window,
            agent=str(agent_id) if agent_id else None,
            client_id=str(client_id) if client_id else None,
        )
