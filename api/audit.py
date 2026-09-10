"""Control-API routes for the audit log and compliance exports (SPEC §8/§9, M5)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from api.deps import database_url, require_tenant
from api.entitlement_guard import enforce_capability
from api.ratelimit import export_rate_limit, limiter
from api.security import get_current_user
from core import approvals, audit, db, entitlements, export
from core.entitlements import Capability
from core.export import Narrator
from core.judge import Judge, build_judge
from core.schemas import AuditEntry, CurrentUser, Role

logger = logging.getLogger("xsom.api")

router = APIRouter(prefix="/v1/audit", tags=["audit"])


def _droit_au_recit(url: str, tenant_id: str) -> bool:
    """Le palier accorde-t-il les synthèses rédigées par modèle ?

    Un droit illisible rend `False` : l'export part sans récit plutôt que de
    refuser. C'est la direction juste **ici** et seulement ici — le récit est du
    confort, la preuve est dans les chiffres qui l'accompagnent, et refuser un
    export de conformité parce qu'un compteur de facturation ne répond pas serait
    disproportionné. Là où c'est une garde qui est en jeu, la panne resserre.
    """
    try:
        with db.connection(url) as conn:
            return entitlements.load_entitlement(conn, tenant_id).allows(Capability.ai_summary)
    except Exception:
        logger.warning("entitlement_unreadable", extra={"tenant_id": tenant_id})
        return False


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
    # **Deux capacités sur une seule route, et elles ne disent pas la même chose.**
    #
    # `audit_export_raw` verrouille l'export lui-même. Le routeur d'audit est du
    # socle — §4.2, le journal prouve et ne se facture pas — donc le verrou est posé
    # ici, sur cette route et pas sur les autres : consulter son journal reste
    # gratuit, en extraire un dossier formaté est un produit. Les trois paliers
    # l'incluent aujourd'hui, ce qui rend le contrôle sans effet visible — et c'est
    # bien ce qu'on veut : le jour où un palier ne l'aura plus, rien à retrouver.
    #
    # `ai_summary` — « Synthèses rédigées par modèle » — verrouille le **narrateur**,
    # qui appelle un modèle par export. Il tournait pour tous les paliers depuis
    # cette route, alors que son jumeau de `/v1/compliance/export` est derrière
    # `compliance_pack`. Sans la capacité, l'export sort avec ses chiffres et sans
    # le récit : c'est un retrait de confort, jamais de preuve.
    enforce_capability(url, tenant_id, Capability.audit_export_raw)
    recit = _droit_au_recit(url, tenant_id)
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
        narrator=_narrator(build_judge(request.app.state.settings)) if recit else None,
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
