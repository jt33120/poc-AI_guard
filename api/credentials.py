"""Control-API routes to connect/list/revoke customer provider credentials.

Admin-only. The secret is envelope-encrypted before storage and is **never**
returned by any route — list/connect responses carry metadata only. Storage
fails closed (503) if no secrets backend is configured (CLAUDE.md §4.4/§4.7).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from api.deps import database_url, require_tenant
from api.security import require_role
from core import credentials, db, secrets
from core.config import Settings
from core.schemas import CredentialCreate, CredentialOut, CurrentUser, Role

router = APIRouter(prefix="/v1/credentials", tags=["credentials"])

_require_admin = require_role(Role.admin)


@router.get("", response_model=list[CredentialOut])
def list_credentials(
    request: Request, user: CurrentUser = Depends(_require_admin)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        return credentials.list_credentials(conn, tenant_id)


@router.post("", response_model=CredentialOut, status_code=status.HTTP_201_CREATED)
def connect_credential(
    payload: CredentialCreate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    settings: Settings = request.app.state.settings
    try:
        provider_kp = secrets.build_key_provider(settings)
    except secrets.SecretsError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Secret storage is not configured",
        ) from None
    with db.connection(database_url(request)) as conn:
        return credentials.store_credential(
            conn,
            provider_kp,
            tenant_id=tenant_id,
            provider=payload.provider,
            label=payload.label,
            secret=payload.secret,
            created_by=user.user_id,
        )


@router.delete("/{cred_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_credential(
    cred_id: str,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> Response:
    tenant_id = require_tenant(user)
    try:
        UUID(cred_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        ) from None
    with db.connection(database_url(request)) as conn:
        revoked = credentials.revoke_credential(conn, tenant_id, cred_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
