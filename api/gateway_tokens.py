"""Control-API routes to mint/list/revoke tenant gateway tokens (SPEC §8).

A gateway token is the machine-to-machine credential a customer's agent presents
to ``/v1/authorize`` (or the MCP gateway). Only its SHA-256 hash is stored; the
raw secret is shown exactly once at creation. Admin-only.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from api.deps import database_url, enforce_stock, require_tenant
from api.security import require_role
from core import db, tenant_tokens
from core.entitlements import Metric
from core.schemas import CurrentUser, GatewayTokenCreate, GatewayTokenCreated, GatewayTokenOut, Role

router = APIRouter(prefix="/v1/gateway-tokens", tags=["gateway-tokens"])

_require_admin = require_role(Role.admin)


@router.get("", response_model=list[GatewayTokenOut])
def list_gateway_tokens(
    request: Request, user: CurrentUser = Depends(_require_admin)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        return tenant_tokens.list_tokens(conn, tenant_id)


@router.post("", response_model=GatewayTokenCreated, status_code=status.HTTP_201_CREATED)
def create_gateway_token(
    payload: GatewayTokenCreate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        # Un jeton de passerelle **est** un agent : c'est l'identité sur laquelle le
        # taint, les fenêtres d'observation et l'attribution d'audit sont toutes
        # clés. Le plafond se compte donc ici, sur les jetons vivants — un jeton
        # révoqué n'occupe plus de place, sinon un client atteindrait son plafond
        # avec des identités qui ne peuvent plus rien faire.
        enforce_stock(
            conn,
            tenant_id,
            Metric.agents,
            compte_sql=(
                "select count(*) from gateway_tokens "
                "where tenant_id::text = %s and revoked_at is null"
            ),
            etiquette="agents",
        )
        raw, view = tenant_tokens.mint(conn, tenant_id=tenant_id, name=payload.name)
    return {**view, "token": raw}


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_gateway_token(
    token_id: str,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> Response:
    tenant_id = require_tenant(user)
    try:
        UUID(token_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Token not found"
        ) from None
    with db.connection(database_url(request)) as conn:
        revoked = tenant_tokens.revoke(conn, tenant_id, token_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
