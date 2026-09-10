"""Optional Sentry initialization (CLAUDE.md §3).

Observability must never be required to boot: with no DSN configured this is a
no-op.

**Pourquoi ``send_default_pii=False`` ne suffit pas, contrairement à ce que ce
fichier affirmait.** Dans le SDK Sentry 2.x, seule la capture des *cookies*
dépend de ce drapeau. Le **corps de requête** est capturé indépendamment de lui,
jusqu'à ``max_request_body_size`` qui vaut ``"medium"`` (10 Ko) par défaut, et
``include_local_variables`` vaut ``True``. L'intégration FastAPI s'active toute
seule dès que le paquet est présent, et ``logger.error(..., exc_info=...)``
d'``api/errors.py`` produit un événement.

Conséquence, avant ce correctif : une exception non gérée sur ``/v1/authorize``
expédiait ``payload.arguments`` — les arguments d'outil bruts — et une exception
sur ``/proxy/*`` le prompt de l'utilisateur final. C'est exactement ce que la
règle §4.10 interdit, et le docstring de ce fichier promettait le contraire.

Trois verrous plutôt qu'un, parce qu'ils ne couvrent pas les mêmes fuites :

* ``max_request_body_size="never"`` — le corps ;
* ``include_local_variables=False`` — la même donnée reprise dans la pile
  (``body: bytes`` est une variable locale du proxy) ;
* ``before_send`` — la ceinture : il retire le corps résiduel et **réécrit
  l'URL**, que le nettoyeur par défaut du SDK ne touche jamais. Deux routes du
  proxy portent le jeton de passerelle dans le chemin, donc l'URL est un secret.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from core.config import Settings

if TYPE_CHECKING:  # `sentry_sdk` est importé paresseusement : sans DSN, on ne le charge pas.
    from sentry_sdk.types import Event

#: Les segments de chemin qui portent un jeton, réécrits avant expédition.
#:
#: `/proxy/{provider}/{token}/v1/...` et `/proxy/anthropic/{token}/...` mettent le
#: jeton dans l'URL — c'est ce qui permet de pointer n'importe quel SDK sur la
#: passerelle sans en-tête personnalisé, et c'est aussi ce qui fait de l'URL un
#: secret. Le nettoyeur par défaut du SDK ne regarde que le corps et les en-têtes.
_JETON_DANS_URL = re.compile(r"(/proxy/[^/]+)/[^/]+/(v1|messages)", re.IGNORECASE)


def _scrub(event: Event, _hint: dict[str, Any]) -> Event:
    """Retire le corps de requête et l'éventuel jeton de l'URL, avant expédition.

    Redondant avec les deux options ci-dessus, et gardé pour cette raison : une
    option mal orthographiée est ignorée en silence par le SDK, un `before_send`
    qui ne tourne pas se voit en test.
    """
    requete: Any = event.get("request")
    if isinstance(requete, dict):
        requete.pop("data", None)
        url = requete.get("url")
        if isinstance(url, str):
            requete["url"] = _JETON_DANS_URL.sub(r"\1/<jeton>/\2", url)
    return event


def init_observability(settings: Settings) -> bool:
    """Initialize Sentry when a DSN is configured. Returns True if enabled."""
    if not settings.sentry_dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        # Voir le docstring du module : `send_default_pii` ne couvre PAS le corps
        # de requête, et sans ces trois lignes une seule exception non gérée
        # exfiltre les arguments d'outil ou le prompt du client (§4.10).
        max_request_body_size="never",
        include_local_variables=False,
        before_send=_scrub,
    )
    return True
