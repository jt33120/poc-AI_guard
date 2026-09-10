"""Control-API routes for the audit log and compliance exports (SPEC §8/§9, M5)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from api.deps import database_url, require_tenant
from api.ratelimit import export_rate_limit, limiter
from api.security import get_current_user
from core import approvals, audit, db, export
from core.export import Narrator
from core.judge import Judge, build_judge
from core.schemas import AuditEntry, CurrentUser, Role

router = APIRouter(prefix="/v1/audit", tags=["audit"])


def _narrator(judge: Judge | None) -> Narrator | None:
    if judge is None:
        return None

    def narrate(framework: str, counts: dict[str, int], total: int) -> str:
        try:
            return judge.narrate(framework, counts, total)
        except Exception:
            return export.default_narrative(framework, counts, total)

    return narrate


@router.get("", response_model=list[AuditEntry])
def list_audit(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
    decision: str | None = Query(default=None),
    tool: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return audit.list_events(
            conn,
            from_ts=from_ts,
            to_ts=to_ts,
            decision=decision,
            tool=tool,
            agent=agent_id,
            client_id=client_id,
        )


@router.get("/export", response_model=None)
@limiter.limit(export_rate_limit)
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
        # Les mêmes bornes que la liste, comptées sans limite : cette route porte le
        # même défaut que `/v1/compliance/export` — dix mille lignes au plus, et un
        # `event_count` qui prétendait couvrir la période. Les deux exports le
        # déclarent désormais, avec les mêmes trois champs.
        totaux = (
            audit.count_events(conn, from_ts=from_ts, to_ts=to_ts),
            *audit.tally(conn, from_ts=from_ts, to_ts=to_ts),
        )

    report = export.build_report(
        framework=framework,
        events=events,
        approvals=supervision,
        range_from=from_ts,
        range_to=to_ts,
        narrator=_narrator(build_judge(request.app.state.settings)),
        totals=totaux,
    )
    if render == "pdf":
        pdf = export.render_pdf(report)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="audit_{framework}.pdf"'},
        )
    return report
