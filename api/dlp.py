"""Control-API routes for per-tenant egress DLP configuration.

Read available to any tenant member; writes are admin-only. The platform master
switch (``settings.dlp_enabled``) is surfaced read-only so the console can explain
when a saved config is dormant (DLP disabled platform-wide).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, dlp_config
from core.config import Settings
from core.schemas import CurrentUser, DlpConfigOut, DlpConfigUpdate, Role

router = APIRouter(prefix="/v1/dlp", tags=["dlp"])

_require_admin = require_role(Role.admin)


@router.get("", response_model=DlpConfigOut)
def get_dlp(request: Request, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    settings: Settings = request.app.state.settings
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        state = dlp_config.load(conn, tenant_id, settings)
    return {**state.as_dict(), "platform_enabled": settings.dlp_enabled}


@router.put("", response_model=DlpConfigOut)
def put_dlp(
    payload: DlpConfigUpdate,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    settings: Settings = request.app.state.settings
    url = database_url(request)
    with db.connection(url) as conn:
        dlp_config.save(
            conn,
            tenant_id,
            enabled=payload.enabled,
            secret_action=payload.secret_action,
            pii_action=payload.pii_action,
            entropy_action=payload.entropy_action,
            updated_by=user.user_id,
        )
        conn.commit()
    return {
        "enabled": payload.enabled,
        "secret_action": payload.secret_action,
        "pii_action": payload.pii_action,
        "entropy_action": payload.entropy_action,
        "platform_enabled": settings.dlp_enabled,
    }
