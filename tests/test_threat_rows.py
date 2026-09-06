"""`L3` — la carte servie au front, dans l'unité **ligne**.

Le premier test de ce fichier est le seul qui compte vraiment, et il ne teste pas du
code : il fige un **écart entre deux nombres vrais**.

`coverage/map.json` publie 25 facettes pour 16 lignes de menace. Sur le profil `P1a`,
3 facettes sont bloquées et 2 lignes le sont. Les six relecteurs du chantier front ont
trouvé cette confusion **indépendamment**, dans les trois directions proposées : toutes
écrivaient « 3 lignes bloquées » en lisant la colonne des facettes. Une page qui se
vend comme « générée depuis la carte » et qui se trompe d'unité perd la réunion sur ce
seul point.

Le reste du fichier tient les propriétés qui rendent cet écart impossible à réintroduire
ailleurs : une seule implémentation du regroupement, un artefact qui ne peut pas dériver
de la carte, et une route qui refuse de répondre plutôt que de répondre vide.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from core.profiles import Profile
from core.threat_map import MapUnavailable, published_rows
from core.triage import diagnose

_RACINE = Path(__file__).resolve().parent.parent
_CARTE = _RACINE / "coverage" / "map.json"
_ARTEFACT = _RACINE / "frontend" / "lib" / "generated" / "threat-rows.json"
_GENERATEUR = _RACINE / "scripts" / "gen_threat_rows.py"


# --- L'erreur d'unité, figée ---------------------------------------------------


def test_a_row_is_not_a_facet_and_p1a_is_where_it_shows() -> None:
    """Sur `P1a` : 2 lignes bloquées, 3 facettes bloquées. Le chiffre publiable est 2.

    Les deux comptes sont dérivés ici, aucun n'est écrit en dur : si la carte change,
    le test suit. Ce qu'il fige, c'est qu'ils sont **différents** — le jour où ils
    coïncideraient par hasard, le garde ne prouverait plus rien et le dit.
    """
    rapport = diagnose(_CARTE, frozenset({Profile.p1a}))

    lignes_bloquees = len(rapport.blocked)
    facettes_bloquees = sum(1 for ligne in rapport.applicable for _, m in ligne.facets if m == "B")

    assert lignes_bloquees == 2, (
        f"le moteur dit {lignes_bloquees} lignes bloquées sur P1a. Si la carte a "
        "changé, c'est ce nombre-là qui va sur la page, pas le compte de facettes."
    )
    assert facettes_bloquees == 3
    assert lignes_bloquees != facettes_bloquees, (
        "lignes et facettes coïncident sur P1a : ce jeu de données ne distingue plus "
        "les deux unités, et ce garde ne prouve donc plus rien. Choisir un profil où "
        "elles divergent, sinon la confusion peut revenir sans qu'aucun test ne bouge."
    )


def test_the_statement_counts_lines_because_that_is_the_word_it_uses() -> None:
    """L'énoncé dit « lignes ». Il doit donc compter des lignes."""
    rapport = diagnose(_CARTE, frozenset({Profile.p1a}))
    enonce = rapport.statement()

    assert f"Sur les {len(rapport.lines)} lignes" in enonce
    assert f"nous en bloquons {len(rapport.blocked)} nativement" in enonce
    # Le compte de facettes ne doit apparaître nulle part dans une phrase qui dit
    # « ligne » : c'est exactement la substitution qu'on ferme.
    assert "bloquons 3 nativement" not in enonce


# --- Une seule implémentation du regroupement ----------------------------------


def test_triage_and_the_front_artefact_group_rows_the_same_way() -> None:
    """Le moteur et l'artefact voient les mêmes lignes, parce qu'ils partagent le code.

    `core.triage` regroupait autrefois les facettes lui-même. Le front en aurait fait
    une seconde version en TypeScript ; ce test tomberait le jour où l'une des deux
    dériverait — mais surtout, il n'y en a plus qu'une à faire dériver.
    """
    du_moteur = {ligne.id: ligne.titre for ligne in published_rows(_CARTE)}
    publie = json.loads(_ARTEFACT.read_text(encoding="utf-8"))
    de_lartefact = {ligne["id"]: ligne["titre"] for ligne in publie["lignes"]}

    assert de_lartefact == du_moteur
    assert len(du_moteur) == 16


