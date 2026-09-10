"""Le découpage en plans est une frontière de sécurité, pas un confort de déploiement.

Trois services servent désormais la même base de code : `décision` (`/v1/authorize`,
appelé par l'agent à chaque appel d'outil), `proxy LLM` (`/proxy/*`, à chaque appel de
modèle) et `console` (les vingt-trois routeurs qu'un humain appelle depuis un écran).

Ce que le découpage achète :

* **un rayon d'explosion.** Un déploiement raté sur l'export de conformité ne peut plus
  arrêter l'autorisation de toute la flotte ;
* **moins de secrets sur le chemin chaud.** Le plan `décision` n'a besoin ni de la clé
  `service_role` de Supabase ni des identifiants de fournisseurs LLM.

Les deux se perdent en silence. Si un routeur de console retombe un jour dans le plan
`décision`, rien n'échoue : le service répond, les tests passent, et le service censé
n'exposer qu'une route en expose quarante — dont l'export d'audit. C'est exactement le
genre de régression qu'aucune relecture ne rattrape, parce qu'elle ne casse rien.

D'où ces contrôles. Le premier est le plus important : il refuse un module d'`api/` qui
exposerait un `router` sans qu'on lui ait assigné un plan. Sans lui, la table serait
vraie le jour où on l'écrit et fausse au routeur suivant.
"""

from __future__ import annotations

import importlib
import pkgutil

import pytest
from fastapi import APIRouter, FastAPI

import api
from api.main import (
    _CHEMINS_SOCLE,
    _PLANS,
    _PREFIXES_CHAUDS,
    _SOCLE,
    Plane,
    create_app,
    routers_for,
)
from core.config import Settings


def _reglages() -> Settings:
    """Des réglages qui suffisent à construire l'application, sans base réelle.

    `create_app` ne se connecte pas : il range l'URL dans `app.state` et laisse les
    dépendances l'ouvrir à la requête. On peut donc inventorier les routes sans
    Postgres, et ce fichier reste rapide.
    """
    return Settings(_env_file=None, env="dev", database_url="postgresql://u:p@localhost/x")


def _chemins(plane: Plane) -> set[str]:
    """Les chemins qu'un plan sert réellement, lus dans son schéma OpenAPI.

    Et non `app.routes` : depuis FastAPI 0.137, l'inclusion d'un routeur est différée
    et `app.routes` ne contient que des marqueurs `_IncludedRouter` tant que rien ne
    l'a résolue. Un contrôle écrit dessus rendrait le même inventaire — vide — pour
    tous les plans, et passerait au vert en ne comparant rien.
    """
    app: FastAPI = create_app(_reglages(), plane=plane)
    return set(app.openapi()["paths"])


def _routeurs_des_modules() -> dict[str, APIRouter]:
    """Tout `router` exposé par un module d'`api/`, par nom de module."""
    trouves: dict[str, APIRouter] = {}
    for info in pkgutil.iter_modules(api.__path__):
        module = importlib.import_module(f"api.{info.name}")
        routeur = getattr(module, "router", None)
        if isinstance(routeur, APIRouter):
            trouves[info.name] = routeur
    return trouves


def test_every_router_in_the_package_is_assigned_a_plane() -> None:
    """Le contrôle qui compte : un routeur sans plan n'est servi nulle part.

    Il ne suffit pas de vérifier la table contre elle-même. On part des **modules
    réellement présents** dans `api/`, parce que le mode de panne est d'ajouter un
    fichier et d'oublier la table — pas d'écrire une table incohérente.
    """
    assignes = {id(r) for r in _SOCLE}
    for routeurs in _PLANS.values():
        assignes |= {id(r) for r in routeurs}

    orphelins = sorted(nom for nom, r in _routeurs_des_modules().items() if id(r) not in assignes)
    assert not orphelins, (
        f"ces modules d'`api/` exposent un routeur qu'aucun plan ne monte : {orphelins}\n"
        "  leurs routes ne sont servies par AUCUN service, `ALL` compris.\n"
        "  fix : ajoutez-les à `_PLANS` dans `api/main.py`, du côté chaud "
        "(`DECISION`/`LLM`) seulement s'ils sont sur le chemin d'un appel d'outil ou "
        "de modèle ; sinon `CONSOLE`."
    )


