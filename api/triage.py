"""Diagnostic public de profil (`QO-7`, pilier 1).

Un prospect coche ses profils d'usage et obtient sa carte : *combien de lignes de
menace vous concernent, combien sont sur notre terrain, combien nous bloquons*. Le
moteur est `core/triage.py`, inchangé depuis le rang 3 ; cette route en est la surface.

**L'adresse est demandée avant le résultat** — c'est un arbitrage commercial assumé, et
il fait de cette route la seule du produit qui collecte de la donnée personnelle sans
tenant. La finalité est donc renvoyée *avec* le résultat, pas reléguée à une page
séparée : une finalité qu'il faut aller chercher n'a pas été portée à la connaissance
de la personne.

La carte lue est `coverage/map.json` — l'artefact **généré**, jamais rédigé. Le
diagnostic ne peut donc pas annoncer plus que ce que les scénarios prouvent, et une
carte périmée fait échouer la CI (`gen_coverage.py --check`).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from api.deps import database_url
from api.ratelimit import limiter, triage_rate_limit
from core import db, leads, triage
from core.profiles import Profile
from core.schemas import TriageRequest

router = APIRouter(prefix="/v1/triage", tags=["triage"])

_MAP = Path(__file__).resolve().parent.parent / "coverage" / "map.json"


@router.post("", status_code=status.HTTP_200_OK)
@limiter.limit(triage_rate_limit)
def diagnose(request: Request, payload: TriageRequest) -> dict[str, Any]:
    """Rendre le diagnostic, après avoir enregistré la capture."""
    held = frozenset(Profile(p) for p in payload.profiles)
    try:
        report = triage.diagnose(_MAP, held)
    except triage.MapUnavailable:
        # Fail-closed : sans carte publiée, rien n'est prouvé, donc rien ne peut être
        # annoncé. Mieux vaut ne pas répondre que répondre une couverture inventée.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Diagnostic momentanément indisponible",
        ) from None

    try:
        with db.connection(database_url(request)) as conn:
            leads.capture(conn, email=payload.email, profiles=sorted(payload.profiles))
            conn.commit()
    except leads.LeadError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None

    return {
        "profiles": sorted(payload.profiles),
        "lines": len(report.lines),
        "applicable": len(report.applicable),
        "ours": len(report.ours),
        "blocked": len(report.blocked),
        "statement": report.statement(),
        # La finalité voyage avec la réponse : elle ne peut pas être perdue en
        # intégrant l'écran ailleurs, ni oubliée par une refonte du site.
        "privacy": leads.PURPOSE,
    }
