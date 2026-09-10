"""Control-API routes for AI observability (ADR-0001, Phase 1).

* ``POST /v1/ai-traces`` — ingest OTLP ``gen_ai`` spans pushed by an external
  backend. Machine-to-machine: authenticated by a gateway token (the same
  mechanism as the LLM proxy). Writes to ``usage_events`` (source='otlp').
* ``GET /v1/ai/summary`` — the AI-summary contract for the console, tenant-scoped
  by RLS. (Server-to-server read tokens for the mip-rum facade land with the
  sens-2 integration.)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import database_url, require_tenant
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from api.ratelimit import ai_traces_rate_limit, limiter
from api.security import get_ai_reader
from core import ai_summary, db, otlp_genai
from core import usage as usage_store
from core.schemas import AiCosts, AiDetail, AiIngestResult, AiSummary, CurrentUser, Role

router = APIRouter(prefix="/v1", tags=["ai-observability"])


@router.post("/ai-traces", response_model=AiIngestResult)
@limiter.limit(ai_traces_rate_limit)
async def ingest_ai_traces(
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, int]:
    """Ingest an OTLP payload; extract gen_ai spans into usage_events (idempotent)."""
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expected an object")

    calls, rejected = otlp_genai.parse_gen_ai(payload, now=datetime.now(UTC))
    url = database_url(request)
    inserted = 0
    if calls:
        with db.connection(url) as conn:
            inserted = usage_store.record_ai_calls(
                conn,
                tenant_id=principal.tenant_id,
                gateway_token_id=principal.token_id,
                calls=calls,
            )
            conn.commit()
    return {"ingested": inserted, "rejected": rejected}


@router.get("/ai/summary", response_model=AiSummary)
def get_ai_summary(
    request: Request,
    user: CurrentUser = Depends(get_ai_reader),
    window: str | None = Query(default=None),
    app: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return ai_summary.summary(
            conn, window=window, app=app, agent_id=agent_id, client_id=client_id
        )


@router.get("/ai", response_model=AiDetail)
def get_ai_detail(
    request: Request,
    user: CurrentUser = Depends(get_ai_reader),
    window: str | None = Query(default=None),
    app: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
    recent: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return ai_summary.overview(
            conn,
            window=window,
            app=app,
            agent_id=agent_id,
            client_id=client_id,
            recent_limit=recent,
        )


@router.get("/ai/costs", response_model=AiCosts)
def get_ai_costs(
    request: Request,
    user: CurrentUser = Depends(get_ai_reader),
    window: str | None = Query(default=None),
    group_by: str = Query(default="model"),
    app: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return ai_summary.costs(
            conn, window=window, group_by=group_by, app=app, agent_id=agent_id, client_id=client_id
        )
