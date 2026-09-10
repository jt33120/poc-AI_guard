"""`L4` — le gate marketing : la page ne peut pas affirmer plus que la carte.

Même famille que `CM-7` et `FR-175`, une surface plus loin, et la plus exposée. Ce
fichier tient trois choses, et la troisième est celle qui compte le plus longtemps.

**Que le gate passe** sur la copie du dépôt. Trivial aujourd'hui, et c'est voulu : `L0`
a retiré les quatre chiffres écrits à la main de la page en ligne, dont un « < 1 s » que
`perf/overhead.json` refuse explicitement de publier. Le gate est écrit **avant** la
page, sur une surface propre. Écrit après, il aurait été taillé pour laisser passer ce
qui était déjà là.

**Qu'il morde**, sur les cinq façons de contourner qu'un rédacteur essaie vraiment : le
chiffre nu, le chiffre en toutes lettres, le chiffre dans le balisage plutôt que dans le
dictionnaire, le verbe attribué à une ligne non bloquée, et le placeholder mal
orthographié qui laisse ses accolades sur la page.

**Qu'il ne morde pas trop.** La première version refusait « une liste de menaces IA » :
`une` est un article avant d'être un nombre. Dix faux positifs sur dix, et un gate à ce
taux-là est débranché dans la semaine. Le test de non-régression est donc aussi
important que ceux qui vérifient qu'il attrape.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from core.profiles import Profile
from core.threat_map import published_rows
from core.triage import diagnose

_RACINE = Path(__file__).resolve().parent.parent
_GATE = _RACINE / "scripts" / "gen_marketing.py"
_COPIE = _RACINE / "frontend" / "lib" / "strings.ts"
_PAGE = _RACINE / "frontend" / "app" / "evidence" / "page.tsx"
_FAITS = _RACINE / "frontend" / "lib" / "generated" / "marketing-facts.json"
_CARTE = _RACINE / "coverage" / "map.json"


def _gate() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_GATE), "--check"],
        capture_output=True,
        text=True,
        cwd=_RACINE,
    )


@pytest.fixture
def copie_restauree() -> Iterator[Path]:
    """Rendre le dictionnaire tel qu'il était, quoi qu'il arrive au test."""
    original = _COPIE.read_text(encoding="utf-8")
    try:
        yield _COPIE
    finally:
        _COPIE.write_text(original, encoding="utf-8")


def _inserer(chemin: Path, ancre: str, texte: str) -> None:
    contenu = chemin.read_text(encoding="utf-8")
    assert ancre in contenu, f"ancre introuvable dans {chemin.name}"
    chemin.write_text(contenu.replace(ancre, texte + ancre, 1), encoding="utf-8")


# --- Le gate passe, et ses faits sont ceux du moteur ---------------------------


def test_the_shipped_copy_claims_nothing_the_map_does_not_prove() -> None:
    rendu = _gate()
    assert rendu.returncode == 0, rendu.stderr


def test_every_published_fact_is_derived_from_the_engine() -> None:
    """Aucun fait n'est écrit : chacun est recalculé ici, par un autre chemin."""
    publies = json.loads(_FAITS.read_text(encoding="utf-8"))["faits"]
    lignes = published_rows(_CARTE)
    plein = diagnose(_CARTE, frozenset(Profile))

    assert publies["lignes"] == len(lignes) == 16
    assert publies["facettes"] == sum(len(ligne.facettes) for ligne in lignes) == 25
    assert publies["rejouables"] == sum(1 for ligne in lignes if ligne.rejouable) == 8
    assert publies["profils"] == len(Profile) == 6
    assert publies["bloquees_max"] == len(plein.blocked)
    assert publies["notre_terrain_max"] == len(plein.ours)


def test_the_facts_name_the_map_they_came_from() -> None:
    publies = json.loads(_FAITS.read_text(encoding="utf-8"))
    carte = json.loads(_CARTE.read_text(encoding="utf-8"))
    assert publies["commit"] == carte["commit"]


def test_a_row_count_and_a_facet_count_are_published_as_different_facts() -> None:
    """L'erreur d'unité du §1.3, fermée à la source des chiffres eux-mêmes.

    16 lignes pour 25 facettes : deux faits distincts, deux noms distincts. Une page
    qui veut « le nombre de menaces » ne peut pas attraper celui des facettes par
    inadvertance, il ne porte pas le même nom.
    """
    publies = json.loads(_FAITS.read_text(encoding="utf-8"))["faits"]
    assert publies["lignes"] != publies["facettes"]


# --- Le gate mord : les cinq contournements ------------------------------------


def test_a_bare_number_in_a_coverage_sentence_is_refused(copie_restauree: Path) -> None:
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "We block 8 of 16 threat rows.", '
        'fr: "Nous bloquons 8 des 16 lignes de menace." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "« 8 » écrit dans une phrase de couverture" in rendu.stderr