def test_no_router_is_served_by_two_planes() -> None:
    """Deux plans qui servent la même route, ce sont deux services à tenir à jour."""
    vus: dict[int, Plane] = {}
    doublons = []
    for plane, routeurs in _PLANS.items():
        for r in routeurs:
            if (precedent := vus.get(id(r))) is not None:
                doublons.append(f"{r.prefix or '/'} dans {precedent.value} et {plane.value}")
            vus[id(r)] = plane
    assert not doublons, "routeurs servis par deux plans :\n  " + "\n  ".join(doublons)


def test_the_all_plane_still_serves_everything() -> None:
    """Non-régression : le développement local, `make demo` et la suite montent `ALL`.

    Si `ALL` cessait d'être l'union, ce découpage casserait quarante-quatre appels à
    `create_app` sans qu'aucun d'eux ne parle de plans.
    """
    union = _chemins(Plane.DECISION) | _chemins(Plane.LLM) | _chemins(Plane.CONSOLE)
    assert _chemins(Plane.ALL) == union


@pytest.mark.parametrize("chaud", [Plane.DECISION, Plane.LLM])
def test_a_hot_plane_serves_only_its_declared_prefixes(chaud: Plane) -> None:
    """Le bénéfice du découpage, énoncé comme un test — et en liste blanche.

    Un service que l'agent appelle ne doit pas pouvoir servir l'export d'audit ni la
    file d'approbation : ce qui n'est pas monté ne peut pas fuir.

    **Pourquoi une liste blanche et non une comparaison avec la console.** La première
    version de ce contrôle intersectait les chemins du plan chaud avec ceux de la
    console. Elle attrapait un routeur *copié* — mais le contrôle de disjonction le
    faisait déjà — et laissait passer un routeur *déplacé* : sorti de la console, il
    n'était plus dans l'ensemble comparé, l'intersection était vide, et le test était
    vert. Vérifié par mutation : `audit_router` déplacé vers `DECISION` passait les
    onze contrôles, et le service joignable par tout agent client servait
    `/v1/audit/export`.

    Énoncé en liste blanche, le contrôle est fail-closed : toute route qui apparaît
    sur un plan chaud sans y avoir été déclarée le fait échouer, quelle qu'en soit
    l'origine.
    """
    autorises = _PREFIXES_CHAUDS[chaud]
    intrus = sorted(
        chemin
        for chemin in _chemins(chaud)
        if chemin not in _CHEMINS_SOCLE and not chemin.startswith(autorises)
    )
    assert not intrus, (
        f"le plan {chaud.value} sert des routes qu'il n'a pas déclarées : {intrus}\n"
        f"  préfixes autorisés : {list(autorises)}\n"
        "  ce service est joignable par tout agent client. Soit la route appartient au\n"
        "  chemin chaud — déclarez son préfixe dans `_PREFIXES_CHAUDS` — soit elle\n"
        "  appartient à la console, et elle doit retourner dans `Plane.CONSOLE`."
    )


