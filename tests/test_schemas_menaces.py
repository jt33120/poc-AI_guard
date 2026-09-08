"""Les diagrammes de menace sont tenus par une grammaire, pas par une consigne.

Vingt-trois figures SVG, écrites une par une, rendues **en ligne** dans la page pour
qu'elles lisent les jetons CSS et basculent avec la bande. Inline veut dire que leur
balisage entre dans le document tel quel : ce fichier est la raison pour laquelle on
peut se le permettre.

Ce qu'il empêche, dans l'ordre de ce que ça coûte :

1. **Une couleur écrite en dur.** C'est le défaut qui ne se voit pas : la figure est
   parfaite sur la bande où on l'a dessinée, et devient invisible sur l'autre. Aucun
   `fill=`, `stroke=`, `style=`, `opacity=`, aucun `#hex`, `rgb()` ni `var()`. La
   couleur vient des classes, donc des jetons, donc du contexte.
2. **Une géométrie qui sort du cadre.** Un `viewBox` ne rogne pas : il met à l'échelle.
   Un élément à `y=140` dans un cadre de 112 ne disparaît pas, il écrase le reste.
3. **Deux étiquettes qui se chevauchent.** Illisible, et invisible à la relecture du
   code : il faut calculer les rectangles.
4. **Du balisage qui n'a rien à faire là.** `<script>`, `<foreignObject>`, `<animate>`,
   une référence externe. Le corps vient du dépôt et non d'un visiteur, mais un
   `dangerouslySetInnerHTML` sans garde est une promesse qu'on tient de mémoire.

La grammaire est petite exprès. Six classes, une liste d'éléments, un cadre fixe :
c'est ce qui fait que vingt-trois figures dessinées séparément forment un système.
Un garde qui autoriserait « tout SVG valide » laisserait passer vingt-trois styles.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_FRONT = _RACINE / "frontend"
_SCHEMAS = _FRONT / "lib" / "schemas.ts"
_MENACES = _FRONT / "lib" / "menaces.ts"
_CSS = _FRONT / "app" / "globals.css"

#: Le cadre. Une marge de 4 est laissée au trait : un contour de 1.4 centré sur le
#: bord serait rogné de moitié par le bord du `viewBox`.
_LARGEUR, _HAUTEUR = 200.0, 112.0
_MARGE = 4.0

#: Tout le vocabulaire. Ajouter un élément ici est une décision de conception, pas un
#: détail : c'est ce qui garde les vingt-trois figures dans la même langue.
_ELEMENTS = frozenset(
    {"g", "rect", "circle", "line", "path", "polygon", "polyline", "text", "title"}
)

_CLASSES = frozenset({"n", "n--hot", "f", "a", "a-move", "x", "d", "t", "t--hot"})

#: Les attributs qui portent une couleur, sous toutes leurs formes.
_COULEUR = re.compile(
    r"\b(?:fill|stroke|style|color|opacity|fill-opacity|stroke-opacity)\s*=", re.I
)
_VALEUR_COULEUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bvar\(--")

#: Les deux seules références permises : les têtes de flèche du `<defs>` partagé.
_MARQUEURS = frozenset({"url(#fx)", "url(#ax)"})

#: La police du diagramme fait 8px en chasse fixe. 4.9px par caractère est la largeur
#: d'avance mesurée des monospaces usuelles à cette taille ; elle sert à approcher la
#: boîte d'un texte, pas à la connaître au pixel près.
_AVANCE, _HAUTEUR_TEXTE = 4.9, 8.0


def _corps() -> dict[int, str]:
    """Rang vers corps SVG, lus depuis `lib/schemas.ts`."""
    texte = _SCHEMAS.read_text(encoding="utf-8")
    trouve: dict[int, str] = {}
    for m in re.finditer(r"^\s{2}(\d+):\s*`([^`]*)`", texte, flags=re.MULTILINE):
        trouve[int(m.group(1))] = m.group(2)
    return trouve


def _rangs_attendus() -> set[int]:
    """Les rangs déclarés dans `MENACES` : la liste que les figures doivent couvrir."""
    texte = _MENACES.read_text(encoding="utf-8")
    return {int(r) for r in re.findall(r"\{\s*rang:\s*(\d+),", texte)}


def _arbre(corps: str) -> ET.Element:
    """Le corps, enraciné pour être analysable. Lève si le XML est mal formé."""
    return ET.fromstring(f"<svg>{corps}</svg>")  # noqa: S314 - contenu du dépôt


def _points_du_chemin(d: str) -> list[tuple[float, float]]:
    """Les points d'un `path`, commandes absolues et relatives suivies.

    Les arcs (`A`) ne sont pas gérés, et c'est voulu : leurs sept paramètres mêlent
    coordonnées et drapeaux, si bien qu'un extracteur naïf lirait un drapeau comme une
    abscisse. Ils sont donc refusés plus haut plutôt que mal analysés ici.
    """
    points: list[tuple[float, float]] = []
    x = y = 0.0
    depart = (0.0, 0.0)
    for cmd, args in re.findall(r"([MmLlHhVvCcSsQqTtZz])([^MmLlHhVvCcSsQqTtZzAa]*)", d):
        n = [float(v) for v in re.findall(r"-?\d*\.?\d+(?:e-?\d+)?", args)]
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            x, y = depart
            continue
        if c == "H":
            for v in n:
                x = x + v if rel else v
                points.append((x, y))
            continue
        if c == "V":
            for v in n:
                y = y + v if rel else v
                points.append((x, y))
            continue
        # Les autres commandes consomment des paires ; seul le dernier couple d'un
        # groupe est un point d'ancrage, mais les points de contrôle comptent aussi
        # dans l'encombrement visible d'une courbe.
        for i in range(0, len(n) - 1, 2):
            px, py = n[i], n[i + 1]
            ax, ay = (x + px, y + py) if rel else (px, py)
            points.append((ax, ay))
        if len(n) >= 2:
            px, py = n[-2], n[-1]
            x, y = (x + px, y + py) if rel else (px, py)
        if c == "M":
            depart = (x, y)
    return points


def _boites(el: ET.Element) -> list[tuple[str, float, float, float, float]]:
    """L'encombrement de chaque élément dessiné : (balise, x0, y0, x1, y1)."""
    out: list[tuple[str, float, float, float, float]] = []
    for e in el.iter():
        b = e.tag
        g = e.get
        try:
            if b == "rect":
                x, y = float(g("x", 0)), float(g("y", 0))
                out.append((b, x, y, x + float(g("width", 0)), y + float(g("height", 0))))
            elif b == "circle":
                cx, cy, r = float(g("cx", 0)), float(g("cy", 0)), float(g("r", 0))
                out.append((b, cx - r, cy - r, cx + r, cy + r))
            elif b == "line":
                xs = [float(g("x1", 0)), float(g("x2", 0))]
                ys = [float(g("y1", 0)), float(g("y2", 0))]
                out.append((b, min(xs), min(ys), max(xs), max(ys)))
            elif b in ("polygon", "polyline"):
                n = [float(v) for v in re.findall(r"-?\d*\.?\d+", g("points", ""))]
                xs, ys = n[0::2], n[1::2]
                if xs and ys:
                    out.append((b, min(xs), min(ys), max(xs), max(ys)))
            elif b == "path":
                p = _points_du_chemin(g("d", ""))
                if p:
                    out.append(
                        (
                            b,
                            min(q[0] for q in p),
                            min(q[1] for q in p),
                            max(q[0] for q in p),
                            max(q[1] for q in p),
                        )
                    )
            elif b == "text":
                out.append((b, *_boite_texte(e)))
        except (TypeError, ValueError):  # pragma: no cover - attrapé par le test de forme
            continue
    return out


