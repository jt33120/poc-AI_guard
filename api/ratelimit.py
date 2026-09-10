"""Rate limiting for costly endpoints (slowapi) — CLAUDE.md §3/§4.9, M6.

**Le compartiment n'est pas l'adresse IP quand on peut faire mieux.**

`get_remote_address` lit `request.client.host`. Derrière un edge — et
`docs/DEPLOY.md` en propose quatre —, uvicorn ne réécrit cette adresse depuis
`X-Forwarded-For` que si le pair immédiat figure dans `forwarded_allow_ips`, dont le
défaut est `127.0.0.1`. L'edge n'est jamais à cette adresse. Tous les appelants
partagent donc **un seul compartiment**, et n'importe lequel met les autres en 429
avec une boucle triviale.

L'inverse est pire : élargir cette liste à `*` ferait confiance au `X-Forwarded-For`
de n'importe qui, et il suffirait d'en changer à chaque requête pour n'être jamais
limité. Une limite contournable en une ligne d'en-tête est plus dangereuse qu'aucune
limite, parce qu'on croit l'avoir.

D'où le choix : **quand l'appelant présente une identité, on compte sur elle**. Les
routes coûteuses au sens du §4.9 — juge LLM, exports, assistant de policy — exigent
toutes un jeton porteur. Ce compartiment-là ne dépend d'aucune configuration de
déploiement et ne se falsifie pas par un en-tête.

L'adresse IP reste le seul recours pour les routes publiques (inscription, triage,
relevé). Pour celles-là, et pour elles seules, il faut que `FORWARDED_ALLOW_IPS`
nomme l'edge — `docs/DEPLOY.md` le dit, et `xsom doctor` le vérifie.

**Et deux des routes « authentifiées » n'y étaient pas.** `POST /v1/authorize`
s'authentifie par `X-Gateway-Token` et ne présente aucun `Authorization` : son
compartiment retombait donc sur l'adresse, c'est-à-dire sur **un seul compartiment
partagé** derrière un edge — exactement le défaut que l'en-tête ci-dessus dit éviter,
sur la route la plus chaude du produit. Le proxy, lui, hachait la clé **fournisseur**
de l'agent, ce qui compartimente par clé et non par tenant. Les deux lisent désormais
le tenant résolu par la dépendance, qui s'exécute avant le limiteur.

**Deux limites, et elles ne disent pas la même chose.** La chaîne de configuration est
un **plafond d'infrastructure** : ce que ce processus accepte d'un seul compartiment,
quel que soit le palier acheté. Le chiffre du palier (`plan_limits.authorize_rpm`,
`plan_limits.proxy_rpm`) est une **limite commerciale** : ce que le client a payé. Les
deux s'appliquent, et slowapi sait les composer dans une seule chaîne. Le palier ne
peut donc pas dépasser l'infrastructure, et l'infrastructure ne peut pas brider
en silence ce qui a été vendu — à condition que son défaut reste au-dessus du plus
haut palier publié, ce que `xsom doctor` vérifie.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from core.config import get_settings
from core.entitlements import Metric
from core.metrics import registre

#: Longueur du condensé retenue comme clé. Un compartiment n'a pas besoin d'un
#: condensé complet, et on ne garde jamais le jeton lui-même (§4.10).
_LONGUEUR_CLE = 32


#: L'attribut que la dépendance d'authentification pose sur la requête.
#:
#: Nommé plutôt qu'écrit en dur sur deux sites : `api/gateway_auth.py` le pose et ce
#: module le lit, et deux littéraux qui doivent être d'accord finissent par ne plus
#: l'être — en silence, puisque l'absence retombe simplement sur l'ancien
#: comportement.
ETAT_TENANT = "xsom_tenant_id"


def client_key(request: Request) -> str:
    """Le compartiment de limitation : l'identité présentée, sinon l'adresse.

    On condense le jeton plutôt que de le retenir : la clé vit en mémoire dans le
    limiteur, et un secret d'authentification n'a rien à y faire (§4.10).

    **Le tenant d'abord.** C'est la seule identité que l'appelant ne choisit pas : elle
    vient d'une résolution en base du jeton de passerelle, faite par la dépendance qui
    s'exécute avant le limiteur. Les branches suivantes sont inchangées, et les tests
    qui figent leur forme (`tests/test_ratelimit_key.py`) passent tels quels.
    """
    tenant = getattr(request.state, ETAT_TENANT, None)
    if isinstance(tenant, str) and tenant:
        return f"tenant:{tenant}"
    entete = request.headers.get("authorization") or ""
    schema, _, jeton = entete.partition(" ")
    if schema.lower() == "bearer" and jeton.strip():
        empreinte = hashlib.sha256(jeton.strip().encode("utf-8")).hexdigest()
        return f"jeton:{empreinte[:_LONGUEUR_CLE]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=client_key)


@dataclass(frozen=True, slots=True)
class _Debits:
    """Ce que le palier d'un tenant accorde en requêtes par minute."""

    authorize_rpm: int | None
    proxy_rpm: int | None


