"""Le verrou de gamme, et pourquoi il ne vit pas dans `api/deps.py`.

`requires` doit résoudre un jeton console, donc importer :mod:`api.security` — qui
importe `httpx` pour aller chercher le jeu de clés de l'émetteur. Or `api/deps.py`
est importé par :mod:`api.llm_proxy`, qui est sur le **chemin de décision**, et
`AD-25` engage que ce chemin ne peut pas joindre le réseau.

Mis dans `deps.py`, le verrou créait donc l'arête
`api.llm_proxy → api.deps → api.security → httpx`, et `SM-15` passait de 0 à 1. La
revendication de souveraineté est une métrique publiée : elle se casse par un
import, pas par un appel, et c'est exactement ce que `scripts/audit_sovereignty.py`
existe pour voir. Séparer les deux modules est moins joli qu'un fichier de
dépendances unique, et c'est ce que la propriété coûte.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import db, entitlements
from core.entitlements import Capability, Metric
from core.schemas import CurrentUser

logger = logging.getLogger("xsom.api")


def requires(capability: Capability) -> Callable[..., None]:
    """Exiger une capacité du palier du tenant, ou refuser la route.

    **402 et non 403.** Un 403 dit « vous n'avez pas le droit », un 402 dit « pas à ce
    prix ». La console sait alors afficher l'écran d'offre plutôt que l'écran de
    permission, et le support ne confond pas un problème de rôle avec un problème
    d'abonnement — deux tickets qui se ressemblent et qui ne se traitent pas pareil.

    **Aucun cache.** Un droit servi de mémoire est un droit qu'on ne peut plus
    retirer : une rétrogradation pour impayé ne prendrait effet qu'au redémarrage du
    processus, et la fenêtre est exactement celle où le client a intérêt à continuer.
    Une base injoignable rend **503** — indisponible, jamais « autorisé par défaut ».

    Le contrôle est posé sur le **routeur**, pas sur la route (voir
    `_CAPACITE_PAR_ROUTEUR` dans `api/main.py`) : une route ajoutée demain dans un
    module déjà verrouillé l'est par construction, et non parce que quelqu'un s'en est
    souvenu.
    """

    def _garde(request: Request, user: CurrentUser = Depends(get_current_user)) -> None:
        tenant_id = require_tenant(user)
        url = database_url(request)
        try:
            with db.connection(url) as conn:
                droit = entitlements.load_entitlement(conn, tenant_id)
        except Exception:
            logger.warning("entitlement_unreadable", extra={"tenant_id": tenant_id})
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Entitlement store unavailable",
            ) from None
        if not droit.allows(capability):
            logger.info(
                "capability_refused",
                extra={"tenant_id": tenant_id, "capability": capability.value},
            )
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"'{capability.value}' is not included in your plan",
            )

    return _garde


def enforce_stock(
    conn: Any, tenant_id: str, metric: Metric, *, compte_sql: str, etiquette: str
) -> None:
    """Refuser une création de plus quand le stock du palier est atteint.

    **Le comptage se fait dans la même connexion que la création**, et un comptage
    qui échoue refuse : un objet qu'on ne peut pas compter est un objet qu'on ne crée
    pas. C'est la direction que `stock_allows` impose déjà en rendant `False` sur un
    plafond illisible, et cette fonction ne fait que ne pas la contourner.

    409 et non 402 : la fonctionnalité **est** dans le palier, c'est le nombre qui est
    atteint. Le message nomme le plafond, parce qu'un refus qui ne dit pas combien
    laisse l'utilisateur essayer une deuxième fois.

    Raises:
        HTTPException: 409 quand le plafond est atteint, 503 s'il est illisible.
    """
    try:
        droit = entitlements.load_entitlement(conn, tenant_id)
        row = conn.execute(compte_sql, (tenant_id,)).fetchone()
    except Exception:
        logger.warning("stock_unreadable", extra={"tenant_id": tenant_id, "metric": metric.value})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota store unavailable",
        ) from None
    actuel = int(row[0]) if row else 0
    if not entitlements.stock_allows(droit, metric, actuel=actuel):
        limite = droit.limite(metric)
        plafond = limite.valeur if limite else 0
        logger.info(
            "stock_exhausted",
            extra={"tenant_id": tenant_id, "metric": metric.value, "used": actuel},
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"plan limit reached: {plafond} {etiquette} (used {actuel})",
        )