def _boite_texte(e: ET.Element) -> tuple[float, float, float, float]:
    """Le rectangle approché d'une étiquette, ancrage compris."""
    x, y = float(e.get("x", 0)), float(e.get("y", 0))
    largeur = _AVANCE * len(e.text or "")
    ancre = e.get("text-anchor", "start")
    x0 = x - largeur / 2 if ancre == "middle" else x - largeur if ancre == "end" else x
    # `y` est la ligne de base : le corps du texte monte au-dessus.
    return (x0, y - _HAUTEUR_TEXTE * 0.8, x0 + largeur, y + _HAUTEUR_TEXTE * 0.2)


def _chevauchent(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def test_every_ranked_threat_has_its_diagram() -> None:
    """Une menace sans figure laisse un trou dans une colonne qui en montre vingt-deux."""
    manquants = sorted(_rangs_attendus() - set(_corps()))
    assert not manquants, (
        f"ces menaces n'ont pas de diagramme : {manquants}\n"
        "  fix : ajoutez leur entrée dans `frontend/lib/schemas.ts`."
    )


def test_no_diagram_is_left_without_a_threat() -> None:
    """L'inverse : une figure orpheline est du balisage relu et payé pour rien."""
    orphelins = sorted(set(_corps()) - _rangs_attendus())
    assert not orphelins, f"figures sans menace correspondante : {orphelins}"


def test_every_diagram_is_well_formed() -> None:
    """Un corps mal formé casse le rendu de la page entière, pas seulement le sien."""
    casses = []
    for rang, corps in sorted(_corps().items()):
        try:
            _arbre(corps)
        except ET.ParseError as erreur:
            casses.append(f"{rang} : {erreur}")
    assert not casses, "XML mal formé :\n  " + "\n  ".join(casses)


def test_no_diagram_writes_a_colour_of_its_own() -> None:
    """Le défaut invisible : parfait sur une bande, effacé sur l'autre.

    Une figure qui écrit sa couleur ne suit pas `.section--light`. Elle reste juste
    aussi longtemps que la section ne change pas de fond, et ment le jour où elle
    change. C'est exactement le défaut que `--copper-sheen` a produit dans le relevé.
    """
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for motif, quoi in (
            (_COULEUR, "attribut de couleur"),
            (_VALEUR_COULEUR, "valeur de couleur"),
        ):
            for trouve in motif.findall(corps):
                fautes.append(f"{rang} : {quoi} « {trouve} »")
    assert not fautes, (
        "une figure écrit sa propre couleur :\n  " + "\n  ".join(fautes) + "\n\n"
        "  fix : la couleur vient des classes (n, n--hot, f, a, x, d, t, t--hot), "
        "elles seules lisent les jetons et basculent avec la bande."
    )


def test_only_the_declared_vocabulary_is_used() -> None:
    """Six classes et une liste d'éléments : c'est ce qui fait un système."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for e in _arbre(corps).iter():
            if e.tag == "svg":
                continue
            if e.tag not in _ELEMENTS:
                fautes.append(f"{rang} : élément <{e.tag}> hors vocabulaire")
            inconnues = set((e.get("class") or "").split()) - _CLASSES
            if inconnues:
                fautes.append(f"{rang} : classe(s) {sorted(inconnues)} hors vocabulaire")
            marqueur = e.get("marker-end")
            if marqueur and marqueur not in _MARQUEURS:
                fautes.append(f"{rang} : marker-end « {marqueur} » inconnu")
    assert not fautes, "vocabulaire :\n  " + "\n  ".join(fautes)


def test_nothing_animates_or_executes_on_its_own() -> None:
    """`<animate>` contourne `prefers-reduced-motion`, `<script>` contourne tout le reste."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for interdit in (
            "<script",
            "<animate",
            "<foreignObject",
            "<image",
            "<use",
            "xlink:",
            "http",
        ):
            if interdit in corps:
                fautes.append(f"{rang} : « {interdit} » interdit")
        combien = corps.count("a-move")
        if combien > 1:
            fautes.append(f"{rang} : {combien} éléments animés, un seul est permis")
    assert not fautes, (
        "balisage interdit :\n  " + "\n  ".join(fautes) + "\n\n"
        "  Le mouvement est porté par la feuille de style, qui l'arrête sous "
        "`prefers-reduced-motion` ; un `<animate>` y échapperait."
    )


