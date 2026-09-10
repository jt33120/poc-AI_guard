"""`GET /v1/ops/metrics` — ce que ce processus a fait, en texte Prometheus.

**Ce que ce point de scrutation répond, et à qui.** Un exploitant n'avait aucun moyen
de voir le volume de verdicts, le coût de la garde, ni — le plus grave — le **taux de
perte de preuve**. Une écriture d'audit ratée ne laissait qu'un `logger.warning` ;
un juge qui expire sortait du journal comme `judge_used=False`, indistinguable de
« aucun juge n'a été sollicité ». Le reste était vert : `/health/ready` répondait ses
quatre booléens, la chaîne se vérifiait, et rien n'obligeait personne à constater le
trou.

**Pourquoi le format Prometheus et pas un JSON à nous.** Le non-objectif 11 du produit
est explicite : nous émettons vers la pile du client, nous ne concurrençons pas sa
plateforme d'observabilité. Un JSON de forme maison *est* une petite surface
d'observabilité propriétaire, que le client doit traduire. `FR-148` a déjà tranché le
cas jumeau — l'export de trace vise « n'importe quel point de terminaison standard »,
pas un format à nous. Et le texte d'exposition se rend à la main en trente lignes,
donc **sans dépendance nouvelle** : `prometheus_client` violerait `CLAUDE.md` §3, et —
argument vérifiable — passerait la garde de souveraineté **en silence**, puisque
`scripts/audit_sovereignty.py` ne parcourt pas les paquets tiers alors que
`prometheus_client.exposition` importe `urllib.request` et `http.server`.

**Pourquoi un jeton, et pourquoi 404 sans lui.** Le relevé dit le volume de trafic, la
part de refus et la latence : de quoi choisir sa cible et le moment. `api/health.py`
tient déjà cette ligne pour la sonde — quatre booléens et rien d'autre, parce qu'un
inventaire de capacités dit à un anonyme quel déploiement vaut la peine (`INV-11`). Un
déploiement qui n'a pas configuré de jeton répond **404** et non 403 : annoncer
« il y a bien un point de métriques ici, mais il vous faut un jeton » est déjà une
information de plus que zéro, et un scrutateur légitime, lui, a le jeton.

**Ce que ce relevé ne couvre PAS, et il faut le lire avant d'en tirer des conclusions.**
Les compteurs vivent dans le processus qui répond. Trois conséquences :

* chaque réplique a les siens (c'est ce que Prometheus attend, il agrège) ;
* ils repartent de zéro au redémarrage ;
* **la passerelle MCP n'est pas scrutée par cette route.** Elle tourne en stdio à
  côté de l'agent (`Dockerfile`, `gateway/server.py::run_stdio`) : ce processus n'a
  aucun port HTTP. Ses compteurs existent — la même instrumentation les alimente — et
  ils sont lisibles le jour où la passerelle gagne un transport. En attendant, la
  source de vérité du volume de la porte obligatoire reste `audit_log`, qui est
  interrogeable et qui est la preuve. Un compteur n'a jamais été la preuve (§4.2).
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import PlainTextResponse

from core.metrics import registre

router = APIRouter(prefix="/v1/ops", tags=["ops"])

#: Le type de contenu du format d'exposition. Figé par Prometheus, pas par nous.
CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def require_ops_reader(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    """Le scrutateur présente-t-il le jeton ? Sinon 404, jamais 403 — voir l'en-tête.

    **Une dépendance FastAPI et non un appel dans le corps.** `tests/test_public_surface.py`
    gèle la surface non authentifiée en descendant le **graphe de dépendances** de
    chaque route : une authentification faite dans le corps est invisible pour lui, la
    route est classée publique, et on l'inscrit alors dans l'allowlist — ce qui grave
    l'erreur au lieu de la corriger. Le fichier le dit lui-même en toutes lettres.
    """
    attendu = request.app.state.settings.ops_metrics_token
    if not attendu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    schema, _, presente = (authorization or "").partition(" ")
    # `compare_digest` et non `==` : la comparaison naïve s'arrête au premier octet
    # différent, ce qui rend le jeton devinable octet par octet sur un lien assez
    # stable. Le coût est nul et l'habitude est la bonne.
    if schema.lower() != "bearer" or not secrets.compare_digest(presente.strip(), attendu):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@router.get("/metrics", response_class=PlainTextResponse)
def metrics(_: None = Depends(require_ops_reader)) -> PlainTextResponse:
    """Le relevé du processus. Synchrone : c'est du calcul pur, sans entrée-sortie.

    **Aucune lecture de base**, et c'est délibéré : on scrute pendant l'incident,
    c'est-à-dire précisément au moment où Postgres est peut-être absent. Un point de
    métriques qui tombe avec la base ne dit rien quand on en a besoin.
    """
    return PlainTextResponse(content=registre.rendre(), media_type=CONTENT_TYPE)
