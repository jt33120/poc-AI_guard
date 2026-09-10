"""Control-API routes for client/project entities (the monitored customers).

Listing is available to any tenant member (the scope selector needs it); create,
update, archive and agent-assignment are admin-only. Tenant-scoped throughout.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from api.deps import database_url, enforce_stock, require_tenant
from api.security import get_current_user, require_role
from core import clients, db
from core.entitlements import Metric
from core.schemas import (
    ClientAssign,
    ClientCreate,
    ClientOut,
    ClientUpdate,
    CurrentUser,
    Role,
)

router = APIRouter(prefix="/v1/clients", tags=["clients"])

_require_admin = require_role(Role.admin)


def _valid_uuid(value: str) -> None:
    try:
        UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        ) from None


@router.get("", response_model=list[ClientOut])
def list_clients(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return clients.list_clients(conn, tenant_id)


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(
    payload: ClientCreate, request: Request, user: CurrentUser = Depends(_require_admin)
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        enforce_stock(
            conn,
            tenant_id,
            Metric.clients,
            compte_sql="select count(*) from clients where tenant_id::text = %s",
            etiquette="clients",
        )
        return clients.create_client(
            conn, tenant_id=tenant_id, name=payload.name, website=payload.website
        )


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: str,
    payload: ClientUpdate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    _valid_uuid(client_id)
    with db.connection(database_url(request)) as conn:
        updated = clients.update_client(
            conn,
            tenant_id,
            client_id,
            name=payload.name,
            website=payload.website,
            set_website="website" in payload.model_fields_set,
        )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return updated


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_client(
    client_id: str, request: Request, user: CurrentUser = Depends(_require_admin)
) -> Response:
    tenant_id = require_tenant(user)
    _valid_uuid(client_id)
    with db.connection(database_url(request)) as conn:
        ok = clients.archive_client(conn, tenant_id, client_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/assign", status_code=status.HTTP_204_NO_CONTENT)
def assign_agent(
    payload: ClientAssign, request: Request, user: CurrentUser = Depends(_require_admin)
) -> Response:
    tenant_id = require_tenant(user)
    _valid_uuid(payload.token_id)
    if payload.client_id is not None:
        _valid_uuid(payload.client_id)
    with db.connection(database_url(request)) as conn:
        ok = clients.assign_agent(conn, tenant_id, payload.token_id, payload.client_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
