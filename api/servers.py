"""Control-API routes for downstream server declarations (SPEC §8, M2).

Reads use an RLS-scoped connection (tenant isolation enforced by Postgres);
writes are admin-only and scope by the caller's tenant id.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from psycopg import errors as pg_errors

from api.deps import database_url as _database_url
from api.deps import enforce_stock
from api.deps import require_tenant as _require_tenant
from api.security import get_current_user, require_role
from core import db, servers
from core.entitlements import Metric
from core.schemas import CurrentUser, Role, ServerCreate, ServerOut, ServerUpdate

router = APIRouter(prefix="/v1/servers", tags=["servers"])

# Module-level dependency singletons (keeps the call out of argument defaults).
_require_admin = require_role(Role.admin)


@router.get("", response_model=list[ServerOut])
def list_servers(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    url = _database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=user.tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return servers.list_servers(conn)


@router.post("", response_model=ServerOut, status_code=status.HTTP_201_CREATED)
def create_server(
    payload: ServerCreate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = _require_tenant(user)
    url = _database_url(request)
    with db.connection(url) as conn:
        enforce_stock(
            conn,
            tenant_id,
            Metric.downstream_servers,
            compte_sql="select count(*) from downstream_servers where tenant_id::text = %s",
            etiquette="downstream servers",
        )
        try:
            return servers.create_server(
                conn, tenant_id, payload.name, payload.transport.value, payload.config
            )
        except pg_errors.UniqueViolation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Server name already exists"
            ) from None


@router.patch("/{server_id}", response_model=ServerOut)
def update_server(
    server_id: str,
    payload: ServerUpdate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = _require_tenant(user)
    try:
        UUID(server_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        ) from None
    url = _database_url(request)
    with db.connection(url) as conn:
        row = servers.update_server(
            conn,
            tenant_id,
            server_id,
            name=payload.name,
            config=payload.config,
            enabled=payload.enabled,
        )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return row