#: Combien de chemins chaque plan chaud sert, relevé sur `a3e1473`.
#:
#: Même idiome que `_CONNU` dans `tests/test_token_opacity_trap.py` : une entrée peut
#: baisser — le test dit alors de la mettre à jour — mais aucune ne peut monter sans
#: qu'on l'écrive. C'est ce qui reste quand la liste blanche elle-même est élargie :
#: passer `_PREFIXES_CHAUDS[DECISION]` de `/v1/authorize` à `/v1` ouvre le plan chaud
#: à toute la console sans qu'aucun préfixe ne paraisse suspect, et seul un compte
#: gelé le voit.
#:
#: +1 chacun depuis le relevé : `/v1/ops/metrics` entre dans `_SOCLE`, donc sur les
#: **trois** plans. C'est le geste écrit que ce cliquet demande, et la raison tient en
#: une phrase : les compteurs vivent dans le processus qui répond, si bien qu'un
#: relevé monté sur la seule console ne dirait rien des deux chemins chauds — ceux
#: dont on veut précisément voir le volume et la latence. La route ne lit aucune base
#: et exige son propre jeton (`OPS_METRICS_TOKEN`) ; sans lui elle répond 404.
_BUDGET_CHAUD: dict[Plane, int] = {Plane.DECISION: 6, Plane.LLM: 10}


@pytest.mark.parametrize("chaud", [Plane.DECISION, Plane.LLM])
def test_a_hot_plane_does_not_grow(chaud: Plane) -> None:
    """Ajouter une route au chemin chaud doit être un geste écrit, pas un effet de bord."""
    servis = len(_chemins(chaud))
    attendu = _BUDGET_CHAUD[chaud]
    assert servis <= attendu, (
        f"le plan {chaud.value} sert {servis} chemins, contre {attendu} au relevé.\n"
        f"  {sorted(_chemins(chaud))}\n"
        "  une route de plus sur un service que tout agent client appelle est une\n"
        "  décision, pas un détail : si elle est voulue, montez le budget ici en le\n"
        "  disant ; sinon elle appartient à `Plane.CONSOLE`."
    )
    assert servis == attendu, (
        f"le plan {chaud.value} a rétréci ({servis} < {attendu}) — tant mieux, mais "
        "mettez le relevé à jour pour que le cliquet reste serré."
    )


def test_the_console_does_not_serve_the_hot_path() -> None:
    """L'inverse : la console qui servirait `/v1/authorize` annulerait le découpage.

    Un agent mal configuré la trouverait, et la panne qu'on cherche à éviter — la
    console tombe, les agents calent — reviendrait par la porte de derrière.
    """
    console = _chemins(Plane.CONSOLE)
    intrus = sorted(c for c in console if c.startswith(("/v1/authorize", "/proxy")))
    assert not intrus, f"la console sert encore le chemin chaud : {intrus}"


@pytest.mark.parametrize("plane", list(Plane))
def test_every_plane_answers_its_health_probes(plane: Plane) -> None:
    """Chaque service a son propre healthcheck Railway.

    Un plan qui ne répondrait pas à `/health` serait redémarré en boucle, et le
    découpage transformerait une panne partielle en panne totale — l'inverse du but.
    """
    chemins = _chemins(plane)
    for sonde in ("/health", "/health/ready"):
        assert sonde in chemins, f"le plan {plane.value} ne sert pas {sonde}"


def test_the_planes_are_not_vacuous() -> None:
    """Contrôle de non-vacuité : un inventaire vide ferait passer tout ce qui précède.

    Si `_chemins` rendait un ensemble vide — schéma OpenAPI désactivé, inclusion
    différée non résolue, table vidée — les contrôles de fuite ci-dessus seraient
    tous verts sans rien avoir comparé. C'est le mode de panne le plus probable de
    ce fichier.
    """
    assert len(_chemins(Plane.DECISION)) >= 3, "plan décision anormalement vide"
    assert len(_chemins(Plane.LLM)) >= 3, "plan proxy anormalement vide"
    assert len(_chemins(Plane.CONSOLE)) >= 20, "plan console anormalement court"
    assert "/v1/authorize" in _chemins(Plane.DECISION)
    assert any(c.startswith("/proxy/") for c in _chemins(Plane.LLM))
    assert len(routers_for(Plane.ALL)) == len(_SOCLE) + sum(len(v) for v in _PLANS.values())
