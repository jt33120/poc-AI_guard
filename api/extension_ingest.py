"""Workstation enrollment and asynchronous, metadata-only event batches."""

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import database_url
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from api.ratelimit import limiter
from core import db
from core import extension_devices as devices

router = APIRouter(prefix="/v1/extension", tags=["extension-ingest"])


@router.post("/register")
@limiter.limit("30/minute")
def register(
    data: devices.Registration,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, str]:
    try:
        with db.connection(database_url(request)) as conn:
            device = devices.register(conn, principal.tenant_id, principal.token_id, data)
    except (ValueError, psycopg.IntegrityError):
        raise HTTPException(409, "Use a dedicated gateway token for each workstation") from None
    return {"device_id": device, "redaction": "required", "protocol": "anthropic-messages-v1"}


@router.post("/events")
@limiter.limit("120/minute")
def events(
    data: devices.Batch,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    try:
        with db.connection(database_url(request)) as conn, conn.transaction():
            device = devices.device_for(conn, principal.tenant_id, principal.token_id)
            for event in data.events:
                devices.record(
                    conn,
                    principal.tenant_id,
                    device,
                    str(event.event_id),
                    "extension",
                    event.model_dump(mode="json"),
                )
    except LookupError:
        raise HTTPException(409, "Register this workstation first") from None
    except ValueError:
        raise HTTPException(409, "Event identifier conflict") from None
    return {"accepted": [str(event.event_id) for event in data.events]}
