"""Control-API routes for read tokens (server-to-server /ai read credentials).

Admins mint/revoke; any member may list (metadata only). The raw token is shown
exactly once, on creation. Read tokens authorize only the /ai read API — they
cannot ingest (unlike gateway tokens).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, read_tokens
from core.schemas import CurrentUser, GatewayTokenCreate, GatewayTokenCreated, GatewayTokenOut, Role

router = APIRouter(prefix="/v1/read-tokens", tags=["read-tokens"])

_require_admin = require_role(Role.admin)


@router.post("", response_model=GatewayTokenCreated, status_code=status.HTTP_201_CREATED)
def create_read_token(
    payload: GatewayTokenCreate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.connection(url) as conn:
        raw, view = read_tokens.mint(conn, tenant_id=tenant_id, name=payload.name)
    return {**view, "token": raw}


@router.get("", response_model=list[GatewayTokenOut])
def list_read_tokens(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return read_tokens.list_tokens(conn, tenant_id)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_read_token(
    token_id: str,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> None:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.connection(url) as conn:
        ok = read_tokens.revoke(conn, tenant_id, token_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