def test_every_diagram_carries_its_accessible_name() -> None:
    """Une figure rendue en `role=img` sans nom est annoncée comme un blanc."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        racine = _arbre(corps)
        titres = racine.findall("title")
        if len(titres) != 1:
            fautes.append(f"{rang} : {len(titres)} <title>, il en faut exactement un")
            continue
        if next(iter(racine)).tag != "title":
            fautes.append(f"{rang} : le <title> n'est pas en première position")
        texte = (titres[0].text or "").strip()
        if not texte:
            fautes.append(f"{rang} : <title> vide")
        elif len(texte) > 90:
            fautes.append(f"{rang} : <title> de {len(texte)} caractères, 90 au plus")
    assert not fautes, "nom accessible :\n  " + "\n  ".join(fautes)


def test_labels_stay_short_and_french() -> None:
    """Six étiquettes courtes. Au-delà, la figure se lit comme un paragraphe."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        textes = list(_arbre(corps).iter("text"))
        if len(textes) > 6:
            fautes.append(f"{rang} : {len(textes)} étiquettes, six au plus")
        for t in textes:
            contenu = (t.text or "").strip()
            if len(contenu) > 16:
                fautes.append(
                    f"{rang} : « {contenu} » fait {len(contenu)} caractères, seize au plus"
                )
            if "—" in contenu:
                fautes.append(f"{rang} : tiret cadratin dans « {contenu} »")
    assert not fautes, "étiquettes :\n  " + "\n  ".join(fautes)


