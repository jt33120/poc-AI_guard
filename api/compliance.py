"""Control-API routes for EU AI Act compliance (M9, BUILD_PLAN_V1.1 axis A).

* ``GET /v1/compliance/status`` — readiness snapshot (chain integrity, human
  oversight coverage, retention floor), tenant-scoped by RLS.
* ``GET /v1/compliance/export`` — the EU AI Act evidence pack (art. 12/14/26) as
  JSON or PDF. Metadata + human-supervision proofs only (CLAUDE.md §4.10).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from api.deps import database_url, require_tenant
from api.entitlement_guard import enforce_flux
from api.ratelimit import export_rate_limit, limiter
from api.security import get_current_user
from core import approvals, audit, compliance, db, export
from core.entitlements import Metric
from core.export import Narrator
from core.judge import build_judge
from core.schemas import ComplianceStatus, CurrentUser, Role

router = APIRouter(prefix="/v1/compliance", tags=["compliance"])


def _narrator(request: Request) -> Narrator | None:
    judge = build_judge(request.app.state.settings)
    if judge is None:
        return None

    def narrate(framework: str, counts: dict[str, int], total: int) -> str:
        try:
            return judge.narrate(framework, counts, total)
        except Exception:
            return export.default_narrative(framework, counts, total)

    return narrate


@router.get("/status", response_model=ComplianceStatus)
@limiter.limit(export_rate_limit)
def get_compliance_status(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    url = database_url(request)
    floor = request.app.state.settings.audit_retention_days
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        return compliance.status(conn, tenant_id, retention_floor_days=floor)


@router.get("/export", response_model=None)
@limiter.limit(export_rate_limit)
def export_evidence_pack(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    render: str = Query(default="json"),
) -> Response | dict[str, Any]:
    if render not in ("json", "pdf"):
        raise HTTPException(status_code=422, detail="render must be json or pdf")
    tenant_id = require_tenant(user)
    url = database_url(request)
    # Le dossier de conformité est l'acte le plus cher de la console : il lit dix
    # mille lignes, appelle le narrateur, et rend un PDF. `export_jobs` le plafonne
    # dans les trois paliers depuis `0030` — et rien ne le comptait.
    enforce_flux(url, tenant_id, Metric.export_jobs, etiquette="evidence exports")
    floor = request.app.state.settings.audit_retention_days
    with db.tenant_reader(
        url, user_id=user.user_id, tenant_id=tenant_id, role=(user.role or Role.viewer)
    ) as conn:
        events = audit.list_events(conn, limit=10_000)
        supervision = approvals.list_for_tenant(conn)
        pack = compliance.build_evidence_pack(
            conn,
            tenant_id=tenant_id,
            events=events,
            approvals=supervision,
            retention_floor_days=floor,
            narrator=_narrator(request),
            # `FR-169` : le pack doit pouvoir dire s'il existe un témoin signé, et où
            # la clé qui le signe est **déclarée** vivre. Sans les réglages, il retombe
            # sur l'aveu d'avant ce lot — « aucun témoin configuré » —, ce qui reste
            # honnête mais serait faux dès qu'une clé est posée.
            settings=request.app.state.settings,
        )
    if render == "pdf":
        pdf = export.render_pdf(pack)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="eu_ai_act_evidence.pdf"'},
        )
    return pack