#: Le relais entre la dépendance et le résolveur de limite.
#:
#: **Pourquoi un dictionnaire de module et pas `request.state`.** slowapi n'appelle pas
#: le fournisseur de limite avec la requête : il l'appelle avec la **clé de
#: compartiment** (`slowapi/wrappers.py`, `LimitGroup.__iter__` — et seulement si le
#: paramètre s'appelle littéralement `key`). Le résolveur n'a donc que cette chaîne, et
#: il faut un endroit où la dépendance a pu déposer ce qu'elle a lu.
#:
#: **Ce n'est pas un cache, et la nuance compte.** L'entrée est réécrite à *chaque*
#: requête authentifiée, par la requête elle-même, avant que le limiteur ne la lise :
#: la valeur servie n'est jamais périmée d'une requête. Un changement de palier prend
#: donc effet au prochain appel, ce qui est exactement le bon délai. Le dictionnaire
#: n'existe que pour traverser les quelques microsecondes qui séparent la dépendance du
#: limiteur.
_DEBITS: dict[str, _Debits] = {}
_VERROU = threading.Lock()

#: Plafond de mémoire du relais. Borné par le nombre de tenants actifs en pratique ;
#: la borne existe pour que ce ne soit pas une hypothèse. Au-delà, le relais est vidé
#: — la requête suivante de chaque tenant le remplit, et le seul coût est un appel
#: servi au plafond d'infrastructure.
_MAX_RELAIS = 8192


def publier_debits(cle: str, authorize_rpm: int | None, proxy_rpm: int | None) -> None:
    """Déposer, pour cette clé de compartiment, les débits que le palier accorde.

    Appelée par `api/gateway_auth.py` **après** avoir posé le tenant sur la requête :
    la clé déposée doit être celle que le limiteur relira, et elle change dès que le
    tenant est connu.
    """
    with _VERROU:
        if len(_DEBITS) >= _MAX_RELAIS:
            _DEBITS.clear()
        _DEBITS[cle] = _Debits(authorize_rpm=authorize_rpm, proxy_rpm=proxy_rpm)


def oublier_debits() -> None:
    """Vider le relais. **Réservé aux tests** : le produit ne l'appelle jamais."""
    with _VERROU:
        _DEBITS.clear()