def test_nothing_falls_outside_the_frame() -> None:
    """Un `viewBox` met à l'échelle, il ne rogne pas : ce qui déborde écrase le reste."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for balise, x0, y0, x1, y1 in _boites(_arbre(corps)):
            if x0 < -0.01 or y0 < -0.01 or x1 > _LARGEUR + 0.01 or y1 > _HAUTEUR + 0.01:
                fautes.append(
                    f"{rang} : <{balise}> occupe x {x0:.0f}..{x1:.0f}, y {y0:.0f}..{y1:.0f} "
                    f"hors du cadre {_LARGEUR:.0f}x{_HAUTEUR:.0f}"
                )
    assert not fautes, "géométrie hors cadre :\n  " + "\n  ".join(fautes)


def test_no_two_labels_collide() -> None:
    """Deux étiquettes superposées sont illisibles, et invisibles à la relecture du code."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        boites = [(t.text or "", _boite_texte(t)) for t in _arbre(corps).iter("text")]
        for i, (ta, ba) in enumerate(boites):
            for tb, bb in boites[i + 1 :]:
                if _chevauchent(ba, bb):
                    fautes.append(f"{rang} : « {ta} » et « {tb} » se chevauchent")
    assert not fautes, (
        "étiquettes superposées :\n  " + "\n  ".join(fautes) + "\n\n"
        "  Largeur approchée : 4.9 px par caractère à 8 px de corps."
    )


def test_stations_are_big_enough_to_hold_their_label() -> None:
    """Une boîte plus étroite que son étiquette la laisse dépasser des deux côtés."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        racine = _arbre(corps)
        for e in racine.iter("rect"):
            if "n" not in (e.get("class") or "").split():
                continue
            largeur, hauteur = float(e.get("width", 0)), float(e.get("height", 0))
            if largeur < 34 or hauteur < 20:
                fautes.append(f"{rang} : station de {largeur:.0f}x{hauteur:.0f}, 34x20 au minimum")
    assert not fautes, "stations trop petites :\n  " + "\n  ".join(fautes)


def test_the_stylesheet_defines_every_class_the_diagrams_use() -> None:
    """Une classe employée mais non stylée dessine du noir par défaut, sur toutes les bandes."""
    css = _CSS.read_text(encoding="utf-8")
    employees = set()
    for corps in _corps().values():
        for e in _arbre(corps).iter():
            employees.update((e.get("class") or "").split())
    manquantes = sorted(c for c in employees if f".{c}" not in css)
    assert not manquantes, (
        f"classes employées par les figures mais absentes de `globals.css` : {manquantes}"
    )


def test_the_guard_reads_diagrams_that_are_really_there() -> None:
    """Contrôle de non-vacuité : un garde qui ne lit rien passe toujours.

    Toutes les vérifications ci-dessus bouclent sur `_corps()`. Si la regex qui lit
    `schemas.ts` cesse de correspondre, elles rendent zéro faute sur zéro figure et le
    fichier entier devient décoratif. C'est le mode de panne le plus probable ici.
    """
    corps = _corps()
    assert len(corps) >= 16, f"seulement {len(corps)} figures lues, la regex a-t-elle cassé ?"
    assert all(len(c) > 80 for c in corps.values()), "au moins une figure est quasi vide"
    total = sum(len(list(_arbre(c).iter("text"))) for c in corps.values())
    assert total >= len(corps), "les figures ne portent presque aucune étiquette"


#: Le seul rang qui a le droit à une diagonale : le croisement y est le sujet, deux
#: entrées presque identiques donnant deux verdicts opposés.
_DIAGONALES_PERMISES = frozenset({23})

#: La hauteur unique des stations. La critique du jeu complet a montré que 22 et 24
#: cohabitaient : les lignes de base du texte s'en trouvaient décalées d'un pixel d'une
#: vignette à l'autre, et la colonne « vibrait » au défilement. Une seule valeur.
_HAUTEUR_STATION = 24.0


def _segments(el: ET.Element) -> list[tuple[str, float, float, float, float]]:
    """Les segments droits d'une figure : (classe, x1, y1, x2, y2)."""
    out: list[tuple[str, float, float, float, float]] = []
    for e in el.iter():
        cls = " ".join(sorted((e.get("class") or "").split()))
        if e.tag == "line":
            out.append(
                (
                    cls,
                    float(e.get("x1", 0)),
                    float(e.get("y1", 0)),
                    float(e.get("x2", 0)),
                    float(e.get("y2", 0)),
                )
            )
        elif e.tag == "polyline":
            n = [float(v) for v in re.findall(r"-?\d*\.?\d+", e.get("points", ""))]
            pts = list(zip(n[0::2], n[1::2], strict=False))
            out.extend((cls, a[0], a[1], b[0], b[1]) for a, b in pairwise(pts))
        elif e.tag == "path":
            pts = _points_du_chemin(e.get("d", ""))
            out.extend((cls, a[0], a[1], b[0], b[1]) for a, b in pairwise(pts))
    return out


