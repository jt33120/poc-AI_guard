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
import re
from pathlib import Path

import pytest
from fastapi import APIRouter

import api
from api.main import _CAPACITE_PAR_ROUTEUR, _capacite_de
from core.entitlements import PLANCHER, Capability, Metric, capacites_requises
from core.policy import parse_policy
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


def _dependances(route: object) -> set[object]:
    """Toutes les fonctions dont une route dépend, sous-dépendances comprises."""
    vues: set[object] = set()
    pile = list(getattr(getattr(route, "dependant", None), "dependencies", []))
    while pile:
        dep = pile.pop()
        appel = getattr(dep, "call", None)
        if appel is not None:
            vues.add(appel)
        pile.extend(getattr(dep, "dependencies", []))
    return vues


def test_a_gated_router_authenticates_with_the_token_the_gate_reads() -> None:
    """Le garde lit un jeton console : le verrouiller ailleurs **casse** la route.

    `requires` appelle `get_current_user`, qui exige un `Authorization: Bearer` de
    la console. Trois routeurs n'en présentent aucun — le proxy LLM et l'ingestion
    AI s'authentifient par jeton de passerelle, la lecture AI par jeton de lecture,
    et le triage est public. Les verrouiller ne les aurait pas facturés : cela leur
    aurait fait exiger un porteur qu'ils ne portent pas.

    Mesuré plutôt que déduit : la première version de la table les incluait, et
    **quarante et un tests** de la suite l'ont dit d'un coup. Ce contrôle-ci le dit
    en une seconde, et il le dira avant le prochain routeur.

    **Et il a fallu deux essais.** La première version de ce test passait par
    `app.routes` : depuis FastAPI 0.137 l'inclusion est différée et on n'y trouve
    que des marqueurs sans `dependant`, si bien que la boucle ne parcourait **rien**
    et que la mutation ne la faisait pas broncher. Le contrôle de non-vacuité en bas
    est ce qui l'empêche de redevenir muet — c'est le même piège que celui déjà
    documenté dans `tests/test_api_planes.py`.
    """
    from api.security import get_current_user

    fautifs: list[str] = []
    examinees = 0
    for routeur, capacite in _CAPACITE_PAR_ROUTEUR:
        if capacite is None:
            continue
        for route in routeur.routes:
            if not hasattr(route, "dependant"):
                continue
            examinees += 1
            if get_current_user not in _dependances(route):
                fautifs.append(f"{getattr(route, 'path', '?')} (capacité {capacite.value})")

    assert not fautifs, (
        "ces routes sont verrouillées par un garde qui lit un jeton console, alors "
        "qu'elles n'en demandent pas :\n  "
        + "\n  ".join(sorted(fautifs))
        + "\n  le verrou ne les facturera pas, il les rendra inappelables.\n"
        "  fix : passez le routeur à `None` dans `_CAPACITE_PAR_ROUTEUR` et comptez "
        "son quota là où son identité est résolue."
    )
    assert examinees >= 20, (
        f"seulement {examinees} routes examinées — le contrôle ci-dessus ne compare "
        "presque rien, et passerait quoi qu'on mette dans la table"
    )


#: Les métriques que `metric_catalog` publie et que le produit ne compte pas encore,
#: chacune avec la raison qui rend l'absence défendable. Une entrée ici est une
#: **limite affichée qui ne s'applique pas** : elle a le coût commercial d'une
#: promesse et l'effet technique de rien.
#:
#: Le garde ci-dessous refuse les deux directions. Une métrique publiée qui n'est
#: nommée nulle part et qui manque à cette table fait échouer la suite ; une
#: métrique câblée qui y traîne encore la fait échouer aussi, sinon la liste
#: pourrit et finit par excuser ce qui marche.
NON_CABLEES: dict[str, str] = {
    "seats": (
        "aucun site de croissance : le produit n'a pas de route d'invitation. "
        "`core/signup.py::provision_account` crée le tenant ET son unique siège "
        "admin dans le même geste, donc le plafond ne peut pas être atteint par "
        "un chemin qui existe. Câbler `enforce_stock` ici serait du code mort."
    ),
}

#: `core/entitlements.py` définit l'énumération : y trouver `Metric.x` ne prouve rien.
_HORS_PREUVE = ("core/entitlements.py",)


def _metriques_nommees_par_le_produit() -> set[str]:
    """Les métriques que le code de production nomme, hors module de définition."""
    racine = Path(__file__).resolve().parent.parent
    vues: set[str] = set()
    for paquet in ("api", "core", "gateway"):
        for fichier in (racine / paquet).rglob("*.py"):
            relatif = fichier.relative_to(racine).as_posix()
            if relatif in _HORS_PREUVE:
                continue
            vues.update(re.findall(r"\bMetric\.([a-z_]+)", fichier.read_text(encoding="utf-8")))
    return vues


