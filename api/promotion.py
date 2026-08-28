"""Control-API route for the promotion report (FR-180).

`GET /v1/promotion` — what enforcement *would* have done during the observation
windows. Operator and admin only: it is a decision-support artefact about turning
enforcement on, not a public metric.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.deps import database_url, require_tenant
from api.security import require_role
from core import db, promotion
from core.monitor import NEVER_OBSERVED
from core.schemas import CurrentUser, PromotionReportOut, Role

router = APIRouter(prefix="/v1/promotion", tags=["monitor"])

_require_operator = require_role(Role.operator)


@router.get("", response_model=PromotionReportOut)
def get_promotion_report(
    request: Request,
    agent: str | None = Query(default=None, description="gateway token id, or all agents"),
    user: CurrentUser = Depends(_require_operator),
) -> dict[str, Any]:
    tenant_id = require_tenant(user)
    if agent is not None:
        try:
            UUID(agent)
        except ValueError:
            raise HTTPException(status_code=422, detail="agent must be a uuid") from None
    with db.connection(database_url(request)) as conn:
        report = promotion.build_report(conn, tenant_id=tenant_id, agent=agent)
    return {
        "observations": report.observations,
        "held": report.held,
        "refused": report.refused,
        "tools": [
            {
                "tool": line.tool,
                "held": line.held,
                "refused": line.refused,
                "dominant_class": line.dominant_class,
            }
            for line in report.tools
        ],
        "windows": report.windows,
        "period_from": report.period_from,
        "period_to": report.period_to,
        "window_still_open": report.window_still_open,
        "has_data": report.has_data,
        "statement": report.statement(),
        # The caveat ships with the numbers rather than beside them: a count read
        # without it overstates what turning enforcement on will change.
        "never_observed": sorted(c.value for c in NEVER_OBSERVED),
    }
