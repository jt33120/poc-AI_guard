"""Le relevé public des menaces, par **ligne** et pour un profil donné (`L3`).

Distinct de `/v1/triage`, et il faut dire pourquoi : le diagnostic demande une adresse
et capture un lead, ce qui est un arbitrage commercial assumé. Le relevé, lui, alimente
une section d'une page publique où l'on coche un profil pour voir ce qui change. Le
faire passer par `/v1/triage` obligerait à donner son adresse pour lire une liste de
menaces, ce qui n'est ni nécessaire ni défendable.

D'où : `GET`, aucune écriture, aucune donnée personnelle, aucune base.

**Pourquoi une route et pas un simple artefact statique.** Le regroupement en lignes
est publié tel quel dans `frontend/lib/generated/threat-rows.json` : il ne dépend
d'aucun visiteur. Mais l'applicabilité, le plafond de profil (`FR-174`) et la famille
retenue en dépendent, et ce sont eux qui portent les chiffres. Les recalculer en
TypeScript donnerait un second moteur ; le premier désaccord entre les deux se lirait
sur une page commerciale. Le moteur reste `core.triage`, ici comme ailleurs.

Fail-closed : sans carte publiée, on répond 503 plutôt qu'une liste vide. Une liste
vide se lit « aucune menace », qui est la plus mauvaise des réponses fausses.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from api.ratelimit import limiter, threats_rate_limit
from core import triage

router = APIRouter(prefix="/v1/threats", tags=["threats"])

_MAP = Path(__file__).resolve().parent.parent / "coverage" / "map.json"

#: Borne de longueur sur le paramètre, avant même de le découper (`CLAUDE.md` §4.9).
#: Six profils de trois à quatre caractères plus leurs virgules tiennent en 30.
_MAX_PROFILES_LEN = 40


@router.get("", status_code=status.HTTP_200_OK)
@limiter.limit(threats_rate_limit)
def read_threats(
    request: Request,
    profiles: str = Query(
        default="",
        max_length=_MAX_PROFILES_LEN,
        description="Profils tenus, séparés par des virgules, ex. `P1a,P3`.",
    ),
) -> dict[str, Any]:
    """Rendre les 16 lignes, positionnées pour les profils demandés."""
    try:
        held = triage.parse_profiles(profiles) if profiles.strip() else frozenset()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None

    try:
        report = triage.diagnose(_MAP, held)
    except triage.MapUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Relevé momentanément indisponible",
        ) from None

    return {
        "profiles": sorted(p.value for p in held),
        "cap": report.cap,
        # Les comptes viennent du moteur, pas d'un `filter` côté page. « Sur notre
        # terrain » en particulier : `Diagnostic.ours` est défini une fois pour que
        # deux lecteurs n'en donnent pas deux chiffres.
        "counts": {
            "lines": len(report.lines),
            "applicable": len(report.applicable),
            "ours": len(report.ours),
            "blocked": len(report.blocked),
        },
        # Vide tant qu'aucun profil n'est coché : l'énoncé de `THREAT-COVERAGE` §2.5
        # parle d'« un client », et sans profil il n'y a pas de client à qui parler.
        "statement": report.statement() if held else None,
        "rows": [
            {
                "id": line.id,
                "titre": line.titre,
                "applicable": line.applicable,
                "blocked": line.blocked,
                "owner": line.owner,
                "facets": [{"libelle": libelle, "mode": mode} for libelle, mode in line.facets],
                "activates_at": [p.value for p in line.activates_at],
            }
            for line in report.lines
        ],
    }