def _capacites_nommees_par_le_produit() -> set[str]:
    """Les capacités que le code de production nomme, hors module de définition."""
    racine = Path(__file__).resolve().parent.parent
    vues: set[str] = set()
    for paquet in ("api", "core", "gateway"):
        for fichier in (racine / paquet).rglob("*.py"):
            if fichier.relative_to(racine).as_posix() in _HORS_PREUVE:
                continue
            vues.update(re.findall(r"\bCapability\.([a-z_]+)", fichier.read_text(encoding="utf-8")))
    return vues


def test_the_enum_and_the_catalogue_name_the_same_metrics(db: DBHandle) -> None:
    """`Metric` et `metric_catalog` sont deux listes ; elles doivent être la même.

    Sans ce contrôle, une métrique ajoutée d'un seul côté est soit une limite que
    le code ne sait pas lire, soit un compteur qu'aucun palier ne borne.
    """
    rows = db.conn.execute("select metric from metric_catalog").fetchall()
    catalogue = {str(r[0]) for r in rows}
    enum = {m.value for m in Metric}
    assert catalogue == enum, (
        f"catalogue seul : {sorted(catalogue - enum)} · énumération seule : "
        f"{sorted(enum - catalogue)}\n"
        "  fix : `core/entitlements.py::Metric` et l'insert de `metric_catalog` "
        "dans `supabase/migrations/0030_saas_plans.sql` se modifient ensemble."
    )


def test_every_published_metric_is_either_counted_or_declared_uncounted(db: DBHandle) -> None:
    """Une limite publiée que rien ne compte est une promesse sans effet.

    **C'est le défaut qui ne casse rien**, donc celui qu'aucun test écrit après
    coup ne trouve : le plan affiche « 10 000 appels de proxy », le produit n'en
    compte aucun, et tout le monde est content jusqu'à la facture. Le seul moment
    où l'oubli est visible est celui où on écrit la table — d'où un contrôle qui
    part de ce que la base **publie**, pas de ce que le code croit câbler.

    Le contrôle est statique à dessein : il demande que le produit **nomme** la
    métrique hors de son module de définition. Un site nommé mais mort resterait
    invisible ici — c'est le banc de mutation qui répond de celui-là, et il n'a
    rien à répondre tant que le nom n'apparaît nulle part.
    """
    rows = db.conn.execute("select metric from metric_catalog").fetchall()
    publiees = {str(r[0]) for r in rows}
    nommees = _metriques_nommees_par_le_produit()

    muettes = sorted(publiees - nommees - set(NON_CABLEES))
    assert not muettes, (
        f"ces métriques sont publiées dans `metric_catalog` et `plan_limits`, et "
        f"aucun fichier d'`api/`, `core/` ou `gateway/` ne les nomme : {muettes}\n"
        "  le plafond s'affiche au client et ne s'applique jamais.\n"
        "  fix : comptez-les au site qui les produit, ou déclarez-les dans "
        "`NON_CABLEES` avec la raison — jamais en silence."
    )

    perimees = sorted(set(NON_CABLEES) & nommees)
    assert not perimees, (
        f"ces métriques sont déclarées non câblées et le produit les nomme "
        f"pourtant : {perimees}\n"
        "  fix : retirez-les de `NON_CABLEES` — une liste d'exceptions qui "
        "excuse du code vivant n'arrête plus rien."
    )

    inconnues = sorted(set(NON_CABLEES) - publiees)
    assert not inconnues, (
        f"`NON_CABLEES` nomme des métriques que le catalogue ne publie pas : {inconnues}"
    )


#: Les capacités que `capability_catalog` publie et que rien ne vérifie, chacune avec
#: la raison qui rend l'absence défendable. Jumeau exact de `NON_CABLEES` : une
#: fonctionnalité vendue par palier et servie à tous les paliers est une ligne de
#: prix sans effet, et elle ne se découvre pas — le code fait ce qu'il a toujours
#: fait, aucun test n'échoue, et le client `free` reçoit ce qu'il n'a pas payé.
NON_VERIFIEES: dict[str, str] = {
    "fria": (
        "section du dossier de conformité (`core/compliance.py::fria_scaffold`), "
        "déjà verrouillé par `compliance_pack` sur son routeur. Deux verrous pour "
        "une porte."
    ),
    "third_party_verdicts": (
        "idem : le chaînage des verdicts tiers se lit dans le dossier de "
        "conformité, et l'ingestion a son propre verrou (`verdicts_ingest`)."
    ),
    "control_plane_export": (
        "idem : `control_plane.assignments_section` est la section "
        "« identity_federation » du dossier de conformité."
    ),
    "triage": "surface publique — il n'y a pas encore de tenant à facturer.",
    "profiles": (
        "les profils de déploiement sont servis par le triage public "
        "(`api/threats.py`, `core/threat_map.py`) : même raison."
    ),
    "sso_federation": (
        "réglage de **déploiement** et non de tenant : `settings.issuer_claims` "
        "gouverne l'émetteur pour toute l'instance (`api/security.py`). Il n'y a "
        "pas de site par tenant où le vérifier."
    ),
    "quota_override": (
        "aucune route ne crée de dérogation : `tenant_quota_overrides` se remplit "
        "en base, comme geste commercial. La capacité documente une éligibilité, "
        "elle ne garde aucun chemin — et le dire vaut mieux que le laisser croire."
    ),
}


