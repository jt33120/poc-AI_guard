"""`L6` — le rejeu : deux traces réelles, le même appel, une seule différence.

`AD-26` : une vidéo est l'enregistrement d'une exécution qui passe, jamais un
substitut. Ce fichier tient les propriétés qui font que le rejeu publié reste un
enregistrement, et pas une reconstitution qui aurait glissé vers l'illustration.

**Ce que ce fichier ne fait pas, et pourquoi.** Il n'appelle pas
`gen_replays.py --check`. Le générateur lit `coverage/.sequences.json`, que
`pytest_sessionfinish` écrit **après** le dernier test : un test qui l'invoquerait
lirait la capture de l'exécution *précédente* et jugerait donc autre chose que ce qui
vient de tourner. Le gate a sa place en CI, après pytest, comme `gen_coverage.py`.
Ici on confronte l'artefact committé à la carte committée, et on éprouve les fonctions
pures du générateur sur des cas construits.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from core.threat_map import published_rows

_RACINE = Path(__file__).resolve().parent.parent
_CARTE = _RACINE / "coverage" / "map.json"
_REJEUX = _RACINE / "frontend" / "lib" / "generated" / "replays.json"

sys.path.insert(0, str(_RACINE / "scripts"))
from gen_replays import _SANS_REJEU, _divergence, _outils  # noqa: E402


def _publies() -> dict[str, Any]:
    return json.loads(_REJEUX.read_text(encoding="utf-8"))


# --- L'artefact publié ---------------------------------------------------------


def test_every_replayable_row_either_has_a_sequence_or_a_published_reason() -> None:
    """Aucune rangée ne s'ouvre sur du vide : une séquence, ou la raison de son absence.

    L'invariant a été corrigé en cours de lot, et la correction est le résultat le plus
    utile de `L6`. La première version exigeait un rejeu pour les huit lignes ; `M-14`
    en a produit un dont les **deux colonnes étaient identiques**, ce qui n'est pas une
    démonstration mais deux copies de la même trace. Exiger huit rejeux poussait donc à
    en publier un qui ne montre rien — précisément l'écran où rien ne se passe que ce
    lot existe pour éviter.
    """
    publie = _publies()
    attendues = {ligne.id for ligne in published_rows(_CARTE) if ligne.rejouable}
    couvertes = set(publie["rejeux"]) | set(publie["sans_rejeu"])
    assert couvertes == attendues, f"non traitées : {sorted(attendues - couvertes)}"
    assert len(attendues) == 8
    # Et les deux ensembles sont disjoints : une ligne ne peut pas avoir un rejeu *et*
    # une raison de ne pas en avoir, sinon la raison s'afficherait à côté d'une séquence.
    assert not (set(publie["rejeux"]) & set(publie["sans_rejeu"]))


def test_a_row_without_a_replay_says_why_rather_than_going_quiet() -> None:
    """`FR-144`, transposé : ce qui n'est pas montré est publié **avec sa raison**.

    `M-14` est le cas de fond, et ce n'est pas un manque : sa preuve est qu'un argument
    secret n'atteint jamais le journal. Les deux exécutions décident donc légitimement
    `allow`, et ce qui les sépare est ce qui a été relayé — que `audit_log` ne consigne
    pas, puisque ne rien consigner du contenu est exactement la propriété démontrée.
    """
    publie = _publies()
    for row_id, raison in publie["sans_rejeu"].items():
        assert row_id in _SANS_REJEU, f"{row_id} publiée sans être déclarée"
        assert len(raison) > 80, f"{row_id} : raison trop courte pour expliquer quoi que ce soit"
    assert "M-14" in publie["sans_rejeu"]


def test_both_columns_exercise_the_same_tools() -> None:
    """« Le même appel joué deux fois » doit être vrai, pas seulement plausible.

    Sans cette contrainte, deux exécutions différentes s'afficheraient côte à côte sous
    ce titre, et le lecteur n'aurait aucun moyen de s'en apercevoir : les deux colonnes
    seraient également crédibles.
    """
    for row_id, rejeu in _publies()["rejeux"].items():
        sans = _outils(rejeu["sans_garde"]["entrees"])
        avec = _outils(rejeu["avec_garde"]["entrees"])
        assert sans == avec, f"{row_id} : {sans} contre {avec}"
        assert sans == tuple(rejeu["outils"])
        assert sans, f"{row_id} : aucun outil appelé, il n'y a rien à montrer"


def test_the_two_columns_actually_diverge() -> None:
    """Un rejeu où les deux colonnes coïncident ne prouve rien du tout.

    C'est le cœur : si le garde ne change pas l'issue, il n'y a pas de démonstration,
    il y a deux copies de la même trace.
    """
    for row_id, rejeu in _publies()["rejeux"].items():
        sans = rejeu["sans_garde"]["entrees"]
        avec = rejeu["avec_garde"]["entrees"]
        assert sans != avec, f"{row_id} : les deux colonnes sont identiques"
        rang = rejeu["divergence"]
        assert rang is not None, f"{row_id} : divergence non située"
        # Avant le point de divergence, les deux exécutions sont bien la même.
        for i in range(rang):
            assert (sans[i]["tool_name"], sans[i]["decision"]) == (
                avec[i]["tool_name"],
                avec[i]["decision"],
            ), f"{row_id} : divergence annoncée au rang {rang}, mais déjà différente au {i}"


def test_the_guarded_column_is_the_one_that_refuses() -> None:
    """La colonne « garde en place » doit finir autrement que celle sans garde.

    Le sens de lecture compte : si la trace sans garde se terminait par un refus, la
    page raconterait l'inverse de ce qu'elle prétend montrer.
    """
    for row_id, rejeu in _publies()["rejeux"].items():
        sans_fin = rejeu["sans_garde"]["entrees"][-1]["decision"]
        avec_fin = rejeu["avec_garde"]["entrees"][-1]["decision"]
        assert sans_fin != avec_fin, f"{row_id} : même décision finale des deux côtés"


def test_both_chains_were_verified_at_capture() -> None:
    """« Chaîne vérifiée » est une propriété confrontée, pas une phrase.

    `core.audit.verify_chain` a recalculé chaque charge pendant la capture. Publier la
    mention sans l'avoir fait vérifier serait la revendication non appuyée que ce dépôt
    refuse partout ailleurs.
    """
    for row_id, rejeu in _publies()["rejeux"].items():
        assert rejeu["sans_garde"]["chainee"], f"{row_id} : chaîne sans garde non vérifiée"
        assert rejeu["avec_garde"]["chainee"], f"{row_id} : chaîne avec garde non vérifiée"


def test_the_artefact_publishes_no_latency_and_no_identity() -> None:
    """Trois familles de champs n'ont rien à faire sur une page publique.

    `latency_ms` parce que `perf/overhead.json` refuse explicitement de publier une
    latence ; `tenant_id` et `user_id` parce qu'ils n'apprennent rien à un lecteur ;
    `entry_hash` et `prev_hash` parce qu'ils changent à chaque exécution — `payload_v1`
    hache l'horodatage et l'identifiant de requête — et qu'une empreinte que personne ne
    peut recalculer n'est qu'une décoration.
    """
    texte = _REJEUX.read_text(encoding="utf-8")
    for interdit in ("latency_ms", "tenant_id", "user_id", "entry_hash", "prev_hash", '"ts"'):
        assert interdit not in texte, f"l'artefact publie {interdit}"


def test_the_artefact_names_the_map_it_is_contemporary_with() -> None:
    publies = _publies()
    carte = json.loads(_CARTE.read_text(encoding="utf-8"))
    assert publies["commit"] == carte["commit"]


def test_each_replay_names_the_tests_it_recorded() -> None:
    """Un rejeu anonyme n'est pas vérifiable ; nommé, il se relance."""
    for row_id, rejeu in _publies()["rejeux"].items():
        for cote in ("sans_garde", "avec_garde"):
            test = rejeu[cote]["test"]
            assert test.startswith("tests/"), f"{row_id}/{cote} : {test!r}"
            assert "::" in test, f"{row_id}/{cote} : identifiant de test incomplet"


