"""`FR-168` — la surface non authentifiée est gelée, et le gel est vérifié.

Le constat hérité annonçait une divulgation de posture par `/health/ready` et un
manifeste de données non authentifié. Ni l'un ni l'autre n'existe : `Readiness` ne
porte que quatre booléens et `tests/test_health.py` mord déjà dessus (ajouter un champ
au modèle fait rougir trois tests) ; la route de manifeste n'a jamais été construite.

Ce qui manquait n'était donc pas une protection, c'était un **garde de surface**. La
protection existante est de *forme* — elle épingle la liste des champs d'une route
nommée — et non de *surface* : aucun test ne regarde `app.routes`, et
`scripts/audit_security.py` n'a pas de contrôle de ce genre. Une route publique
nouvelle passait la CI en vert. Le risque n'était pas théorique : `POST /v1/triage`
est une route publique ajoutée deux commits avant ce lot.

Le fichier gèle donc la liste, par **égalité stricte** et non par inclusion : une route
publique nouvelle est rouge tant que le diff qui l'ajoute ne l'inscrit pas ici — et ce
diff est exactement l'endroit où l'on relit `FR-168`.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.routing import Route

from api import gateway_auth, ops, security
from api.main import create_app
from core.config import Settings

#: Les trois authentificateurs réels du produit. La détection se fait par **identité
#: de fonction** et jamais par sous-chaîne du nom : `get_ai_reader` n'aurait été
#: reconnu par aucune heuristique de mots-clés, et un garde qui rate un
#: authentificateur classe une route protégée comme publique — puis exige qu'on
#: l'inscrive dans l'allowlist, ce qui grave l'erreur.
#:
#: Cinq désormais, et les deux ajouts corrigent chacun une classification fausse.
#: `get_gateway_principal_from_path` authentifie les deux routes du proxy dont le jeton
#: voyage dans le **chemin** : elles le faisaient dans le corps, invisiblement pour ce
#: garde, et figuraient donc dans l'allowlist ci-dessous — l'erreur gravée que le
#: paragraphe précédent décrit. `require_ops_reader` tient le relevé d'exploitation, et
#: il a été écrit comme dépendance **pour** être vu ici.
_AUTHENTICATORS = frozenset(
    {
        security.get_current_user,
        security.get_ai_reader,
        gateway_auth.get_gateway_principal,
        gateway_auth.get_gateway_principal_from_path,
        ops.require_ops_reader,
    }
)

#: La surface non authentifiée, gelée. Chaque entrée porte sa raison d'exister.
_PUBLIC = frozenset(
    {
        ("GET", "/health"),  # sonde de liveness
        ("GET", "/health/ready"),  # quatre booléens, cf. tests/test_health.py
        ("POST", "/v1/signup"),  # créer un compte suppose de ne pas en avoir
        ("POST", "/v1/triage"),  # le diagnostic public (`QO-7`)
        # Le relevé des menaces (`L3`). Publique délibérément, et c'est la moitié de
        # sa raison d'être : la faire passer par `/v1/triage` obligerait à donner son
        # adresse pour lire une liste de menaces. En lecture seule d'un artefact déjà
        # committé — aucune base, aucune donnée personnelle, aucune écriture.
        ("GET", "/v1/threats"),
        # Les deux routes du proxy à jeton dans le chemin ne sont plus ici : elles
        # s'authentifiaient dans le handler, ce garde ne pouvait pas le voir, et
        # l'allowlist gravait une route protégée comme publique. Elles passent par
        # `get_gateway_principal_from_path`, une vraie dépendance — que ce garde
        # reconnaît, et qui s'exécute avant le limiteur de débit par surcroît.
    }
)

#: Les routes que FastAPI ajoute lui-même, publiques par construction et coupées en
#: production (`CLAUDE.md` §4.8). Ce ne sont pas des `APIRoute`, donc un parcours
#: filtré par type ne les voit jamais — et `/openapi.json` **est** l'inventaire
#: complet de la surface.
_DOCS = frozenset(
    {
        ("GET", "/openapi.json"),
        ("GET", "/docs"),
        ("GET", "/docs/oauth2-redirect"),
        ("GET", "/redoc"),
    }
)


def _walk(routes: list[Any]) -> list[Any]:
    """Toutes les routes, en descendant dans les routeurs inclus.

    Indispensable : sous cette version de FastAPI, `app.routes` ne porte que deux
    `APIRoute` et une enveloppe par `include_router`. Une boucle naïve verrait deux
    routes, l'assertion d'égalité serait satisfaite par une allowlist minuscule, et
    le garde passerait à vide.
    """
    found: list[Any] = []
    for route in routes:
        nested = getattr(route, "original_router", None)
        if nested is not None:
            found.extend(_walk(list(nested.routes)))
        else:
            found.append(route)
    return found


def _authenticated(route: APIRoute) -> bool:
    """Le graphe de dépendances de cette route contient-il un authentificateur ?"""
    stack = list(route.dependant.dependencies)
    while stack:
        dependency = stack.pop()
        if dependency.call in _AUTHENTICATORS:
            return True
        stack.extend(dependency.dependencies)
    return False


def _surface(app: FastAPI) -> set[tuple[str, str]]:
    """Les couples (méthode, chemin) qu'un anonyme peut atteindre.

    Toutes les classes de routes, pas seulement `APIRoute` : les `Route` de Starlette
    que FastAPI monte pour la documentation sont publiques et comptent.
    """
    public: set[tuple[str, str]] = set()
    for route in _walk(list(app.routes)):
        if isinstance(route, APIRoute):
            if not _authenticated(route):
                public.update((method, route.path) for method in sorted(route.methods or []))
        elif isinstance(route, Route):
            public.update(
                (method, route.path) for method in sorted(route.methods or []) if method != "HEAD"
            )
    return public


def test_the_walk_actually_descends_into_the_included_routers(dev_settings: Settings) -> None:
    """Le garde du garde : sans la descente, tout le reste passerait à vide.

    Si `_walk` cessait de descendre, `_surface` ne verrait que les deux routes du
    premier niveau et l'égalité stricte serait satisfaite par une allowlist tronquée —
    un test vert qui ne regarde presque rien. On épingle donc les trois faits dont la
    descente dépend : ce que voit la boucle naïve, qu'aucune enveloppe ne survit au
    parcours, et qu'une route d'un routeur inclus est bien atteinte.
    """
    app = create_app(dev_settings)
    top = {route.path for route in app.routes if isinstance(route, APIRoute)}
    walked = _walk(list(app.routes))

    assert top == {"/health", "/v1/me"}  # ce que voit une boucle naïve : deux routes
    assert not any(getattr(route, "original_router", None) for route in walked)
    assert "/v1/signup" in {r.path for r in walked if isinstance(r, APIRoute)} - top


def test_the_public_surface_is_the_frozen_allowlist(dev_settings: Settings) -> None:
    assert _surface(create_app(dev_settings)) == _PUBLIC | _DOCS


def test_production_serves_no_documentation(monkeypatch: pytest.MonkeyPatch) -> None:
    """`CLAUDE.md` §4.8 — `/docs`, `/redoc` et `/openapi.json` coupés en `ENV=prod`.

    Jusqu'ici cette règle n'était vérifiée que par un grep de sous-chaîne dans
    `scripts/audit_security.py`. Ici elle est mesurée sur l'application construite.

    Elle rend aussi visible ce que le gel ci-dessus dit à voix basse : hors
    production, `/openapi.json` publie l'inventaire complet de la surface. C'est
    voulu, et c'est la raison pour laquelle l'`ENV` d'un déploiement n'est pas un
    réglage de confort.
    """
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    prod = Settings(_env_file=None, env="prod", cors_allow_origins=["https://console.example.com"])
    surface = _surface(create_app(prod))

    assert surface & _DOCS == set()
    assert surface == _PUBLIC  # et rien d'autre n'apparaît en production non plus


def test_the_surface_gate_detects_a_new_public_route(dev_settings: Settings) -> None:
    """Le contrôle négatif : l'instrument sait-il repérer une route hors liste ?

    Sans lui, « la surface est égale à l'allowlist » pourrait tenir parce que le
    parcours est cassé, l'authentificateur mal détecté, ou l'allowlist recopiée
    depuis la sortie du parcours. On ajoute donc la route exacte que le constat
    hérité voulait voir protégée — un inventaire de capacités non authentifié — et on
    exige que le même helper la rapporte.
    """
    app = create_app(dev_settings)
    app.get("/v1/system/capabilities")(lambda: {"dlp": False, "anchors": False})

    assert ("GET", "/v1/system/capabilities") in _surface(app)
