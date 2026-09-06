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
"""

from __future__ import annotations

import hashlib

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from core.config import get_settings

#: Longueur du condensé retenue comme clé. Un compartiment n'a pas besoin d'un
#: condensé complet, et on ne garde jamais le jeton lui-même (§4.10).
_LONGUEUR_CLE = 32


def client_key(request: Request) -> str:
    """Le compartiment de limitation : l'identité présentée, sinon l'adresse.

    On condense le jeton plutôt que de le retenir : la clé vit en mémoire dans le
    limiteur, et un secret d'authentification n'a rien à y faire (§4.10).
    """
    entete = request.headers.get("authorization") or ""
    schema, _, jeton = entete.partition(" ")
    if schema.lower() == "bearer" and jeton.strip():
        empreinte = hashlib.sha256(jeton.strip().encode("utf-8")).hexdigest()
        return f"jeton:{empreinte[:_LONGUEUR_CLE]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=client_key)


def export_rate_limit() -> str:
    """Dynamic limit string for the audit-export endpoint (from settings)."""
    return get_settings().export_rate_limit


def authorize_rate_limit() -> str:
    """Dynamic limit string for the agent authorization endpoint (from settings)."""
    return get_settings().authorize_rate_limit


def llm_proxy_rate_limit() -> str:
    """Dynamic limit string for the LLM monitoring proxy (from settings)."""
    return get_settings().llm_proxy_rate_limit


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
