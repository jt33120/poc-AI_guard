"""Cooperative authorization endpoint for non-MCP agents (SPEC §5.2 over HTTP).

The agent authenticates with its tenant gateway token (``X-Gateway-Token``) and
asks permission *before* acting. The verdict is ``allow`` / ``deny`` / ``hold``;
a hold returns an ``approval_id`` to poll. Same policy → HITL → audit engine as
the MCP gateway; rate-limited (machine-to-machine, may consult the judge).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from api.ratelimit import authorize_rpm_limit, limiter
from core import db, decision, policy_store
from core.config import Settings
from core.judge import build_judge
from core.notify import build_notifier
from core.schemas import AuthorizeRequest, AuthorizeResponse

router = APIRouter(prefix="/v1/authorize", tags=["authorize"])


@router.post("", response_model=AuthorizeResponse)
# `shared_limit` avec une portée nommée, et non `limit` : slowapi range par défaut
# les compartiments par **chemin** (`key_style="url"`), si bien que deux routes du même
# quota s'en partageraient deux. Ici il n'y en a qu'une — mais le quota s'appelle
# `authorize_rpm`, pas « ce chemin-ci », et le nommer maintenant évite d'y revenir le
# jour où une seconde route le rejoint.
@limiter.shared_limit(authorize_rpm_limit, scope="authorize_rpm")
def request_authorization(
    payload: AuthorizeRequest,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    url = database_url(request)
    settings: Settings = request.app.state.settings
    with db.connection(url) as conn:
        policy = policy_store.load_policy(conn, principal.tenant_id)
    return decision.authorize(
        database_url=url,
        policy=policy,
        tenant_id=principal.tenant_id,
        tool=payload.tool,
        arguments=payload.arguments,
        judge=build_judge(settings),
        requested_by="agent",
        timeout_seconds=policy.defaults.hitl_timeout_seconds,
        notifier=build_notifier(settings),
        gateway_token_id=principal.token_id,
        # Was accepted, length-checked and dropped -- a decorative input field, the
        # very shape FR-156 forbids in a published example. It now does what its name
        # promises, as a declared value (FR-161).
        client_request_id=payload.request_id,
    )


@router.get("/{approval_id}", response_model=AuthorizeResponse)
def poll_authorization(
    approval_id: str,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    try:
        UUID(approval_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Authorization not found"
        ) from None
    result = decision.poll(
        database_url=database_url(request),
        tenant_id=principal.tenant_id,
        approval_id=approval_id,
        gateway_token_id=principal.token_id,
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authorization not found")
    return result
