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
