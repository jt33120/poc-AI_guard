"""La frontière de licence suit la frontière commerciale, et elle ne pourrit pas.

`LICENSING.md` énumère les chemins sous licence commerciale. Deux fautes la rendent
fausse sans que rien ne casse.

**Un chemin renommé sort de la liste.** Le fichier déplacé tombe sous Apache 2.0
par défaut, et une fonctionnalité payante devient libre, définitivement, pour toute
version publiée ainsi.

**Un routeur payant ajouté n'y entre jamais.** `_CAPACITE_PAR_ROUTEUR` le verrouille
bien derrière son palier, mais son code est publié sous Apache 2.0 : n'importe qui
peut le reprendre sans l'abonnement. Ce test part des routeurs réellement montés.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from fastapi import APIRouter

from api.main import _CAPACITE_PAR_ROUTEUR

RACINE = Path(__file__).resolve().parent.parent
_BLOC = re.compile(
    r"<!-- commercial-scope:start -->\s*```text\n(.*?)```\s*<!-- commercial-scope:end -->",
    re.DOTALL,
)
_CAPACITE_LIBRE = re.compile(r"\('free',\s*'([a-z_]+)'\)")


def _perimetre_commercial() -> list[str]:
    texte = (RACINE / "LICENSING.md").read_text(encoding="utf-8")
    bloc = _BLOC.search(texte)
    assert bloc, "LICENSING.md a perdu son bloc `commercial-scope`"
    lignes = (ligne.strip() for ligne in bloc.group(1).splitlines())
    return [ligne for ligne in lignes if ligne and not ligne.startswith("#")]


def _capacites_libres() -> frozenset[str]:
    migrations = sorted((RACINE / "supabase" / "migrations").glob("*.sql"))
    return frozenset(
        capacite
        for fichier in migrations
        for capacite in _CAPACITE_LIBRE.findall(fichier.read_text(encoding="utf-8"))
    )


def _fichier_du_routeur(routeur: APIRouter) -> str:
    for nom, module in list(sys.modules.items()):
        if nom.startswith("api.") and getattr(module, "router", None) is routeur:
            return f"{nom.replace('.', '/')}.py"
    raise AssertionError(f"aucun module `api.*` n'expose ce routeur : {routeur.prefix!r}")


def _existe(chemin: str) -> bool:
    cible = RACINE / chemin
    return cible.is_dir() if chemin.endswith("/") else cible.is_file()


def _couvert(chemin: str, perimetre: list[str]) -> bool:
    return any(chemin == p or (p.endswith("/") and chemin.startswith(p)) for p in perimetre)


def test_the_licence_states_both_licences() -> None:
    texte = (RACINE / "LICENSE").read_text(encoding="utf-8")
    assert "Apache License" in texte and "Version 2.0, January 2004" in texte
    assert "LICENSE-COMMERCIAL.md" in texte and "LICENSING.md" in texte
    assert (RACINE / "LICENSE-COMMERCIAL.md").is_file()


def test_every_commercial_path_exists() -> None:
    perimetre = _perimetre_commercial()
    assert perimetre, "le périmètre commercial est vide"
    absents = [p for p in perimetre if not _existe(p)]
    assert not absents, (
        f"LICENSING.md cite des chemins qui n'existent plus : {absents}\n"
        "  un fichier renommé est retombé sous Apache 2.0.\n"
        "  fix : remplacez l'ancien chemin par le nouveau dans le bloc `commercial-scope`."
    )


def test_the_free_plan_is_read_from_the_migrations() -> None:
    """Sans ce garde-fou, une regex muette rendrait tous les routeurs payants."""
    assert {"authorize", "audit_chain", "hitl_single", "policy_edit"} <= _capacites_libres()


def test_every_paid_router_is_under_the_commercial_licence() -> None:
    libres = _capacites_libres()
    perimetre = _perimetre_commercial()
    payants = sorted(
        _fichier_du_routeur(routeur)
        for routeur, capacite in _CAPACITE_PAR_ROUTEUR
        if capacite is not None and capacite.value not in libres
    )
    assert payants, "aucun routeur payant trouvé : la table ou le plan `free` a changé"
    oublies = [chemin for chemin in payants if not _couvert(chemin, perimetre)]
    assert not oublies, (
        f"ces routeurs sont réservés à un palier payant mais publiés sous Apache 2.0 : {oublies}\n"
        "  fix : ajoutez-les, avec leur module `core/`, au bloc `commercial-scope`\n"
        "  de LICENSING.md."
    )
