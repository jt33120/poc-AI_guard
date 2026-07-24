"""Control-API routes for MCP tool supply-chain integrity (M10, axis B).

* ``GET /v1/tools/integrity`` — the tenant's tool fingerprints + derived status
  (ok / new / drift), RLS-scoped; any member may read.
* ``POST /v1/tools/{server}/{tool_name}/approve`` — re-baseline a tool to its
  last-seen version after review (admin only), clearing a quarantine/drift.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, integrity
from core.schemas import CurrentUser, Role, ToolIntegrityRow

router = APIRouter(prefix="/v1/tools", tags=["integrity"])

_require_admin = require_role(Role.admin)


@router.get("/integrity", response_model=list[ToolIntegrityRow])
def list_tool_integrity(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return integrity.list_status(conn, tenant_id)


@router.post("/{server}/{tool_name}/approve", response_model=None)
def approve_tool(
    server: str,
    tool_name: str,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.connection(url) as conn:
        ok = integrity.approve(conn, tenant_id=tenant_id, server=server, tool_name=tool_name)
        conn.commit()
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found")
    return {"server": server, "tool_name": tool_name, "approved": True}
