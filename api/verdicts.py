"""Route d'ingestion des verdicts d'analyseurs tiers (`FR-191`, `M-15`, `G-14`).

La CI du client remet le reçu de son analyseur ; nous le datons, en chaînons
l'empreinte, et n'en jugeons rien. C'est ce que le mode `Orchestré` autorise à dire —
« nous intégrons et prouvons le contrôle » — et la frontière est ici, dans le fait
qu'aucune ligne de ce module ne lit le contenu d'un `finding` pour en tirer une
conclusion.

**Pourquoi `admin` et pas `operator`.** Un reçu part dans l'Evidence Pack remis à un
auditeur : le déclarer engage le tenant, exactement comme déclarer la provenance d'un
corpus. La séparation vit dans l'exigence de rôle de la route, pas dans un commentaire.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.ratelimit import limiter
from api.security import require_role
from core import db, verdicts
from core.schemas import CurrentUser, Role, VerdictOut, VerdictRequest

router = APIRouter(prefix="/v1/verdicts", tags=["verdicts"])

_require_admin = require_role(Role.admin)

#: La CI d'un client pousse un reçu par exécution, pas mille. La borne protège une
#: table append-only d'un remplissage qu'aucun `delete` ne pourrait rattraper.
_RATE = "30/minute"


@router.post("", response_model=VerdictOut, status_code=status.HTTP_201_CREATED)
@limiter.limit(_RATE)
def ingest_verdict(
    request: Request,
    payload: VerdictRequest,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    """Recevoir un reçu d'analyseur, le chaîner, et rendre son empreinte.

    Le rejeu du même reçu est refusé plutôt que silencieusement ignoré : sur une table
    append-only, « déjà reçu » et « reçu deux fois » ne sont pas la même chose pour
    qui relit la chaîne, et un `do nothing` aurait rendu un `entry_hash` sans ligne.
    """
    tenant_id = require_tenant(user)
    receipt = verdicts.Receipt(
        analyzer=payload.analyzer,
        analyzer_version=payload.analyzer_version,
        ruleset=payload.ruleset,
        repository=payload.repository,
        commit_sha=payload.commit_sha,
        verdict=payload.verdict,
        findings=payload.findings,
        ran_at=payload.ran_at,
    )
    with db.connection(database_url(request)) as conn:
        try:
            entry_hash = verdicts.ingest(conn, tenant_id=tenant_id, receipt=receipt)
        except verdicts.DuplicateReceipt:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="ce reçu a déjà été ingéré (même analyseur, dépôt, commit et date)",
            ) from None
        conn.commit()
    return {"entry_hash": entry_hash, "receipt_digest": verdicts.receipt_digest(receipt)}
