"""Tenant-scoped workstation inventory and evidence for the console."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import db
from core import extension_devices as devices
from core.schemas import CurrentUser, Role

router = APIRouter(prefix="/v1/extensions", tags=["extensions"])


@router.get("/devices")
def inventory(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    with db.tenant_reader(
        database_url(request),
        user_id=user.user_id,
        tenant_id=require_tenant(user),
        role=user.role or Role.viewer,
    ) as conn:
        rows = conn.execute(
            "select d.id,d.platform,d.extension_version,d.mode,d.registered_at,d.last_seen_at,"
            "g.name,g.revoked_at,"
            "(select count(*) from extension_events e "
            "where e.device_id=d.id and e.source='gateway') "
            "from extension_devices d join gateway_tokens g on g.id=d.gateway_token_id "
            "order by d.last_seen_at desc limit 500"
        ).fetchall()
    columns = (
        "id",
        "platform",
        "extension_version",
        "mode",
        "registered_at",
        "last_seen_at",
        "name",
        "revoked_at",
        "gateway_events",
    )
    return [dict(zip(columns, row, strict=True)) for row in rows]


@router.get("/events")
def events(
    request: Request,
    device_id: UUID | None = None,
    before: int | None = Query(None, ge=1),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    tenant = require_tenant(user)
    with db.tenant_reader(
        database_url(request), user_id=user.user_id, tenant_id=tenant, role=user.role or Role.viewer
    ) as conn:
        rows = conn.execute(
            "select id,device_id,event_id,source,received_at,payload,prev_hash,entry_hash "
            "from extension_events where (%s::uuid is null or device_id=%s) "
            "and (%s::bigint is null or id < %s) order by id desc limit 101",
            (device_id, device_id, before, before),
        ).fetchall()
    columns = (
        "id",
        "device_id",
        "event_id",
        "source",
        "received_at",
        "payload",
        "prev_hash",
        "entry_hash",
    )
    return {
        "events": [dict(zip(columns, row, strict=True)) for row in rows[:100]],
        "next_before": rows[99][0] if len(rows) > 100 else None,
    }


@router.get("/verify")
def verify(request: Request, user: CurrentUser = Depends(get_current_user)) -> dict[str, bool]:
    tenant = require_tenant(user)
    with db.tenant_reader(
        database_url(request), user_id=user.user_id, tenant_id=tenant, role=user.role or Role.viewer
    ) as conn:
        return {"valid": devices.verify(conn, tenant)}
