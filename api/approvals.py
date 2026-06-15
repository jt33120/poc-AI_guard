"""Control-API routes for the HITL approval queue (SPEC §8, M4)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import approvals, db
from core.schemas import ApprovalOut, CurrentUser, DecisionRequest, Role

router = APIRouter(prefix="/v1/approvals", tags=["approvals"])

# Operators and admins may decide; viewers may only watch.
_require_operator = require_role(Role.admin, Role.operator)

_STATUSES = {"pending", "approved", "denied", "expired"}


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[dict[str, Any]]:
    if status_filter is not None and status_filter not in _STATUSES:
        raise HTTPException(status_code=422, detail="invalid status filter")
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return approvals.list_for_tenant(conn, status_filter)


@router.post("/{approval_id}/decision", response_model=ApprovalOut)
def decide_approval(
    approval_id: str,
    payload: DecisionRequest,
    request: Request,
    user: CurrentUser = Depends(_require_operator),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    try:
        UUID(approval_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Approval not found") from None

    url = database_url(request)
    with db.connection(url) as conn:
        record = approvals.get(conn, tenant_id, approval_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Approval not found")
        record = approvals.expire_if_needed(conn, record)
        conn.commit()
        if record.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Approval already {record.status}",
            )
        approvals.decide(conn, tenant_id, approval_id, payload.decision, user.user_id)
        view = approvals.get_view(conn, tenant_id, approval_id)
    if view is None:  # pragma: no cover - just decided, must exist
        raise HTTPException(status_code=404, detail="Approval not found")
    return view
