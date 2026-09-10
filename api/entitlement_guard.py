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
from core.entitlements import Capability, Meter, Metric
from core.policy import Policy
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
        enforce_capability(database_url(request), require_tenant(user), capability)

    return _garde


def enforce_capability(url: str, tenant_id: str, capability: Capability) -> None:
    """Le verrou lui-même, hors de toute dépendance FastAPI.

    :func:`requires` le monte sur un routeur ; certaines routes doivent l'appeler
    en ligne — parce qu'elles vivent dans un routeur qui, lui, ne se vend pas
    (`POST /v1/policy/draft` est dans le routeur de policy, qui est du socle), ou
    parce que l'identité du tenant n'est résolue qu'au milieu du traitement.
    """
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


def enforce_flux(url: str, tenant_id: str, metric: Metric, *, etiquette: str) -> None:
    """Refuser un acte payant à l'unité quand l'allocation de la période est épuisée.

    Jumeau d':func:`enforce_stock` pour les métriques de **flux**, et il rend le même
    409 : dans les deux cas la fonctionnalité *est* dans le palier, c'est le nombre
    qui est atteint. Un 402 dirait « pas à ce prix » et enverrait la console sur
    l'écran d'offre alors que le client a déjà payé ; un 429 se confondrait avec le
    limiteur de débit, qui vit à côté et veut dire tout autre chose — « réessayez
    dans un instant » plutôt que « votre mois est consommé ».

    Le débit vit dans :func:`core.entitlements.flux_allows`, qui lit avant de
    débiter : un appel refusé ne se facture pas.

    Raises:
        HTTPException: 409 quand l'allocation est épuisée, 503 si elle est illisible.
    """
    try:
        with db.connection(url) as conn:
            etat = entitlements.flux_allows(conn, tenant_id, metric)
    except Exception:
        logger.warning("flux_unreadable", extra={"tenant_id": tenant_id, "metric": metric.value})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota store unavailable",
        ) from None
    if etat is Meter.unknown:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Quota store unavailable",
        )
    if etat is Meter.capped:
        logger.info("flux_exhausted", extra={"tenant_id": tenant_id, "metric": metric.value})
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"plan limit reached: {etiquette} for this period",
        )


def enforce_policy_capabilities(url: str, tenant_id: str, policy: Policy) -> None:
    """Refuser d'**enregistrer** une policy qui allume ce que le palier ne vend pas.

    Le seul site : `PUT /v1/policy`. C'est aussi le seul endroit où ces quatre
    fonctionnalités entrent dans le produit, puisqu'elles vivent dans le YAML du
    tenant et nulle part ailleurs.

    402 et non 403 : la console doit afficher l'écran d'offre, pas celui des
    permissions — l'admin a bien le droit d'éditer la policy, c'est la fonctionnalité
    qui n'est pas dans son palier. Le message les **nomme**, sinon l'utilisateur
    retire des lignes au hasard jusqu'à ce que ça passe.

    Raises:
        HTTPException: 402 si une capacité manque, 503 si le palier est illisible.
    """
    requises = entitlements.capacites_requises(policy)
    if not requises:
        return
    try:
        with db.connection(url) as conn:
            droit = entitlements.load_entitlement(conn, tenant_id)
    except Exception:
        logger.warning("entitlement_unreadable", extra={"tenant_id": tenant_id})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Entitlement store unavailable",
        ) from None
    manquantes = sorted(c.value for c in requises if not droit.allows(c))
    if manquantes:
        logger.info(
            "policy_capability_refused",
            extra={"tenant_id": tenant_id, "capabilities": manquantes},
        )
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                "this policy turns on features your plan does not include: " + ", ".join(manquantes)
            ),
        )