# --- Les fonctions pures du générateur -----------------------------------------


def test_tool_extraction_ignores_guard_verdicts() -> None:
    """Une décision de garde n'est pas un appel d'outil.

    `taint_marked` et sa famille décrivent un verdict, pas une invocation. Les compter
    ferait échouer l'appariement précisément sur les lignes où le garde a le plus à
    montrer — celles où il intervient entre deux appels.
    """
    entrees = [
        {"tool_name": "mock.fetch", "decision": "allow"},
        {"tool_name": None, "decision": "taint_marked"},
        {"tool_name": "mock.send", "decision": "tainted_action"},
    ]
    assert _outils(entrees) == ("mock.fetch", "mock.send")


def test_tool_extraction_collapses_consecutive_repeats() -> None:
    """Le même outil journalisé deux fois de suite reste un appel dans la lecture."""
    entrees = [
        {"tool_name": "mock.echo", "decision": "allow"},
        {"tool_name": "mock.echo", "decision": "tool_drift"},
    ]
    assert _outils(entrees) == ("mock.echo",)


def test_divergence_is_the_first_real_difference() -> None:
    a = [{"tool_name": "t", "decision": "allow"}, {"tool_name": "u", "decision": "allow"}]
    b = [{"tool_name": "t", "decision": "allow"}, {"tool_name": "u", "decision": "deny"}]
    assert _divergence(a, b) == 1


def test_divergence_marks_a_column_that_simply_stops() -> None:
    """Une colonne plus courte diverge là où l'autre continue.

    C'est le cas le plus fréquent : sans garde l'action passe et la trace s'arrête ;
    avec garde, le refus ajoute une entrée. Renvoyer `None` ici afficherait deux
    colonnes sans point de rupture, alors que la rupture **est** le propos.
    """
    a = [{"tool_name": "t", "decision": "allow"}]
    b = [{"tool_name": "t", "decision": "allow"}, {"tool_name": "t", "decision": "deny"}]
    assert _divergence(a, b) == 1


def test_identical_sequences_have_no_divergence() -> None:
    a = [{"tool_name": "t", "decision": "allow"}]
    assert _divergence(a, list(a)) is None