def _capacites_exigees_par_une_policy() -> set[str]:
    """Ce que le verrou d'enregistrement de policy sait exiger.

    `capacites_requises` vit dans `core/entitlements.py`, que le scan statique
    exclut — l'énumération y est définie, donc y trouver `Capability.x` ne prouve
    rien. On interroge donc la fonction sur son **comportement** : une policy qui
    allume la fonctionnalité, et la capacité qu'elle réclame en retour.
    """
    base = "defaults:\n  unknown_tool: deny\n"
    documents = (
        base + "  integrity_enabled: true\n",
        base + "  taint_policy: escalate\n",
        base + "  risk_bands: {auto: 30, notify: 50, hitl: 70}\n",
        "tools:\n  - {name: t, class: irreversible, approval: human_dual}\n" + base,
    )
    exigees: set[str] = set()
    for texte in documents:
        exigees.update(c.value for c in capacites_requises(parse_policy(texte)))
    return exigees


def test_the_policy_gate_asks_for_a_capability_per_paid_switch() -> None:
    """Quatre fonctionnalités vendues sont des **champs de policy**.

    Un tenant `free` les allumait en tapant quatre lignes de YAML. Le contrôle vit
    à l'enregistrement et jamais à la décision : refuser d'honorer un garde déjà
    enregistré retirerait une garde à l'exécution pour une raison commerciale, ce
    que `tighten` existe précisément pour interdire.
    """
    assert _capacites_exigees_par_une_policy() == {
        Capability.integrity.value,
        Capability.taint_guard.value,
        Capability.risk_bands.value,
        Capability.hitl_dual.value,
    }


def test_a_policy_that_turns_nothing_on_asks_for_nothing() -> None:
    """Sinon le verrou refuserait la policy par défaut, et personne ne pourrait rien
    enregistrer."""
    assert capacites_requises(parse_policy("defaults:\n  unknown_tool: deny\n")) == frozenset()


def test_every_published_capability_is_either_checked_or_declared_unchecked(
    db: DBHandle,
) -> None:
    """Une capacité vendue que rien ne vérifie est servie gratuitement à tous.

    C'est l'autre moitié du garde des métriques, et le même mode de panne : le
    défaut ne casse rien, donc aucun test écrit après coup ne le trouve. Le seul
    moment où l'oubli est visible est celui où on écrit la table.

    `PLANCHER` est une explication à part entière et pas une exception : §4.1 et
    §4.2 sont dans les trois paliers **par construction**, donc les verrouiller
    n'aurait aucun sens — il n'existe pas de palier qui puisse les refuser.
    """
    rows = db.conn.execute("select capability from capability_catalog").fetchall()
    publiees = {str(r[0]) for r in rows}
    verifiees = _capacites_nommees_par_le_produit() | _capacites_exigees_par_une_policy()
    plancher = {c.value for c in PLANCHER}

    muettes = sorted(publiees - verifiees - plancher - set(NON_VERIFIEES))
    assert not muettes, (
        f"ces capacités sont vendues par palier et vérifiées nulle part : {muettes}\n"
        "  tous les paliers les reçoivent, y compris ceux qui ne les ont pas\n"
        "  achetées, et rien n'échouera jamais pour le signaler.\n"
        "  fix : vérifiez-les au site qui sert la fonctionnalité, ou déclarez-les\n"
        "  dans `NON_VERIFIEES` avec la raison."
    )

    perimees = sorted(set(NON_VERIFIEES) & (verifiees | plancher))
    assert not perimees, (
        f"ces capacités sont déclarées non vérifiées et le produit les vérifie "
        f"pourtant : {perimees}\n"
        "  fix : retirez-les de `NON_VERIFIEES`."
    )

    inconnues = sorted(set(NON_VERIFIEES) - publiees)
    assert not inconnues, (
        f"`NON_VERIFIEES` nomme des capacités que le catalogue ne publie pas : {inconnues}"
    )


def test_the_capability_enum_and_the_catalogue_name_the_same_things(db: DBHandle) -> None:
    """Deux listes, une seule vérité — même raison que pour les métriques."""
    rows = db.conn.execute("select capability from capability_catalog").fetchall()
    catalogue = {str(r[0]) for r in rows}
    enum = {c.value for c in Capability}
    assert catalogue == enum, (
        f"catalogue seul : {sorted(catalogue - enum)} · énumération seule : "
        f"{sorted(enum - catalogue)}"
    )
