"""La table des capacités est exhaustive, et le plancher est dans tous les paliers.

Deux contrôles, et ils gardent les deux fautes opposées d'une gamme commerciale.

**Un verrou oublié ne casse rien.** Un routeur ajouté sans capacité déclarée sert
sa fonctionnalité gratuitement, à tout le monde, indéfiniment. Aucun test écrit
après coup ne le trouve — il n'y a rien à trouver : le code fait ce qu'il a
toujours fait. Le seul moment où l'oubli est visible est celui où on écrit la
table, d'où un contrôle qui part des **modules réellement présents** dans `api/`.

**Un verrou de trop se voit trop tard.** Le jour où quelqu'un dira « on met le HITL
en pro, ça fera vendre », l'architecture ne dira pas non toute seule. `PLANCHER`
est la ligne rouge, et ce fichier est la seule forme qui y survive : §4.1 et §4.2
ne sont pas des options.
"""

from __future__ import annotations

import importlib
import pkgutil

import pytest
from fastapi import APIRouter

import api
from api.main import _CAPACITE_PAR_ROUTEUR, _capacite_de
from core.entitlements import PLANCHER, Capability
from tests.conftest import DBHandle


def _routeurs_des_modules() -> dict[str, APIRouter]:
    trouves: dict[str, APIRouter] = {}
    for info in pkgutil.iter_modules(api.__path__):
        module = importlib.import_module(f"api.{info.name}")
        routeur = getattr(module, "router", None)
        if isinstance(routeur, APIRouter):
            trouves[info.name] = routeur
    return trouves


def test_every_api_router_declares_a_capability_even_when_it_is_none() -> None:
    """Le contrôle qui compte, et il part des modules, pas de la table.

    Le mode de panne est d'ajouter un fichier et d'oublier la table — pas d'écrire
    une table incohérente. `None` doit être **écrit** : « libre » est une décision,
    et une décision non écrite est indistinguable d'un oubli.
    """
    declares = {id(r) for r, _ in _CAPACITE_PAR_ROUTEUR}
    orphelins = sorted(nom for nom, r in _routeurs_des_modules().items() if id(r) not in declares)
    assert not orphelins, (
        f"ces modules d'`api/` exposent un routeur qu'aucune ligne ne classe : {orphelins}\n"
        "  leur fonctionnalité est servie à tous les paliers, gratuitement, et rien\n"
        "  n'échouera jamais pour le signaler.\n"
        "  fix : ajoutez-les à `_CAPACITE_PAR_ROUTEUR` dans `api/main.py` — avec\n"
        "  `None` et sa raison si la route ne se vend pas."
    )


def test_no_router_is_declared_twice() -> None:
    """Deux lignes pour un routeur, c'est la seconde qui ne sert jamais."""
    vus: set[int] = set()
    doublons = [r.prefix or "/" for r, _ in _CAPACITE_PAR_ROUTEUR if id(r) in vus or vus.add(id(r))]  # type: ignore[func-returns-value]
    assert not doublons, f"routeurs déclarés deux fois : {doublons}"


def test_the_guarantees_are_never_behind_a_paywall() -> None:
    """§4.1 et §4.2 ne se vendent pas — énoncé comme un refus de la base de code.

    Un produit qui vend le contrôle des actions ne peut pas facturer le fait de
    tenir un humain dans la boucle, ni celui d'écrire ce qu'il a fait : ce serait
    vendre la garantie et livrer le risque.
    """
    from api.main import approvals_router, audit_router, authorize_router, policy_router

    for routeur, nom in (
        (authorize_router, "authorize"),
        (approvals_router, "approvals"),
        (audit_router, "audit"),
        (policy_router, "policy"),
    ):
        assert _capacite_de(routeur) is None, (
            f"le routeur `{nom}` est derrière un palier.\n"
            "  §4.1 (HITL garanti) et §4.2 (le journal prouve) ne sont pas des options\n"
            "  commerciales. Si c'est un choix délibéré, il doit être discuté ailleurs\n"
            "  qu'en changeant une ligne de table."
        )


def test_the_floor_capabilities_are_in_every_plan(db: DBHandle) -> None:
    """Et la même ligne rouge, vue depuis la base plutôt que depuis le code.

    Les deux moitiés sont nécessaires : le contrôle ci-dessus tient les routes
    libres, celui-ci tient les capacités que **tout** palier doit porter — y compris
    `free`. Un seed qui les retirerait de `free` passerait le premier.
    """
    for (palier,) in db.conn.execute("select code from plans").fetchall():
        accordees = {
            Capability(c[0])
            for c in db.conn.execute(
                "select capability from plan_capabilities where plan = %s", (palier,)
            ).fetchall()
        }
        manquantes = sorted(c.value for c in PLANCHER - accordees)
        assert not manquantes, f"le palier `{palier}` ne porte pas {manquantes}"


def test_the_enum_and_the_catalog_say_the_same_thing(db: DBHandle) -> None:
    """Le miroir Python/SQL, dans les deux sens.

    Une capacité présente en base et absente de l'enum ne peut jamais être exigée
    par une route : elle est vendue et ne verrouille rien. Une capacité présente
    dans l'enum et absente du catalogue ne peut jamais être accordée : la clé
    étrangère refuse l'octroi, et la fonctionnalité est un 402 permanent.
    """
    en_base = {c[0] for c in db.conn.execute("select capability from capability_catalog")}
    en_code = {c.value for c in Capability}
    assert en_base == en_code, (
        f"en base seulement : {sorted(en_base - en_code)}\n"
        f"en code seulement : {sorted(en_code - en_base)}"
    )


def test_the_metric_enum_and_the_catalog_agree(db: DBHandle) -> None:
    from core.entitlements import Metric

    en_base = {m[0] for m in db.conn.execute("select metric from metric_catalog")}
    assert en_base == {m.value for m in Metric}


@pytest.mark.parametrize("palier", ["free", "pro", "entreprise"])
def test_no_plan_grants_the_mcp_gateway(db: DBHandle, palier: str) -> None:
    """La passerelle ne se vend pas au clic, et aucun palier ne peut l'accorder.

    `0027` reste le seul verrou de l'offre accompagnée : la passerelle demande une
    installation chez le client — elle lui donne un accès direct à sa base et exige
    un déploiement à côté de son agent. Un `entreprise` qui l'obtiendrait de son
    palier obtiendrait une chose que personne n'a installée.
    """
    accordees = {
        c[0]
        for c in db.conn.execute(
            "select capability from plan_capabilities where plan = %s", (palier,)
        ).fetchall()
    }
    assert not {c for c in accordees if "gateway" in c}, (
        f"le palier `{palier}` accorde une capacité de passerelle : {accordees}"
    )
    # Et le drapeau lui-même reste à `false` pour un tenant fraîchement créé, quel
    # que soit son palier — la suite force `entreprise` par défaut.
    tenant = db.conn.execute(
        "insert into tenants (name, plan) values ('T', %s) returning mcp_gateway_enabled",
        (palier,),
    ).fetchone()
    db.conn.commit()
    assert tenant is not None and tenant[0] is False
