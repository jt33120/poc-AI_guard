"""Device-initiated enrollment with an authenticated admin confirmation."""

from typing import Annotated, Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from slowapi.util import get_remote_address

from api.deps import database_url, require_tenant
from api.ratelimit import limiter
from api.security import require_role
from core import db
from core import extension_pairing as pairing
from core.schemas import CurrentUser, Role
from core.tenant_tokens import hash_token

router = APIRouter(tags=["extension-pairing"])
_admin = require_role(Role.admin)
_code = r"^[A-Z2-9]{5}-[A-Z2-9]{5}$"


def _pairing_key(request: Request) -> str:
    # Polls share the console edge IP. Partition by the possession proof,
    # retaining only its hash, so one enrolling workstation cannot block others.
    credential = request.headers.get("x-gateway-token", "")
    return f"pairing:{hash_token(credential)}" if credential else get_remote_address(request)


@router.post("/v1/extension-enrollment/start", status_code=201)
@limiter.limit("10/minute", key_func=get_remote_address)
def start(data: pairing.PairingStart, request: Request) -> dict[str, Any]:
    try:
        with db.connection(database_url(request)) as conn, conn.transaction():
            return pairing.start(conn, data)
    except OverflowError:
        raise HTTPException(429, "Enrollment temporarily unavailable") from None
    except psycopg.IntegrityError:
        raise HTTPException(409, "Start a new enrollment request") from None


@router.post("/v1/extension-enrollment/status")
@limiter.limit("20/minute", key_func=_pairing_key)
def poll(
    request: Request, x_gateway_token: Annotated[str, Header(max_length=100)]
) -> dict[str, Any]:
    try:
        with db.connection(database_url(request)) as conn:
            return pairing.poll(conn, x_gateway_token)
    except LookupError:
        raise HTTPException(410, "Enrollment expired or unavailable") from None


@router.post("/v1/extension-enrollment/cancel")
@limiter.limit("20/minute", key_func=_pairing_key)
def cancel(
    request: Request,
    x_gateway_token: Annotated[str, Header(max_length=100)],
) -> dict[str, bool]:
    with db.connection(database_url(request)) as conn, conn.transaction():
        row = conn.execute(
            "delete from extension_pairings where credential_hash=%s returning gateway_token_id",
            (hash_token(x_gateway_token),),
        ).fetchone()
        if row and row[0]:
            conn.execute("update gateway_tokens set revoked_at=now() where id=%s", (row[0],))
    return {"cancelled": True}


@router.get("/v1/extensions/enrollment")
@limiter.limit("10/minute")
def inspect(
    request: Request,
    code: Annotated[str, Query(pattern=_code)],
    user: CurrentUser = Depends(_admin),
) -> dict[str, Any]:
    require_tenant(user)
    try:
        with db.connection(database_url(request)) as conn:
            return pairing.inspect(conn, code)
    except LookupError:
        raise HTTPException(410, "Enrollment expired or unavailable") from None


@router.post("/v1/extensions/enrollment")
@limiter.limit("10/minute")
def approve(
    data: pairing.PairingApproval,
    request: Request,
    user: CurrentUser = Depends(_admin),
) -> dict[str, str]:
    try:
        with db.connection(database_url(request)) as conn, conn.transaction():
            device = pairing.approve(conn, require_tenant(user), user.user_id, data)
        return {"device_id": device}
    except LookupError:
        raise HTTPException(410, "Enrollment expired or already confirmed") from None
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except (ValueError, psycopg.IntegrityError):
        raise HTTPException(409, "This installation is already registered") from None