def _compose(rpm: int | None, plafond: str, metrique: Metric) -> str:
    """La chaîne slowapi : la limite du palier **et** le plafond d'infrastructure.

    Les deux, séparées par `;`, parce que `limits.parse_many` les applique toutes. La
    plus stricte gagne à chaque instant, sans qu'on ait à choisir laquelle est
    « la bonne » — et surtout sans qu'un `min()` écrit ici puisse se tromper de sens le
    jour où l'une des deux bouge.

    **Palier inconnu ⇒ plafond d'infrastructure seul, et jamais l'inverse.** C'est le
    cas d'un appelant qui n'a pas encore été résolu, ou d'une route publique. Retomber
    sur le palier le plus restreint transformerait une lecture manquante en bridage
    d'un client qui a payé — un incident de facturation devenu incident de production,
    ce que `core/entitlements.tighten` refuse déjà explicitement pour les classes
    légères. Retomber sur le plafond d'infrastructure, c'est rendre le comportement
    d'avant ce lot : une limite existe, elle n'est simplement pas commerciale.
    """
    # **Rendre visible laquelle des deux a servi.** Sans ce compteur, un résolveur qui
    # retomberait *toujours* sur le plafond d'infrastructure serait indiscernable d'un
    # résolveur qui marche : la route répond, le 429 arrive quand il faut, rien ne
    # casse. C'est le mode de panne silencieux que ce lot entier existe pour fermer, et
    # il vaut aussi pour le correctif.
    registre.compter(
        "xsom_ratelimit_total",
        metric=metrique.value,
        source="plan" if rpm is not None else "infrastructure",
    )
    if rpm is None:
        return plafond
    palier = f"{rpm}/minute"
    if palier == plafond.strip():
        # **Deux fois la même limite la divise par deux.** `limits` construit un
        # `RateLimitItem` par morceau, et deux items identiques retombent sur la même
        # clé de stockage : slowapi les frappe tous les deux, donc chaque requête
        # consomme deux jetons. Un `entreprise` calé pile sur le plafond
        # d'infrastructure — la configuration par défaut, précisément — se retrouverait
        # limité à 1500/minute au lieu de 3000, sans que rien ne le signale. Vérifié
        # sur `limits`, pas déduit.
        return palier
    return f"{palier};{plafond}"


def authorize_rpm_limit(key: str) -> str:
    """La limite de `POST /v1/authorize` pour **cet appelant-ci**.

    Le paramètre doit s'appeler littéralement `key` : c'est à cette condition que
    slowapi passe la clé de compartiment au fournisseur plutôt que de l'appeler sans
    argument (`slowapi/wrappers.py`). Renommer ce paramètre ne casse rien de visible —
    la route continue de répondre, avec la limite statique pour tout le monde.
    """
    debits = _DEBITS.get(key)
    rpm = debits.authorize_rpm if debits else None
    return _compose(rpm, authorize_rate_limit(), Metric.authorize_rpm)


def proxy_rpm_limit(key: str) -> str:
    """La limite du proxy de modèles pour **cet appelant-ci**. Voir ci-dessus pour `key`."""
    debits = _DEBITS.get(key)
    rpm = debits.proxy_rpm if debits else None
    return _compose(rpm, llm_proxy_rate_limit(), Metric.proxy_rpm)


def export_rate_limit() -> str:
    """Dynamic limit string for the audit-export endpoint (from settings)."""
    return get_settings().export_rate_limit


def authorize_rate_limit() -> str:
    """Le **plafond d'infrastructure** de `/v1/authorize` — pas la limite commerciale.

    Ce que ce processus accepte d'un seul compartiment, quel que soit le palier acheté.
    La limite commerciale vient de `plan_limits.authorize_rpm` et se compose avec
    celle-ci : voir :func:`authorize_rpm_limit`.
    """
    return get_settings().authorize_rate_limit


def llm_proxy_rate_limit() -> str:
    """Le **plafond d'infrastructure** du proxy de modèles. Voir ci-dessus.

    `POST /v1/ai-traces` ne l'emprunte pas : voir :func:`ai_traces_rate_limit`.
    """
    return get_settings().llm_proxy_rate_limit


def ai_traces_rate_limit() -> str:
    """La limite de l'ingestion OTLP — **son** réglage, pas celui du proxy.

    Elle partageait `llm_proxy_rate_limit`. Ce partage n'a plus de sens depuis que ce
    dernier est calé sur le plus haut palier vendu : il ferait passer la seule garde
    d'une route d'ingestion de 240 à 6000 par minute, pour une route qui n'est ni un
    appel de modèle, ni plafonnée par `proxy_rpm`, ni même servie par le même plan.
    """
    return get_settings().ai_traces_rate_limit


def policy_draft_rate_limit() -> str:
    """Dynamic limit string for the natural-language policy assistant."""
    return get_settings().policy_draft_rate_limit


def signup_rate_limit() -> str:
    """Dynamic limit string for the public self-serve signup endpoint."""
    return get_settings().signup_rate_limit


def triage_rate_limit() -> str:
    """Dynamic limit string for the public profile-diagnostic endpoint."""
    return get_settings().triage_rate_limit


def threats_rate_limit() -> str:
    """Dynamic limit string for the public threat-rows endpoint."""
    return get_settings().threats_rate_limit
