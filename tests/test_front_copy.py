"""La copie du front ne reprend pas les tics d'une page générée, et n'affirme pas de chiffre.

Deux gardes, deux raisons différentes.

**Le tiret cadratin.** Julian l'a demandé sur le titre — « ça fait très IA » — et il avait
raison au-delà du titre : le dictionnaire en portait **106**, dans les deux langues. Le
tiret d'apposition à répétition est l'une des signatures les plus reconnaissables d'un
texte généré, et le système de design du site mère fait déjà ce constat pour son propre
compte : `assets/css/base.css` y neutralise l'italique serif cuivre sur les mots-clés en
écrivant la raison noir sur blanc — *la composition la plus reconnaissable des pages
générées automatiquement*. Une correction ponctuelle se serait défaite au premier ajout ;
ce test la tient.

Le français a le point, le deux-points et la virgule pour ce que le tiret portait, et
chacun dit quelque chose de différent : le deux-points annonce, le point sépare, la
virgule lie. Choisir lequel est un acte de rédaction. C'est précisément ce que le tiret
permet d'éviter, et pourquoi il prolifère.

**Le chiffre non adossé.** La page portait quatre statistiques écrites à la main, dont un
« < 1 s » que `perf/overhead.json` refuse explicitement de publier — la faute que `CM-7`,
l'audit de souveraineté et le registre de surcoût existent pour empêcher, transposée sur
la surface marketing où rien ne la gardait. Le garde ci-dessous est volontairement étroit :
il n'interdit pas les chiffres, il interdit ceux qui affirment une **latence**, parce que
c'est la famille que le dépôt a nommément renoncé à publier. Le garde complet, qui
confronte chaque revendication à la carte générée, vit dans le lot `L4`.
"""

from __future__ import annotations

import re
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
_I18N = _RACINE / "frontend" / "lib" / "i18n.tsx"


def _chaines() -> list[tuple[str, str]]:
    """Les chaînes traduites du dictionnaire, avec leur langue."""
    texte = _I18N.read_text(encoding="utf-8")
    return [(m.group(1), m.group(2)) for m in re.finditer(r'\b(en|fr): "((?:[^"\\]|\\.)*)"', texte)]


def test_no_em_dash_survives_in_the_dictionary() -> None:
    """Le tic, tenu à zéro dans les deux langues."""
    fautives = [(lang, t) for lang, t in _chaines() if "—" in t]
    assert not fautives, (
        "tiret cadratin dans la copie du front — le point, le deux-points ou la virgule "
        f"disent mieux ce qu'il portait :\n"
        + "\n".join(f"  [{lang}] {t[:100]}" for lang, t in fautives[:10])
    )


def test_the_guard_reads_a_dictionary_that_is_really_there() -> None:
    """Contrôle de non-vacuité : un garde qui ne lit rien passe toujours.

    Sans lui, un renommage de fichier ou un changement de forme du dictionnaire
    rendrait le test ci-dessus vert sur zéro chaîne.
    """
    chaines = _chaines()
    assert len(chaines) > 200, f"dictionnaire introuvable ou trop court ({len(chaines)} chaînes)"
    assert any(lang == "fr" for lang, _ in chaines)
    assert any(lang == "en" for lang, _ in chaines)


def test_no_latency_claim_is_published_in_the_copy() -> None:
    """`perf/overhead.json` refuse de publier une latence. La page aussi.

    Le registre de surcoût publie des entiers — connexions et allers-retours SQL — et
    dit pourquoi il ne publie pas de milliseconde : le cluster de mesure tourne
    `fsync=off` et un exécuteur partagé n'a pas de p95 reproductible. Une page qui
    afficherait « < 1 s » contredirait l'artefact que le produit génère.
    """
    motif = re.compile(r"<\s*\d+\s*(ms|s\b)|\b\d+\s*ms\b|millisecond|milliseconde", re.IGNORECASE)
    fautives = [(lang, t) for lang, t in _chaines() if motif.search(t)]
    assert not fautives, (
        "la copie affirme une latence, que `perf/overhead.json` refuse de publier :\n"
        + "\n".join(f"  [{lang}] {t[:100]}" for lang, t in fautives[:10])
    )