def test_no_two_stations_overlap() -> None:
    """Deux boîtes superposées se lisent comme un bug, pas comme une intention.

    Trouvé par la critique du jeu et non par ce fichier : au rang 7, `Humain` occupait
    8..56 et `Agent` 48..96, huit pixels l'un sur l'autre. Le garde vérifiait les
    étiquettes, pas les stations. Il les vérifie maintenant.
    """
    fautes = []
    for rang, corps in sorted(_corps().items()):
        boites = [
            (
                float(e.get("x", 0)),
                float(e.get("y", 0)),
                float(e.get("x", 0)) + float(e.get("width", 0)),
                float(e.get("y", 0)) + float(e.get("height", 0)),
            )
            for e in _arbre(corps).iter("rect")
            if "n" in (e.get("class") or "").split()
        ]
        for i, a in enumerate(boites):
            for b in boites[i + 1 :]:
                if _chevauchent(a, b):
                    fautes.append(
                        f"{rang} : deux stations se chevauchent, "
                        f"x {a[0]:.0f}..{a[2]:.0f} et x {b[0]:.0f}..{b[2]:.0f}"
                    )
    assert not fautes, "stations superposées :\n  " + "\n  ".join(fautes)


def test_stations_share_one_height() -> None:
    """Une hauteur unique, sinon la colonne vibre d'une vignette à l'autre."""
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for e in _arbre(corps).iter("rect"):
            if "n" not in (e.get("class") or "").split():
                continue
            h = float(e.get("height", 0))
            if abs(h - _HAUTEUR_STATION) > 0.01:
                fautes.append(
                    f"{rang} : station de hauteur {h:.0f}, {_HAUTEUR_STATION:.0f} attendue"
                )
    assert not fautes, (
        "hauteurs de station dépareillées :\n  " + "\n  ".join(fautes) + "\n\n"
        "  Une exception voulue se dessine avec une AUTRE marque, pas avec une station étirée."
    )


def test_the_block_bar_is_a_short_perpendicular_stroke() -> None:
    """`x` a un seul dialecte : une barre courte en travers du flux qu'elle coupe.

    Le jeu en avait deux — la barre courte, et une longue diagonale barrant une boîte
    entière. Deux sens sous une même classe, donc aucune des deux ne s'apprend.
    """
    fautes = []
    for rang, corps in sorted(_corps().items()):
        for cls, x1, y1, x2, y2 in _segments(_arbre(corps)):
            if "x" not in cls.split():
                continue
            longueur = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
            if longueur > 22:
                fautes.append(f"{rang} : barre de blocage de {longueur:.0f}, 22 au plus")
            if abs(x1 - x2) > 0.5 and abs(y1 - y2) > 0.5:
                fautes.append(f"{rang} : barre de blocage en diagonale")
    assert not fautes, "barres de blocage :\n  " + "\n  ".join(fautes)


def test_lines_run_along_the_grid() -> None:
    """Une diagonale attire l'oeil : elle doit vouloir dire quelque chose.

    Tous les flux sont orthogonaux, sauf le seul rang dont le sujet EST le croisement.
    Sans cette règle, chaque figure invente son angle et le jeu perd sa grille.
    """
    fautes = []
    for rang, corps in sorted(_corps().items()):
        if rang in _DIAGONALES_PERMISES:
            continue
        for cls, x1, y1, x2, y2 in _segments(_arbre(corps)):
            if not ({"f", "a"} & set(cls.split())):
                continue
            if abs(x1 - x2) > 0.5 and abs(y1 - y2) > 0.5:
                fautes.append(
                    f"{rang} : segment « {cls} » en diagonale, "
                    f"({x1:.0f},{y1:.0f}) vers ({x2:.0f},{y2:.0f})"
                )
    assert not fautes, (
        "diagonales hors du rang qui les justifie :\n  " + "\n  ".join(fautes) + "\n\n"
        "  fix : un tracé orthogonal (montée, traverse, descente) dit la même chose "
        "et garde la grille du jeu."
    )