def test_the_replayable_rows_are_derived_from_the_map_not_listed() -> None:
    """Les 8 lignes rejouables tombent de la carte, aucune liste n'est tenue à jour.

    `gen_coverage.py` n'accorde `Bloqué` qu'à une facette portant ses deux moitiés :
    un scénario qui bloque **et** un scénario qui laisse passer un appel légitime.
    C'est précisément ce qu'il faut pour filmer une séquence — un blocage sans son
    contrôle négatif est un écran où rien ne se passe, qu'un plantage produirait à
    l'identique.
    """
    lignes = published_rows(_CARTE)
    rejouables = [ligne.id for ligne in lignes if ligne.rejouable]
    depuis_les_facettes = [
        ligne.id for ligne in lignes if any(f.mode == "B" for f in ligne.facettes)
    ]

    assert rejouables == depuis_les_facettes
    assert len(rejouables) == 8, (
        f"{len(rejouables)} lignes rejouables. Le chantier front en annonce 8 ; si la "
        "carte en publie un autre nombre, c'est le plan qu'il faut corriger, pas ce test."
    )


def test_a_row_carries_every_facet_of_its_threat() -> None:
    """Aucune facette ne se perd au regroupement, et aucune ne se duplique."""
    facettes_carte = json.loads(_CARTE.read_text(encoding="utf-8"))["facettes"]
    regroupees = [f for ligne in published_rows(_CARTE) for f in ligne.facettes]

    assert len(regroupees) == len(facettes_carte) == 25
    cles = {(ligne.id, f.cle) for ligne in published_rows(_CARTE) for f in ligne.facettes}
    assert len(cles) == len(regroupees), "deux facettes partagent une clé dans une ligne"


def test_published_rows_fails_closed_without_a_map(tmp_path: Path) -> None:
    """Sans carte, on lève. Une liste vide se lirait « aucune menace »."""
    with pytest.raises(MapUnavailable):
        published_rows(tmp_path / "absente.json")


def test_published_rows_fails_closed_on_an_unreadable_map(tmp_path: Path) -> None:
    """Une carte illisible est traitée comme une carte absente, pas comme une carte vide."""
    cassee = tmp_path / "map.json"
    cassee.write_text("{ ceci n'est pas du json", encoding="utf-8")
    with pytest.raises(MapUnavailable):
        published_rows(cassee)


# --- L'artefact ne peut pas dériver de la carte --------------------------------


def test_the_committed_artefact_matches_the_published_map() -> None:
    """Le gate CI, rejoué ici : un artefact périmé montre à un prospect ce qui n'est plus vrai."""
    rendu = subprocess.run(
        [sys.executable, str(_GENERATEUR), "--check"],
        capture_output=True,
        text=True,
        cwd=_RACINE,
    )
    assert rendu.returncode == 0, rendu.stderr


def test_the_check_gate_goes_red_when_the_artefact_drifts(tmp_path: Path) -> None:
    """Le garde mord : on abîme l'artefact, `--check` doit refuser.

    Vérifié en écrivant vraiment le fichier puis en le restaurant, plutôt qu'en
    supposant que le gate fonctionne — un gate qu'on n'a jamais vu rouge est un gate
    dont on ne sait rien.
    """
    original = _ARTEFACT.read_text(encoding="utf-8")
    abime = json.loads(original)
    abime["lignes"][0]["titre"] = "Un titre que la carte ne publie pas"
    try:
        _ARTEFACT.write_text(json.dumps(abime, indent=2, ensure_ascii=False) + "\n", "utf-8")
        rendu = subprocess.run(
            [sys.executable, str(_GENERATEUR), "--check"],
            capture_output=True,
            text=True,
            cwd=_RACINE,
        )
        assert rendu.returncode == 1
        assert "périmé" in rendu.stderr
    finally:
        _ARTEFACT.write_text(original, encoding="utf-8")


def test_the_artefact_names_the_map_it_came_from() -> None:
    """Un artefact généré qui ne dit pas d'où il vient ne peut pas être confronté."""
    publie = json.loads(_ARTEFACT.read_text(encoding="utf-8"))
    carte = json.loads(_CARTE.read_text(encoding="utf-8"))
    assert publie["commit"] == carte["commit"]
    assert publie["genere_le"] == carte["genere_le"]


def test_the_artefact_carries_nothing_that_depends_on_a_visitor() -> None:
    """Pas d'applicabilité, pas de plafond, pas de propriétaire dans le fichier statique.

    Ce sont les trois notions qui dépendent du client. Les figer dans un artefact en
    ferait un second moteur endormi, qui répondrait juste jusqu'au jour où le premier
    changerait.
    """
    texte = _ARTEFACT.read_text(encoding="utf-8")
    interdits = ["applicable", "owner", "plafond", "cap", "statement", "blocked"]
    presents = [mot for mot in interdits if f'"{mot}"' in texte]
    assert not presents, f"l'artefact statique porte du profil-dépendant : {presents}"
