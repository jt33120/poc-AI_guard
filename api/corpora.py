"""Routes de déclaration de provenance des corpus (`FR-184`, `M-03`, `G-04`).

Déclarer engage le tenant : la déclaration part dans l'Evidence Pack remis à un
auditeur. C'est donc une action d'`admin`, pas d'opérateur — comme l'ouverture d'une
fenêtre d'observation, la séparation vit dans l'exigence de rôle de la route et non
dans un commentaire.

La lecture passe par une connexion scopée RLS : la console voit les corpus de son
tenant parce que Postgres le lui permet, pas parce que la requête a pensé à filtrer.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import corpora, db
from core.schemas import CorpusOut, CorpusRequest, CurrentUser, Role

router = APIRouter(prefix="/v1/corpora", tags=["corpora"])

_require_admin = require_role(Role.admin)


def _out(corpus: corpora.Corpus) -> dict[str, Any]:
    return {
        "id": corpus.id,
        "name": corpus.name,
        "kind": corpus.kind,
        "source": corpus.source,
        "steward": corpus.steward,
        "declared_at": corpus.declared_at,
        "declared_by": corpus.declared_by,
        "last_reviewed_at": corpus.last_reviewed_at,
        # Dérivés plutôt que stockés : une péremption calculée au stockage serait
        # fausse le lendemain.
        "review_age_days": corpus.review_age_days,
        "stale": corpus.stale,
    }


@router.get("", response_model=list[CorpusOut])
def list_corpora(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    """Les corpus déclarés par ce tenant, avec l'âge de leur dernière revue."""
    require_tenant(user)
    with db.tenant_reader(
        database_url(request),
        user_id=user.user_id,
        tenant_id=user.tenant_id,
        role=(user.role or Role.viewer),
    ) as conn:
        return [_out(c) for c in corpora.list_corpora(conn)]


@router.put("", response_model=CorpusOut, status_code=status.HTTP_200_OK)
def declare_corpus(
    request: Request,
    payload: CorpusRequest,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    """Déclarer un corpus, ou remplacer la déclaration portant le même nom.

    `PUT` et non `POST` : la ressource est « la provenance de ce corpus-là », et elle
    a une valeur, pas un historique. L'historique appartient au journal d'audit.
    """
    tenant_id = require_tenant(user)
    try:
        with db.connection(database_url(request)) as conn:
            corpus = corpora.declare(
                conn,
                tenant_id=tenant_id,
                name=payload.name,
                kind=payload.kind,
                source=payload.source,
                steward=payload.steward,
                last_reviewed_at=payload.last_reviewed_at,
                declared_by=user.user_id,
            )
            conn.commit()
    except corpora.CorpusError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return _out(corpus)
