"""Le code open source tient seul, et la liste qui le délimite ne pourrit pas.

Tout le dépôt est sous licence commerciale, sauf les chemins du bloc
`open-source-scope` de `LICENSING.md`. Le défaut est fermé : un fichier ajouté ou
déplacé reste commercial tant que personne ne l'a ouvert exprès.

Deux fautes restent possibles, et aucune ne casse la construction.

**Un chemin ouvert est renommé.** Il sort de la liste, redevient commercial sans que
personne l'ait décidé, et « le détecteur est open source » devient une promesse fausse.

**Le code ouvert se met à dépendre du code commercial.** Il compile toujours ici, mais
personne ne peut plus le construire avec la seule licence Apache : l'open source n'est
plus qu'une vitrine. Ce test lit donc les imports, les dépendances et les `extends`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath

RACINE = Path(__file__).resolve().parent.parent
PAQUETS = RACINE / "secret-guard" / "packages"
_BLOC = re.compile(
    r"<!-- open-source-scope:start -->\s*```text\n(.*?)```\s*<!-- open-source-scope:end -->",
    re.DOTALL,
)
_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']""")


def _perimetre_ouvert() -> list[str]:
    texte = (RACINE / "LICENSING.md").read_text(encoding="utf-8")
    bloc = _BLOC.search(texte)
    assert bloc, "LICENSING.md a perdu son bloc `open-source-scope`"
    lignes = (ligne.strip() for ligne in bloc.group(1).splitlines())
    return [ligne for ligne in lignes if ligne and not ligne.startswith("#")]


def _existe(chemin: str) -> bool:
    cible = RACINE / chemin
    return cible.is_dir() if chemin.endswith("/") else cible.is_file()


def _ouvert(chemin: str, perimetre: list[str]) -> bool:
    return any(chemin == p or (p.endswith("/") and chemin.startswith(p)) for p in perimetre)


def _relatif(cible: Path) -> str:
    return PurePosixPath(cible.resolve().relative_to(RACINE)).as_posix()


def _paquets_ouverts(perimetre: list[str]) -> list[Path]:
    return [
        dossier
        for dossier in sorted(PAQUETS.iterdir())
        if (dossier / "package.json").is_file() and _ouvert(f"{_relatif(dossier)}/", perimetre)
    ]


def _dossiers_des_paquets() -> dict[str, Path]:
    return {
        json.loads((dossier / "package.json").read_text(encoding="utf-8"))["name"]: dossier
        for dossier in PAQUETS.iterdir()
        if (dossier / "package.json").is_file()
    }


def _sources_ouvertes(perimetre: list[str]) -> list[Path]:
    fichiers: list[Path] = []
    for chemin in perimetre:
        cible = RACINE / chemin
        candidats = cible.rglob("*.ts") if chemin.endswith("/") else [cible]
        fichiers += [
            f
            for f in candidats
            if f.suffix == ".ts" and f.is_file() and "node_modules" not in f.parts
        ]
    return fichiers


def _import_ferme(source: Path, specificateur: str, perimetre: list[str]) -> str | None:
    """Le chemin commercial qu'un import atteint, ou `None` s'il reste ouvert."""
    if specificateur.startswith("."):
        cible = _relatif(source.parent / specificateur)
        return None if _ouvert(cible, perimetre) else cible
    nom = "/".join(specificateur.split("/")[:2]) if specificateur.startswith("@") else ""
    dossier = _dossiers_des_paquets().get(nom)
    if dossier is None:  # `node:`, ou un paquet tiers qui garde sa propre licence
        return None
    cible = f"{_relatif(dossier)}/"
    return None if _ouvert(cible, perimetre) else cible


def test_the_licence_files_point_to_each_other() -> None:
    licence = (RACINE / "LICENSE").read_text(encoding="utf-8")
    for fichier in ("LICENSE-COMMERCIAL.md", "LICENSE-APACHE", "LICENSING.md"):
        assert fichier in licence and (RACINE / fichier).is_file()
    apache = (RACINE / "LICENSE-APACHE").read_text(encoding="utf-8")
    assert "Apache License" in apache and "Version 2.0, January 2004" in apache


def test_every_open_path_exists() -> None:
    perimetre = _perimetre_ouvert()
    assert perimetre, "le périmètre open source est vide"
    absents = [p for p in perimetre if not _existe(p)]
    assert not absents, (
        f"LICENSING.md ouvre des chemins qui n'existent plus : {absents}\n"
        "  le fichier renommé est redevenu commercial sans que personne l'ait décidé.\n"
        "  fix : remplacez l'ancien chemin par le nouveau dans le bloc `open-source-scope`."
    )


def test_every_open_package_ships_the_apache_licence() -> None:
    apache = (RACINE / "LICENSE-APACHE").read_text(encoding="utf-8")
    paquets = _paquets_ouverts(_perimetre_ouvert())
    assert paquets, "aucun paquet ouvert : le bloc `open-source-scope` a changé"
    for dossier in paquets:
        manifeste = json.loads((dossier / "package.json").read_text(encoding="utf-8"))
        assert manifeste.get("license") == "Apache-2.0", dossier.name
        assert (dossier / "LICENSE").read_text(encoding="utf-8") == apache, dossier.name


def test_open_packages_depend_only_on_open_packages() -> None:
    perimetre = _perimetre_ouvert()
    dossiers = _dossiers_des_paquets()
    fautes: list[str] = []
    for dossier in _paquets_ouverts(perimetre):
        manifeste = json.loads((dossier / "package.json").read_text(encoding="utf-8"))
        for champ in ("dependencies", "peerDependencies", "optionalDependencies"):
            for nom in manifeste.get(champ, {}):
                cible = dossiers.get(nom)
                if cible is not None and not _ouvert(f"{_relatif(cible)}/", perimetre):
                    fautes.append(f"{dossier.name} → {nom}")
        tsconfig = json.loads((dossier / "tsconfig.json").read_text(encoding="utf-8"))
        if "extends" in tsconfig and not _ouvert(
            _relatif(dossier / tsconfig["extends"]), perimetre
        ):
            fautes.append(f"{dossier.name} → {tsconfig['extends']}")
    assert not fautes, f"des paquets ouverts dépendent de code commercial : {fautes}"


def test_open_sources_import_only_open_code() -> None:
    perimetre = _perimetre_ouvert()
    sources = _sources_ouvertes(perimetre)
    assert sources, "aucune source TypeScript dans le périmètre ouvert"
    fautes = [
        f"{_relatif(source)} → {ferme}"
        for source in sources
        for specificateur in _IMPORT.findall(source.read_text(encoding="utf-8"))
        if (ferme := _import_ferme(source, specificateur, perimetre)) is not None
    ]
    assert not fautes, (
        f"du code open source importe du code commercial : {fautes}\n"
        "  il ne se construit plus avec la seule licence Apache 2.0.\n"
        "  fix : déplacez la dépendance derrière un point d'extension côté commercial,\n"
        "  ou ouvrez aussi le fichier importé dans LICENSING.md, si c'est voulu."
    )
