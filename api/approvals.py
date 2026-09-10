"""Control-API routes for the HITL approval queue (SPEC §8, M4)."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import approval_chain, approvals, db
from core.schemas import ApprovalOut, CurrentUser, DecisionRequest, Role

logger = logging.getLogger("xsom.api")

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
        decide = approvals.decide(conn, tenant_id, approval_id, payload.decision, user.user_id)
        # **La décision entre dans une chaîne ici, pas quand l'agent vient la
        # chercher.** Avant, cette route n'écrivait rien du tout : la ligne
        # `hitl_approved` du journal d'audit n'apparaissait qu'au *poll* suivant, si
        # bien qu'un agent qui abandonne emportait avec lui la seule trace d'une
        # approbation humaine sur une action irréversible.
        #
        # Dans la même connexion, et **sans `try`** : une décision qu'on n'a pas pu
        # inscrire ne doit pas être rendue à l'opérateur comme prise. C'est l'inverse
        # du best-effort qui vaut pour les lignes d'observation — ici la ligne *est*
        # la preuve (§4.2).
        etat = decide if decide is not None else record
        approval_chain.record_decision(
            conn,
            tenant_id=tenant_id,
            approval_id=approval_id,
            event=(
                approval_chain.DENIED if payload.decision == "deny" else approval_chain.APPROVED
            ),
            tool_name=etat.tool_name,
            action_class=etat.action_class,
            subject=user.user_id,
            approved_count=len(etat.approved_by),
            required_count=etat.required_count,
        )
        # Explicite, comme `api/security.py` le fait pour la chaîne du plan de
        # contrôle : `conn.transaction()` referme son bloc, il ne valide pas la
        # connexion. Sans cette ligne l'insertion partait au `close()`, et la preuve
        # que cette route existe pour écrire n'existait pas.
        conn.commit()
        view = approvals.get_view(conn, tenant_id, approval_id)
    # Métadonnées seules : l'identifiant d'approbation, le sens de la décision et
    # l'approbateur. Jamais les arguments de l'action, qui vivent hachés côté audit.
    logger.info(
        "hitl_decided",
        extra={
            "approval_id": approval_id,
            "decision": payload.decision,
            "user_id": user.user_id,
            "tenant_id": tenant_id,
        },
    )
    if view is None:  # pragma: no cover - just decided, must exist
        raise HTTPException(status_code=404, detail="Approval not found")
    return view
