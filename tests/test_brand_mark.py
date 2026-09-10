"""La marque a un tracé, pas deux.

Le logo xSOM apparaît à deux endroits qui ne peuvent pas se voir l'un l'autre :
`public/xsom-mark.svg`, servi en `<img>` dans la page, et `app/icon.svg`, servi comme
favicon. Ce sont deux fichiers statiques : aucun ne peut importer l'autre, donc le
second est une copie, et l'on ne peut pas fermer la possibilité de la divergence comme
`L9` l'a fait pour les extraits d'intégration.

Ce qu'on peut faire, c'est l'interdire. Deux dessins pour une même marque finissent par
diverger, et **l'onglet est le seul endroit où l'on ne regarde jamais** : la dérive y
vivrait des mois sans que personne la voie.

**Ce que ce garde comparait avant, et pourquoi ça a changé.** Il verrouillait le favicon
sur `lib/mark.ts`, la source du bouclier coché. La propriété — l'onglet montre la
marque, et une seule — était la bonne ; la cible ne l'était pas. `ShieldMark` est une
icône d'interface, `components/brand.tsx` le dit noir sur blanc : « il n'a jamais été le
logo ». Le garde exigeait donc que l'onglet montre un bouclier dessiné à la main, dans
une boîte, pendant que `xsom.fr` sert son vrai logo en favicon (`index.html` l. 27,
`assets/logo/cuivre.svg`). Deux onglets côte à côte ne montraient pas la même marque, et
c'est le garde qui tenait le défaut en place. Il compare maintenant le favicon au logo
que le produit sert déjà dans la page — même propriété, cible juste.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from hashlib import sha256
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_SOURCE = _RACINE / "frontend" / "lib" / "mark.ts"
_ICONE = _RACINE / "frontend" / "app" / "icon.svg"
_LOGO = _RACINE / "frontend" / "public" / "xsom-mark.svg"
_LOGO_CLAIR = _RACINE / "frontend" / "public" / "xsom-mark-light.svg"
_SIGNAL = _RACINE / "frontend" / "design-system" / "assets" / "mark.svg"
_COMPOSANT = _RACINE / "frontend" / "components" / "brand.tsx"
_MIDDLEWARE = _RACINE / "frontend" / "middleware.ts"

_SVG = "{http://www.w3.org/2000/svg}"

# Source d'identité conservée dans le site original a9dfd3c :
# assets/logo/moderne-dark.svg. Le client exige le vrai logo bleu, non recoloré.
_SIGNAL_PALETTE = frozenset({"#3f93ff", "#1e64de", "#cad2dc"})
_ORIGINAL_LOGO_SHA256 = "92425e9553245374f5fe5095d9a7340876511a0c999d2df16ba4e8b6d90cb00a"


def _constantes() -> dict[str, str]:
    """Les tracés déclarés par la source partagée."""
    texte = _SOURCE.read_text(encoding="utf-8")
    return dict(re.findall(r'export const (MARK_\w+) = "([^"]+)";', texte))


def _sans_commentaires(chemin: Path) -> str:
    """Le SVG amputé de ses commentaires.

    Un commentaire citant le bon tracé pendant qu'un `d` en dessine un autre est
    exactement le cas que ces gardes doivent attraper.
    """
    return re.sub(r"<!--.*?-->", "", chemin.read_text(encoding="utf-8"), flags=re.DOTALL)


def _geometrie(chemin: Path) -> dict[str, list[str]]:
    """Ce qui est réellement dessiné : le repère, les tracés, les polygones.

    Cette comparaison explique précisément une divergence de dessin. Un second
    contrôle verrouille aussi les octets du logo bleu original.
    """
    svg = _sans_commentaires(chemin)
    return {
        "viewBox": re.findall(r'viewBox="([^"]+)"', svg),
        "d": re.findall(r'\bd="([^"]+)"', svg),
        "points": re.findall(r'\bpoints="([^"]+)"', svg),
    }


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


def test_the_favicon_draws_exactly_the_logo_served_in_the_page() -> None:
    """Le favicon copie le logo **au caractère près**.

    Deux fichiers statiques ne peuvent pas s'importer : la copie est inévitable. Ce
    test la rend non divergente, ce qui est le seul contrôle disponible ici.
    """
    icone = _geometrie(_ICONE)
    logo = _geometrie(_LOGO)

    assert icone["viewBox"] == logo["viewBox"], (
        f"le favicon est dans le repère {icone['viewBox']}, le logo dans "
        f"{logo['viewBox']} — les mêmes coordonnées y dessinent autre chose"
    )
    assert icone["d"] == logo["d"], (
        f"le favicon dessine {icone['d']}, le logo servi dans la page dessine "
        f"{logo['d']}. Les deux marques ont divergé."
    )
    assert icone["points"] == logo["points"], (
        f"les pointes des flèches divergent : favicon {icone['points']}, logo {logo['points']}"
    )
    assert icone["d"], "le favicon ne dessine plus rien"


def test_the_favicon_is_the_brand_and_not_the_interface_icon() -> None:
    """L'onglet montre le logo, pas le bouclier coché.

    `ShieldMark` est un pictogramme d'interface — une puce, un signe « contrôlé » dans
    les schémas. Le servir en favicon donnait au produit une marque que le site n'a
    jamais eue, visible dans le seul endroit qu'on ne relit pas. Ce garde est ce qui
    empêche le bouclier d'y revenir par mégarde.
    """
    noms = _constantes()
    svg = _sans_commentaires(_ICONE)
    for cle in ("MARK_SHIELD", "MARK_CHECK"):
        assert noms[cle] not in svg, (
            f"le favicon redessine {cle} : l'onglet remontrerait l'icône d'interface "
            "à la place de la marque"
        )


def test_the_favicon_stands_alone_in_the_original_blue_variant() -> None:
    """Le vrai logo bleu est conservé au caractère près, sans fond ajouté."""
    racine = ET.parse(_ICONE).getroot()  # noqa: S314 - fichier du dépôt, cf. plus bas
    couleurs: set[str] = set()
    for enfant in racine:
        if enfant.tag == f"{_SVG}defs":
            continue  # les `rect` des masques découpent le tracé, ils ne le cadrent pas
        for noeud in enfant.iter():
            couleurs.update(
                couleur
                for attribut in ("fill", "stroke")
                if (couleur := noeud.get(attribut)) not in (None, "none")
            )
            assert noeud.tag != f"{_SVG}rect", (
                "le favicon remet le signe dans une boîte — le site sert le sien "
                "détouré, et la lisibilité vient de la teinte, pas d'un cadre"
            )

    assert couleurs == _SIGNAL_PALETTE, f"la palette du favicon diverge : {couleurs}"
    assert _ICONE.read_bytes() == _LOGO.read_bytes() == _SIGNAL.read_bytes(), (
        "le favicon, le logo servi et la source partagée doivent être identiques"
    )
    assert sha256(_SIGNAL.read_bytes()).hexdigest() == _ORIGINAL_LOGO_SHA256, (
        "la source partagée ne correspond plus aux octets du logo bleu original"
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
    matcher = _MIDDLEWARE.read_text(encoding="utf-8")
    bloc = re.search(r"\bmatcher:\s*\[([\s\S]*?)\]", matcher)
    assert bloc, "le tableau matcher est introuvable"
    motifs = re.findall(r'"([^"\n]+)"', bloc.group(1))
    assert motifs, "le tableau matcher ne contient aucun motif"
    for fichier in (_ICONE, _LOGO, _LOGO_CLAIR):
        assert fichier.exists(), f"la variante de marque {fichier.name} est absente"
        nom = fichier.name
        assert nom in bloc.group(1), (
            f"{nom} n'est pas exclu du matcher — chaque requête "
            "d'image traverserait l'authentification"
        )
        assert not any(re.match(motif, f"/{nom}") for motif in motifs), (
            f"/{nom} traverse encore le matcher d'authentification"
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
