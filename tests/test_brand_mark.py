"""La marque a un tracé, pas deux.

Le bouclier apparaît à deux endroits qui ne peuvent pas se voir l'un l'autre :
`ShieldMark`, rendu par React dans la page, et `app/icon.svg`, servi comme favicon.
Le second est un fichier statique — il ne peut rien importer, donc c'est une copie,
et l'on ne peut pas fermer la possibilité de la divergence comme `L9` l'a fait pour
les extraits d'intégration.

Ce qu'on peut faire, c'est l'interdire. Deux dessins pour une même marque finissent
par diverger, et **l'onglet est le seul endroit où l'on ne regarde jamais** : la
dérive y vivrait des mois sans que personne la voie.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_SOURCE = _RACINE / "frontend" / "lib" / "mark.ts"
_ICONE = _RACINE / "frontend" / "app" / "icon.svg"
_COMPOSANT = _RACINE / "frontend" / "components" / "brand.tsx"
_MIDDLEWARE = _RACINE / "frontend" / "middleware.ts"


def _constantes() -> dict[str, str]:
    """Les tracés déclarés par la source partagée."""
    texte = _SOURCE.read_text(encoding="utf-8")
    return dict(re.findall(r'export const (MARK_\w+) = "([^"]+)";', texte))


def test_the_shared_module_declares_the_paths_the_component_uses() -> None:
    """`ShieldMark` tient son tracé de la source, sans le réécrire."""
    noms = _constantes()
    assert set(noms) == {"MARK_VIEWBOX", "MARK_SHIELD", "MARK_CHECK"}, (
        f"la source déclare {sorted(noms)} — le garde ne sait plus quoi comparer"
    )

    composant = _COMPOSANT.read_text(encoding="utf-8")
    assert "@/lib/mark" in composant, "brand.tsx n'importe plus la source du tracé"
    for valeur in noms.values():
        assert valeur not in composant, (
            f"brand.tsx réécrit {valeur!r} au lieu de l'importer — c'est la deuxième "
            "copie que ce fichier existe pour empêcher"
        )


def test_the_favicon_carries_exactly_the_shared_paths() -> None:
    """Le favicon copie la source **au caractère près**.

    Un fichier statique ne peut pas importer : la copie est inévitable. Ce test la rend
    non divergente, ce qui est le seul contrôle disponible ici.
    """
    noms = _constantes()
    svg = _ICONE.read_text(encoding="utf-8")

    # Les tracés réellement dessinés, et non ceux qui traînent dans le commentaire :
    # un commentaire citant le bon tracé pendant qu'un `d` en dessine un autre est
    # exactement le cas que ce test doit attraper.
    sans_commentaires = re.sub(r"<!--.*?-->", "", svg, flags=re.DOTALL)
    traces = re.findall(r'\bd="([^"]+)"', sans_commentaires)

    assert traces == [noms["MARK_SHIELD"], noms["MARK_CHECK"]], (
        f"le favicon dessine {traces}, la source déclare "
        f"{[noms['MARK_SHIELD'], noms['MARK_CHECK']]}. Les deux marques ont divergé."
    )
    assert f'viewBox="{noms["MARK_VIEWBOX"]}"' in sans_commentaires, (
        "le favicon n'est plus dans le repère où les tracés sont exprimés — les mêmes "
        "coordonnées y dessineraient autre chose"
    )


def test_the_favicon_is_opaque() -> None:
    """Un favicon transparent disparaît sur une barre d'onglets claire.

    C'est le genre de défaut qu'on ne voit pas sur sa propre machine, parce qu'on n'a
    qu'un thème.
    """
    svg = re.sub(r"<!--.*?-->", "", _ICONE.read_text(encoding="utf-8"), flags=re.DOTALL)
    assert re.search(r'<rect[^>]*\bfill="#[0-9a-fA-F]{6}"', svg), (
        "le favicon n'a pas de fond opaque"
    )


def test_the_icon_route_is_excluded_from_the_auth_middleware() -> None:
    """Servir une image ne doit pas passer par Supabase.

    Le matcher excluait `favicon.ico`, qui n'existe pas, et pas `icon.svg`, qui est la
    route que Next sert réellement. Chaque requête d'icône construisait donc un client
    Supabase et appelait `auth.getUser()` — pour une image, à chaque chargement de page,
    y compris pour un visiteur non connecté.

    Le garde lit le **nom réel du fichier** plutôt qu'une chaîne écrite ici : renommer
    l'icône sans corriger le matcher rétablirait le défaut en silence.
    """
    nom = _ICONE.name
    matcher = _MIDDLEWARE.read_text(encoding="utf-8")
    ligne = next(ligne for ligne in matcher.splitlines() if "matcher:" in ligne)
    assert nom in ligne, (
        f"{nom} n'est pas exclu du matcher ({ligne.strip()}) — chaque requête d'icône "
        "traverserait l'authentification"
    )


def test_the_favicon_is_well_formed_xml() -> None:
    """Un SVG est du XML, et un XML mal formé ne s'affiche nulle part.

    La première version de ce fichier citait les jetons de couleur sous leur forme CSS,
    avec leur préfixe de deux tirets. **La séquence de deux tirets est interdite dans un
    commentaire XML.** Le fichier se servait en 200 avec le bon type MIME, passait tous
    les gardes de structure au-dessus, et aucun navigateur ne pouvait l'afficher — seul
    un rendu réel l'a montré, sous la forme d'une image cassée.

    Ce test est ce rendu, en moins cher.
    """
    try:
        # S314 vise le XML d'origine inconnue. Celui-ci est un fichier du dépôt, relu en
        # revue, et le parseur ne tourne qu'ici, dans la suite de tests. Prendre une
        # dépendance de plus pour ce seul appel coûterait plus que le risque qu'il porte.
        ET.parse(_ICONE)  # noqa: S314
    except ET.ParseError as exc:  # pragma: no cover - le message est le propos
        raise AssertionError(
            f"{_ICONE.name} n'est pas du XML bien formé : {exc}. Il se servira quand "
            "même, et ne s'affichera nulle part."
        ) from exc
