"""FR-172 — le diagnostic remis au client, et d'où viennent ses nombres.

La phrase que ce module produit — « sur les N lignes, M vous concernent, nous en
bloquons K » — ne vaut que par sa provenance. Ces tests tiennent les trois sources :
l'applicabilité vient du registre, le mode vient de la carte **publiée** (donc des
scénarios qui passent, jamais de la revendication brute), et le plafond de profil
s'applique après les deux.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.profiles import Profile, load_rows
from core.triage import MapUnavailable, diagnose, parse_profiles

_REGISTRY = Path(__file__).resolve().parents[1] / "coverage" / "rows.yaml"


def _map(tmp_path: Path, published: dict[str, str] | None = None) -> Path:
    """A `map.json` synthesised from the **real** registry, written to a temp file.

    Not the generated `coverage/map.json`: that artefact is derived (`AD-30`) and
    therefore gitignored, and CI runs pytest *before* generating it — so a test
    reading it would skip on a fresh checkout while passing locally. A skipped test
    on a client-facing claim is the defect, not the safety net.

    `published` overrides `mode_publie` per facet key, which is how the tests below
    separate "what the registry claims" from "what the map publishes".
    """
    rows = load_rows(_REGISTRY)
    facets = [
        {
            "menace": row.id,
            "titre": row.titre,
            "facette": facet.cle,
            "libelle": facet.libelle,
            "mode_revendique": facet.mode,
            "mode_publie": (published or {}).get(facet.cle, facet.mode),
            "famille": facet.family.value,
            "profils": sorted(p.value for p in facet.profiles),
        }
        for row in rows
        for facet in row.facets
    ]
    path = tmp_path / "map.json"
    path.write_text(json.dumps({"facettes": facets}, ensure_ascii=False), encoding="utf-8")
    return path


def test_parse_profiles_refuses_what_is_not_in_the_vocabulary() -> None:
    assert parse_profiles("P1a, P3") == frozenset({Profile.p1a, Profile.p3})
    with pytest.raises(ValueError, match="unknown profile"):
        parse_profiles("P1a,P9")
    with pytest.raises(ValueError, match="at least one"):
        parse_profiles("  ,  ")


def test_without_a_published_map_nothing_is_claimed(tmp_path: Path) -> None:
    """Fail closed: a client we can prove nothing to is not one we may promise
    everything to."""
    with pytest.raises(MapUnavailable, match="rien ne peut être annoncé"):
        diagnose(tmp_path / "nowhere.json", frozenset({Profile.p3}))


def test_the_numbers_in_the_statement_are_the_numbers_in_the_report(tmp_path: Path) -> None:
    """The sentence is computed, so it cannot drift from what backs it."""
    report = diagnose(_map(tmp_path), frozenset({Profile.p1a, Profile.p2, Profile.p3}))
    statement = report.statement()
    assert f"{len(report.lines)} lignes" in statement
    assert f"{len(report.applicable)} vous concernent" in statement
    assert f"bloquons {len(report.blocked)}" in statement
    assert len(report.applicable) + len(report.not_applicable) == len(report.lines)


def test_a_line_the_client_does_not_have_is_not_called_our_ground(tmp_path: Path) -> None:
    """ "Notre terrain" printed over a line they do not have answers nobody's question.

    What a prospect needs to hear about the switches of §2.3 is the condition: the
    poisoning line becomes theirs the day they stand up a vector database.
    """
    report = diagnose(_map(tmp_path), frozenset({Profile.p1a}))
    switches = {line.id: line.owner for line in report.not_applicable}
    assert "P2 (RAG interne)" in switches["M-03"]
    assert switches["M-03"].startswith("pas encore la vôtre")
    # A line that is genuinely someone else's stays named, not conditioned.
    assert switches["M-04"] == "l'éditeur du modèle"


def test_the_diagnostic_quotes_the_published_map_not_the_claim(tmp_path: Path) -> None:
    """A claim the suite has not proven must not reach a client through this door.

    `mode_publie` is what the generator allowed after confronting the registry with
    the scenarios; `mode_revendique` is what `rows.yaml` hopes. Reading the second
    would turn the diagnostic into the very overstatement CM-7 exists to stop.
    """
    doctored = json.loads(_map(tmp_path).read_text(encoding="utf-8"))
    for facet in doctored["facettes"]:
        facet["mode_revendique"] = "B"  # everything claims blocking...
        facet["mode_publie"] = "A"  # ...and nothing proved it
    path = tmp_path / "doctored.json"
    path.write_text(json.dumps(doctored), encoding="utf-8")

    report = diagnose(path, frozenset({Profile.p3}))
    assert report.blocked == ()
    assert "bloquons 0" in report.statement()


def test_a_copilot_only_client_is_never_told_we_block(tmp_path: Path) -> None:
    """FR-174 at the point it would actually be said out loud.

    Even against a map where every facet is proven `Bloqué`, the ceiling holds — so
    the guarantee does not depend on the registry happening to be modest.
    """
    doctored = json.loads(_map(tmp_path).read_text(encoding="utf-8"))
    for facet in doctored["facettes"]:
        facet["mode_publie"] = "B"
    path = tmp_path / "everything-blocked.json"
    path.write_text(json.dumps(doctored), encoding="utf-8")

    report = diagnose(path, frozenset({Profile.p1b}))
    assert report.blocked == ()
    assert "bloquons 0" in report.statement()
    assert "aucune frontière d'outils" in report.statement()
    assert all(mode != "B" for line in report.lines for _, mode in line.facets)

    # And the same map, for a client who does run agents, still says what it proves.
    agents = diagnose(path, frozenset({Profile.p1b, Profile.p3}))
    assert agents.blocked, "the ceiling must bound the SaaS assistant, not the client"
