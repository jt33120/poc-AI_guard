"""Route de dépôt de l'inventaire du Shadow AI (`FR-189`, `M-10/decouverte`).

**La route ne reçoit aucun journal.** Son schéma n'a pas de champ pour en porter un :
le parsing et la classification tournent chez le client (`python -m cli shadow-ai`), et
seul l'inventaire dérivé — des comptes d'acteurs par service — arrive ici. C'est ce qui
sépare une attestation d'un CASB, et c'est pour cela que la frontière vit dans le
schéma plutôt que dans une consigne.

Déposer engage le tenant devant un auditeur : action d'`admin`, comme déclarer la
provenance d'un corpus.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, shadow_ai
from core.schemas import CurrentUser, Role, ShadowAiOut, ShadowAiRequest

router = APIRouter(prefix="/v1/shadow-ai", tags=["shadow-ai"])

_require_admin = require_role(Role.admin)


@router.get("", response_model=ShadowAiOut)
def read_inventory(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> dict[str, Any]:
    """L'inventaire courant de ce tenant, lu par une connexion scopée RLS."""
    require_tenant(user)
    with db.tenant_reader(
        database_url(request),
        user_id=user.user_id,
        tenant_id=user.tenant_id,
        role=(user.role or Role.viewer),
    ) as conn:
        courant = shadow_ai.current(conn)
    if courant is None:
        return {"declared": False}
    inventory, window = courant
    return {"declared": True, "window": window, "shadow_actors": inventory.shadow_actors}


@router.put("", response_model=ShadowAiOut)
def declare_inventory(
    request: Request,
    payload: ShadowAiRequest,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    """Déposer l'inventaire dérivé, en remplaçant le précédent."""
    tenant_id = require_tenant(user)
    inventory = shadow_ai.Inventory(
        supervised=payload.supervised,
        shadow=payload.shadow,
        unclassified=payload.unclassified,
        rejected=payload.rejected,
    )
    with db.connection(database_url(request)) as conn:
        shadow_ai.declare(
            conn,
            tenant_id=tenant_id,
            window_start=payload.window_start,
            window_end=payload.window_end,
            inventory=inventory,
            declared_by=user.user_id,
        )
        conn.commit()
    window = f"{payload.window_start.date().isoformat()} → {payload.window_end.date().isoformat()}"
    return {"declared": True, "window": window, "shadow_actors": inventory.shadow_actors}
