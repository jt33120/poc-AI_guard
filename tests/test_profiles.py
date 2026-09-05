"""FR-172 / FR-174 — l'axe d'applicabilité, et le plafond qui le borne.

Ce que ces tests protègent n'est pas un calcul, c'est un argument commercial qui
doit rester vrai : « sur les 15 menaces que le marché vous présente, N vous
concernent réellement ». Un `profils` mal posé transforme cette phrase en la chose
qu'elle dénonce — un catalogue de cases cochées.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from core.profiles import (
    Family,
    Profile,
    Taxonomie,
    applicable_rows,
    capped_mode,
    ceiling,
    load_rows,
)

_REGISTRY = Path(__file__).resolve().parents[1] / "coverage" / "rows.yaml"

_ROWS = load_rows(_REGISTRY)
_ALL = frozenset(Profile)


def _ids(profiles: frozenset[Profile]) -> set[str]:
    return {row.id for row in applicable_rows(_ROWS, profiles)}


def test_the_registry_loads_and_every_row_declares_its_applicability() -> None:
    assert len(_ROWS) == 16
    assert all(row.profiles for row in _ROWS)
    assert all(facet.profiles for row in _ROWS for facet in row.facets)


def test_a_row_whose_line_contradicts_its_facets_fails_to_load(tmp_path: Path) -> None:
    """The check that keeps the two levels from drifting apart.

    Left unchecked, the contradiction publishes as "this threat does not concern
    you" printed over a facet that does.
    """
    doc = yaml.safe_load(_REGISTRY.read_text(encoding="utf-8"))
    doc["rows"] = [row for row in doc["rows"] if row["id"] == "M-11"]
    doc["rows"][0]["profils"] = ["P3"]  # drops P2 and P4, which its facets still claim
    doctored = tmp_path / "rows.yaml"
    doctored.write_text(yaml.safe_dump(doc), encoding="utf-8")
    with pytest.raises(ValueError, match="is not the union"):
        load_rows(doctored)


@pytest.mark.parametrize("bad", ["P6", "p3", "hyperscaler"])
def test_an_unknown_profile_is_refused_rather_than_ignored(tmp_path: Path, bad: str) -> None:
    doc = yaml.safe_load(_REGISTRY.read_text(encoding="utf-8"))
    doc["rows"] = [row for row in doc["rows"] if row["id"] == "M-06"]
    doc["rows"][0]["profils"] = [bad]
    doc["rows"][0]["facettes"][0]["profils"] = [bad]
    doctored = tmp_path / "rows.yaml"
    doctored.write_text(yaml.safe_dump(doc), encoding="utf-8")
    with pytest.raises(ValueError, match="unknown profile"):
        load_rows(doctored)


def test_a_client_who_only_consumes_an_api_is_told_what_is_not_their_subject() -> None:
    """The founding sort (§2.1), computed rather than asserted.

    Eight of sixteen, five of them our ground. That is the number the whole pitch
    turns on, and a vendor selling all fifteen lines is selling a catalogue.
    """
    p1a = _ids(frozenset({Profile.p1a}))
    assert len(p1a) == 8
    ours = [
        r for r in applicable_rows(_ROWS, frozenset({Profile.p1a})) if r.family is Family.usage_ia
    ]
    assert len(ours) == 5
    # No agents, so nothing about what an agent does.
    assert {"M-06", "M-12", "M-13"} & p1a == set()
    # No corpus of their own, so the poisoning line is not theirs yet.
    assert "M-03" not in p1a


@pytest.mark.parametrize(
    ("row", "before", "after", "why"),
    [
        ("M-03", Profile.p1a, Profile.p2, "sa base vectorielle est empoisonnable"),
        ("M-04", Profile.p2, Profile.p4, "il héberge et expose un modèle"),
        ("M-05", Profile.p4, Profile.p5, "il touche aux poids"),
    ],
)
def test_the_three_switches_change_camp_at_the_profile_they_are_supposed_to(
    row: str, before: Profile, after: Profile, why: str
) -> None:
    """§2.3 — the nuance that proves we know the trade, so it gets a test each."""
    assert row not in _ids(frozenset({before})), why
    assert row in _ids(frozenset({after})), why


def test_holding_every_profile_still_leaves_nothing_out() -> None:
    assert _ids(_ALL) == {row.id for row in _ROWS}


# --- FR-174: the declared blind spot, as a property rather than a paragraph ---


def test_saas_embedded_ai_caps_at_detection() -> None:
    assert ceiling(frozenset({Profile.p1b})) == "D"


def test_a_client_who_also_runs_agents_is_not_blind() -> None:
    """The cap is about interposition, not about the customer.

    Someone running Copilot *and* tooled agents has a tool boundary we do sit on.
    Capping them because of the assistant would understate the product as badly as
    the reverse overstates it.
    """
    assert ceiling(frozenset({Profile.p1b, Profile.p3})) is None
    assert ceiling(frozenset()) is None


def test_the_cap_takes_whichever_claim_is_weaker() -> None:
    assert capped_mode("B", "D") == "D"  # blocking is out of reach here
    assert capped_mode("A", "D") == "A"  # attestation is weaker than the cap; it stands
    assert capped_mode("B", None) == "B"


def test_no_facet_can_be_published_as_blocked_to_a_copilot_only_client() -> None:
    """The structural form of "we cannot interpose in front of Microsoft Copilot".

    A vendor claiming to supervise Copilot through a proxy is lying or has not
    understood the product. This asserts we are unable to say it: not that the
    sentence is absent from a document, but that no combination of registry data
    and profile produces it.
    """
    cap = ceiling(frozenset({Profile.p1b}))
    published = {
        capped_mode(facet.mode, cap)
        for row in applicable_rows(_ROWS, frozenset({Profile.p1b}))
        for facet in row.facets
        if Profile.p1b in facet.profiles
    }
    assert "B" not in published, f"a Bloqué claim survived the P1b ceiling: {published}"


# ---------------------------------------------------------------------------
# `FR-194` — la correspondance de taxonomie est déclarative, fermée et millésimée
# ---------------------------------------------------------------------------
# La correspondance existait déjà, en prose, dans `docs/product/THREAT-COVERAGE.md`
# (« M-01→LLM01, M-03→LLM04, … »). Rien ne la vérifiait et rien ne la publiait.
# `FR-194` la fait descendre dans le registre, où elle est parsée fail-closed.


def _registry(tmp_path: Path, referentiels: str) -> Path:
    registry = tmp_path / "rows.yaml"
    registry.write_text(
        "rows:\n"
        "  - id: M-99\n"
        '    titre: "Menace de test"\n'
        "    famille: usage_ia\n"
        "    profils: [P3]\n"
        f"{referentiels}"
        "    facettes:\n"
        '      - {cle: f, libelle: "facette", mode: X, profils: [P3], raison: "raison"}\n',
        encoding="utf-8",
    )
    return registry


def test_a_management_framework_is_refused_by_the_vocabulary(tmp_path: Path) -> None:
    """`AR-1` tient par l'énumération, pas par la discipline du rédacteur.

    La frontière passe entre une taxonomie **technique** — s'y aligner est descriptif —
    et un référentiel de **management** dont la correspondance engage le jugement d'un
    assesseur. Un champ libre laisserait écrire `ISO 42001` sans que personne ne le
    voie ; ici il faut modifier `core/profiles.py`, donc le défendre en revue.
    """
    registry = _registry(
        tmp_path,
        '    referentiels:\n      - {taxonomie: iso_42001, version: "2023", id: "8.3"}\n',
    )
    with pytest.raises(ValueError, match="taxonomie inconnue"):
        load_rows(registry)


def test_a_reference_without_its_vintage_is_refused(tmp_path: Path) -> None:
    """`LLM01` seul n'identifie rien.

    OWASP a renuméroté entre 2023 et 2025 — `LLM10` y est passé de « Model Theft » à
    « Unbounded Consumption ». Une correspondance sans millésime est précisément celle
    qu'un auditeur rejette, ce dont `EXH-7` met en garde.
    """
    registry = _registry(tmp_path, "    referentiels:\n      - {taxonomie: owasp_llm, id: LLM01}\n")
    with pytest.raises(ValueError, match="version"):
        load_rows(registry)


def test_the_mapping_is_inherited_from_the_row(tmp_path: Path) -> None:
    """« M-01 ≡ LLM01 » parle de la menace, pas de l'une de ses facettes."""
    registry = _registry(
        tmp_path,
        '    referentiels:\n      - {taxonomie: owasp_llm, version: "2025", id: LLM01}\n',
    )
    rows = load_rows(registry)
    assert rows[0].facets[0].referentiels[0].identifiant == "LLM01"
    assert rows[0].facets[0].referentiels[0].version == "2025"


def test_the_published_registry_maps_what_the_doctrine_says_it_maps() -> None:
    """Les huit correspondances écrites en prose sont bien celles du registre.

    `docs/product/THREAT-COVERAGE.md` les énonce depuis longtemps ; c'était de la
    documentation, donc une chose qui dérive. Ce test en fait un contrat — et il
    échouerait si quelqu'un changeait l'une sans changer l'autre.
    """
    rows = {r.id: r for r in load_rows(_REGISTRY)}
    owasp = {
        rid: next(
            (
                r.identifiant
                for r in rows[rid].facets[0].referentiels
                if r.taxonomie is Taxonomie.owasp_llm
            ),
            None,
        )
        for rid in ("M-01", "M-03", "M-10", "M-11", "M-12", "M-13", "M-14", "M-16")
    }
    assert owasp == {
        "M-01": "LLM01",
        "M-03": "LLM04",
        "M-10": "LLM02",
        "M-11": "LLM03",
        "M-12": "LLM06",
        "M-13": "LLM05",
        "M-14": "LLM07",
        "M-16": "LLM09",
    }
