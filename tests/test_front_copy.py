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

import json
import re
from pathlib import Path

_RACINE = Path(__file__).resolve().parent.parent
# `L2` a sorti le dictionnaire de `i18n.tsx` : tant qu'il y vivait, toute page
# affichant un mot devenait un composant client, donc incapable d'exporter
# `metadata`. Le contrôle de non-vacuité ci-dessous a signalé le déplacement en
# passant au rouge, ce qui est précisément la raison pour laquelle il existe.
_I18N = _RACINE / "frontend" / "lib" / "strings.ts"

#: La copie visible ne vit plus seulement dans le dictionnaire : `L6` publie des
#: phrases françaises **générées**, affichées telles quelles sur la page. La première
#: version de l'une d'elles portait du gras Markdown, des accents graves et un tiret
#: cadratin, et montrait les trois au lecteur — le garde ne la lisait pas.
_REJEUX = _RACINE / "frontend" / "lib" / "generated" / "replays.json"

#: La copie de l'accueil et de `/saas` ne passe PAS par le dictionnaire : elle vit
#: dans son propre module, structuré par sections plutôt que par clés plates, et le
#: garde ne la lisait pas. Elle portait six tirets cadratins — dont deux sur les
#: pages que lit un prospect — pendant que le contrôle rendait vert sur le seul
#: fichier qu'il connaissait. Un garde qui ne couvre qu'une des deux portes de la
#: copie visible n'en tient aucune.
_ACCUEIL = _RACINE / "frontend" / "components" / "guard-copy.ts"


def _chaines() -> list[tuple[str, str]]:
    """Toute la copie visible écrite à la main, avec sa provenance.

    Deux formes, parce que les deux fichiers ne sont pas construits pareil : le
    dictionnaire étiquette chaque chaîne par sa langue (`fr: "…"`), le module de
    l'accueil range la sienne sous deux blocs et n'étiquette rien. On lit donc les
    littéraux du second tels quels : tout ce qu'il contient est destiné à l'écran, à
    l'exception de l'adresse de contact, qui ne dit rien qu'un garde de style
    puisse trouver.
    """
    texte = _I18N.read_text(encoding="utf-8")
    chaines = [
        (m.group(1), m.group(2)) for m in re.finditer(r'\b(en|fr): "((?:[^"\\]|\\.)*)"', texte)
    ]
    accueil = _sans_commentaires(_ACCUEIL.read_text(encoding="utf-8"))
    chaines += [("accueil", m.group(1)) for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', accueil)]
    return chaines


def _sans_commentaires(source: str) -> str:
    """Le code seul. Un commentaire explique la règle, il ne s'y soumet pas.

    Les modules de ce dépôt documentent leurs choix en prose, tirets compris, et
    faire porter un garde de style rédactionnel sur cette prose reviendrait à
    interdire d'écrire *pourquoi* la règle existe.
    """
    sans_bloc = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"^\s*//.*$", "", sans_bloc, flags=re.MULTILINE)


def test_no_em_dash_survives_in_the_dictionary() -> None:
    """Le tic, tenu à zéro dans les deux langues."""
    fautives = [(lang, t) for lang, t in _chaines() if "—" in t]
    assert not fautives, (
        "tiret cadratin dans la copie du front — le point, le deux-points ou la virgule "
        "disent mieux ce qu'il portait :\n"
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


# --- La copie **générée**, visible elle aussi (`L6`) ----------------------------


def _phrases_generees() -> list[str]:
    """Les phrases que les artefacts générés affichent telles quelles."""
    if not _REJEUX.exists():
        return []
    publie = json.loads(_REJEUX.read_text(encoding="utf-8"))
    return list(publie.get("sans_rejeu", {}).values())


def test_generated_copy_carries_no_em_dash_either() -> None:
    """Le tic ne rentre pas non plus par la porte des artefacts.

    Le garde du dictionnaire ne voyait pas ces phrases, et la première raison publiée
    en portait un. Une règle qui ne couvre qu'une des deux portes de la copie ne tient
    aucune des deux bien longtemps.
    """
    fautives = [p for p in _phrases_generees() if "—" in p]
    assert not fautives, "tiret cadratin dans une phrase générée :\n" + "\n".join(fautives)


def test_generated_copy_is_not_markdown() -> None:
    """La page affiche ces phrases telles quelles : elle ne rend pas le Markdown.

    Du gras `**ainsi**` ou un accent grave y arrivent en clair sous les yeux du
    lecteur. Vérifié après l'avoir constaté à l'écran.
    """
    fautives = [p for p in _phrases_generees() if "**" in p or "`" in p]
    assert not fautives, "balisage Markdown dans une phrase générée :\n" + "\n".join(fautives)


def test_the_generated_copy_guard_reads_something() -> None:
    """Non-vacuité, comme pour le dictionnaire : un garde qui ne lit rien passe toujours."""
    phrases = _phrases_generees()
    assert phrases, "aucune phrase générée trouvée — l'artefact a-t-il changé de forme ?"
    assert all(len(p) > 80 for p in phrases)