def test_a_number_spelled_out_is_refused_too(copie_restauree: Path) -> None:
    """La première reformulation que quiconque essaie devant un gate à chiffres."""
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "Eight threat rows out of sixteen.", '
        'fr: "Huit lignes de menace sur seize." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "« Huit »" in rendu.stderr
    assert "« seize »" in rendu.stderr


def test_the_blocking_verb_on_an_unblocked_row_is_refused(copie_restauree: Path) -> None:
    """`FR-175`, étendu à la copie : la même règle sur les deux surfaces."""
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "We block M-13 for you.", fr: "Nous bloquons M-13 pour vous." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "attribué à M-13" in rendu.stderr
    # Et pas de bruit : le `13` de `M-13` n'est pas signalé comme un compte.
    assert "« 13 » écrit" not in rendu.stderr


def test_an_unknown_placeholder_is_refused(copie_restauree: Path) -> None:
    """Un nom mal orthographié n'échoue pas à l'exécution : il s'affiche entre accolades."""
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "{lignes_bloquees} rows.", fr: "{lignes_bloquees} lignes." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "placeholder inconnu" in rendu.stderr


def test_a_number_written_into_the_markup_is_refused() -> None:
    """Le contournement le plus simple d'un garde qui ne lirait que la copie traduite."""
    original = _PAGE.read_text(encoding="utf-8")
    try:
        _PAGE.write_text(
            original.replace(
                '<main className="relative">',
                '<main className="relative">\n      <p>16 lignes de menace, 8 bloquées</p>',
                1,
            ),
            encoding="utf-8",
        )
        rendu = _gate()
        assert rendu.returncode == 1
        assert "chiffre de couverture écrit dans le balisage" in rendu.stderr
    finally:
        _PAGE.write_text(original, encoding="utf-8")


def test_a_stale_facts_artefact_is_refused() -> None:
    original = _FAITS.read_text(encoding="utf-8")
    try:
        abime = json.loads(original)
        abime["faits"]["lignes"] = 99
        _FAITS.write_text(json.dumps(abime, indent=2, ensure_ascii=False) + "\n", "utf-8")
        rendu = _gate()
        assert rendu.returncode == 1
        assert "périmé" in rendu.stderr
    finally:
        _FAITS.write_text(original, encoding="utf-8")


# --- Le gate ne mord pas trop --------------------------------------------------


def test_the_french_indefinite_article_is_not_read_as_a_number(
    copie_restauree: Path,
) -> None:
    """La non-régression qui rend ce gate utilisable.

    Sa première version refusait « une liste de menaces IA » et « un contrôle des
    opérations réelles » : en français, `un` et `une` sont d'abord des articles. Dix
    faux positifs sur dix. Un gate à ce taux-là est débranché dans la semaine, et un
    gate débranché ne protège rien du tout.
    """
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "A gate on real actions, one call at a time.", '
        'fr: "Un contrôle sur les actions réelles, une liste de menaces qui vous '
        'concernent." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 0, rendu.stderr


def test_an_interpolated_number_is_exactly_the_accepted_form(copie_restauree: Path) -> None:
    """Ce que le gate demande doit passer, sinon il ne demande rien de faisable."""
    _inserer(
        copie_restauree,
        '  "meta.tagline": {',
        '  "sabotage": { en: "{lignes} threat rows, {rejouables} of them replayable.", '
        'fr: "{lignes} lignes de menace, dont {rejouables} rejouables." },\n',
    )
    rendu = _gate()
    assert rendu.returncode == 0, rendu.stderr


def test_the_guard_reads_a_copy_that_is_really_there() -> None:
    """Non-vacuité : un gate qui ne lit rien passe toujours.

    Le même contrôle que `tests/test_front_copy.py`, et pour la même raison — celui-là
    est passé au rouge quand `L2` a déplacé le dictionnaire, ce qui est exactement à
    quoi il sert.
    """
    rendu = _gate()
    assert "lignes=16" in rendu.stdout, rendu.stdout
    assert "facettes=25" in rendu.stdout
    # Le compte des emplois génériques prouve que la copie a bien été parcourue.
    assert "emplois génériques" in rendu.stdout
    generiques = int(rendu.stdout.split("emplois génériques")[0].strip().split()[-1])
    assert generiques > 10, f"seulement {generiques} phrases parcourues : copie introuvable ?"


