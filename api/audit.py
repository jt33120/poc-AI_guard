"""Control-API routes for the audit log and compliance exports (SPEC §8/§9, M5)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import approvals, audit, db, export
from core.schemas import AuditEntry, CurrentUser, Role

router = APIRouter(prefix="/v1/audit", tags=["audit"])


@router.get("", response_model=list[AuditEntry])
def list_audit(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
    decision: str | None = Query(default=None),
    tool: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return audit.list_events(conn, from_ts=from_ts, to_ts=to_ts, decision=decision, tool=tool)


@router.get("/export", response_model=None)
def export_audit(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    framework: str = Query(alias="format"),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
    render: str = Query(default="json"),
) -> Response | dict[str, Any]:
    if framework not in export.FRAMEWORKS:
        raise HTTPException(status_code=422, detail="format must be ai_act or rgpd")
    if render not in ("json", "pdf"):
        raise HTTPException(status_code=422, detail="render must be json or pdf")
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        events = audit.list_events(conn, from_ts=from_ts, to_ts=to_ts, limit=10_000)
        supervision = approvals.list_for_tenant(conn)

    report = export.build_report(
        framework=framework,
        events=events,
        approvals=supervision,
        range_from=from_ts,
        range_to=to_ts,
    )
    if render == "pdf":
        pdf = export.render_pdf(report)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="audit_{framework}.pdf"'},
        )
    return report