# --- Le gate ne lit plus les commentaires, et voit toujours le balisage ---------
#
# Ce bloc existe parce que le gate a refusé un fichier pour un nombre qui n'était pas
# sur la page : `_TEXTE_JSX` prend tout ce qui sépare un `>` d'un `<`, et un
# commentaire d'architecture cite forcément du balisage, si bien qu'un `>` de
# commentaire trouvait son `<` plusieurs paragraphes plus loin. Punir les commentaires
# ne protège personne et pousse à en écrire moins.
#
# Élargir un gate est plus risqué que le durcir : le durcissement échoue bruyamment,
# l'élargissement se trompe en silence. Les trois tests qui suivent le premier sont
# donc les vrais : ils vérifient que le filtre n'a rendu le gate aveugle à rien.


@pytest.fixture
def page_restauree() -> Iterator[Path]:
    """Rendre la page telle qu'elle était, quoi qu'il arrive au test."""
    original = _PAGE.read_text(encoding="utf-8")
    try:
        yield _PAGE
    finally:
        _PAGE.write_text(original, encoding="utf-8")


def test_a_number_in_a_comment_is_not_read_as_markup(page_restauree: Path) -> None:
    """Un commentaire n'est pas de la copie : le visiteur ne le lit jamais."""
    _inserer(
        page_restauree,
        '<main className="relative">',
        "{/* Seize lignes de menace : le relevé les publie via <ThreatLedger />. */}\n      ",
    )
    rendu = _gate()
    assert rendu.returncode == 0, (
        "le gate refuse un nombre écrit dans un commentaire :\n" + rendu.stderr
    )


def test_a_number_in_markup_beside_a_comment_is_still_refused(page_restauree: Path) -> None:
    """Le contrôle qui compte : le filtre n'a pas emporté le balisage avec lui.

    Un retrait de commentaires trop gourmand blanchirait la ligne suivante, et le gate
    cesserait de voir ce qu'il existe pour voir — sans que rien ne le signale.
    """
    _inserer(
        page_restauree,
        '<main className="relative">',
        "{/* Un commentaire qui cite <ThreatLedger /> et parle de menaces. */}\n"
        "      <p>16 lignes de menace, 8 bloquées</p>\n      ",
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "chiffre de couverture écrit dans le balisage" in rendu.stderr


def test_a_double_slash_inside_a_string_opens_no_comment(page_restauree: Path) -> None:
    """`https://…` n'ouvre pas un commentaire de ligne.

    Sans cette distinction, la moitié d'une ligne portant une URL disparaîtrait de
    l'analyse, et le chiffre qui la suit avec elle.
    """
    _inserer(
        page_restauree,
        '<main className="relative">',
        '<a href="https://exemple.test/a">16 lignes de menace</a>\n      ',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "chiffre de couverture écrit dans le balisage" in rendu.stderr


def test_a_regex_literal_does_not_swallow_the_rest_of_its_line(page_restauree: Path) -> None:
    r"""Le cas réel qui a dicté la forme du filtre.

    `replace(/^https?:\/\//, "")` figure dans deux composants analysés. Un scanner qui
    lirait son `//` final comme un commentaire blanchirait la fin de la ligne, et le
    gate y perdrait la vue. Le littéral est donc consommé d'un bloc, et le chiffre
    placé APRÈS lui, sur la même ligne, doit rester visible.
    """
    _inserer(
        page_restauree,
        '<main className="relative">',
        '<span>{"x".replace(/^https?:\\/\\//, "")}</span><p>16 lignes de menace</p>\n      ',
    )
    rendu = _gate()
    assert rendu.returncode == 1
    assert "chiffre de couverture écrit dans le balisage" in rendu.stderr


def test_a_file_opening_on_a_jsdoc_block_is_still_scanned(page_restauree: Path) -> None:
    """Non-régression sur un défaut de la première version du filtre.

    Un `/**` en tête de fichier n'a aucun caractère avant lui. L'heuristique qui
    distingue une regex d'une division lisait donc cette absence comme « on peut ouvrir
    une regex ici », et consommait l'en-tête jusqu'au premier `/` venu — celui d'un
    `<X />` cité dans la prose. Le reste du commentaire repassait dans l'analyse, et le
    balisage suivant en sortait.

    La règle est plus simple que l'heuristique : un `/` suivi de `*` ou de `/` est
    toujours un commentaire. `//` est le commentaire de ligne de JavaScript, et `/*`
    n'est pas une expression régulière valide.
    """
    _inserer(
        page_restauree,
        '<main className="relative">',
        "{/**\n       * Un en-tête qui cite <ThreatLedger /> et parle de menaces.\n       */}\n"
        "      <p>16 lignes de menace</p>\n      ",
    )
    rendu = _gate()
    assert rendu.returncode == 1, (
        "le filtre a emporté le balisage qui suivait un bloc de commentaire :\n" + rendu.stderr
    )
    assert "chiffre de couverture écrit dans le balisage" in rendu.stderr
