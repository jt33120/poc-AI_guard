"""FR-178 — une ligne `Orchestré` nomme son substitut souverain, ou se déclasse.

`Orchestré` dit : *nous ne le bloquons pas nous-mêmes, nous pilotons un contrôle tiers
qui le fait, et nous en chaînons le verdict.* Le tiers devient alors une dépendance, et
la doctrine de souveraineté s'applique à lui. Sans substitut nommé, la ligne reste
`Hors périmètre` — la revendication est retirée plutôt que tenue par un chemin qui
contredit le discours.

La règle est appliquée **au parse** et non à la publication, pour que la carte, le
diagnostic de profil et les tests lisent tous le même mode. Deux lecteurs du même
registre qui divergent, c'est la famille de défauts que tout ce chantier traque.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.profiles import Souverainete, load_rows

_REGISTRY = Path(__file__).resolve().parent.parent / "coverage" / "rows.yaml"


def _write(tmp_path: Path, facette: str) -> Path:
    """Un registre minimal valide, dont seule la facette varie."""
    path = tmp_path / "rows.yaml"
    path.write_text(
        "version: 1\n"
        "rows:\n"
        "  - id: M-99\n"
        '    titre: "Ligne d\'essai"\n'
        "    famille: usage_ia\n"
        "    profils: [P3]\n"
        "    facettes:\n" + facette,
        encoding="utf-8",
    )
    return path


def test_an_orchestrated_facet_without_a_substitute_is_demoted(tmp_path: Path) -> None:
    """Le coeur de `FR-178` : la revendication tombe, elle ne passe pas en silence."""
    registry = _write(
        tmp_path,
        '      - cle: tiers\n        libelle: "contrôle tiers"\n        mode: O\n',
    )
    facet = load_rows(registry)[0].facets[0]
    assert facet.mode == "X"
    assert facet.declasse is True
    assert facet.substitut is None


def test_an_orchestrated_facet_with_a_substitute_keeps_its_mode(tmp_path: Path) -> None:
    """La moitié passante. Une règle qui déclasse tout ne discrimine rien."""
    registry = _write(
        tmp_path,
        '      - cle: tiers\n        libelle: "contrôle tiers"\n        mode: O\n'
        '        substitut: {nom: "Mistral", justification: ue}\n',
    )
    facet = load_rows(registry)[0].facets[0]
    assert facet.mode == "O"
    assert facet.declasse is False
    assert facet.substitut is not None
    assert facet.substitut.justification is Souverainete.ue


def test_an_unknown_justification_stops_the_registry(tmp_path: Path) -> None:
    """Nommer un substitut ne le rend pas souverain — le vocabulaire est fermé.

    Un champ libre laisserait écrire « conforme » ou « ok » et publierait `Orchestré`
    sur un SaaS hors UE. Le vocabulaire fermé oblige à déclarer `ue`, ce qu'un
    relecteur voit et peut contester.
    """
    registry = _write(
        tmp_path,
        '      - cle: tiers\n        libelle: "contrôle tiers"\n        mode: O\n'
        '        substitut: {nom: "un SaaS", justification: conforme}\n',
    )
    with pytest.raises(ValueError, match="justification de substitut inconnue"):
        load_rows(registry)


def test_an_incomplete_substitute_stops_the_registry(tmp_path: Path) -> None:
    """Un nom sans critère ne dit pas *pourquoi* la chaîne n'est pas percée."""
    registry = _write(
        tmp_path,
        '      - cle: tiers\n        libelle: "contrôle tiers"\n        mode: O\n'
        '        substitut: {nom: "un outil"}\n',
    )
    with pytest.raises(ValueError, match="demande `nom` et `justification`"):
        load_rows(registry)


def test_the_rule_only_touches_orchestrated_facets(tmp_path: Path) -> None:
    """Une facette `Bloqué` ne pilote aucun tiers : elle n'a pas de substitut à nommer."""
    registry = _write(
        tmp_path,
        '      - cle: chaine\n        libelle: "la chaîne elle-même"\n        mode: B\n',
    )
    facet = load_rows(registry)[0].facets[0]
    assert facet.mode == "B"
    assert facet.declasse is False


# --- Le registre réel -------------------------------------------------------------


def test_shadow_ai_discovery_is_declassed_in_the_real_registry() -> None:
    """La ligne que la doctrine sacrifie, et la raison pour laquelle elle existe.

    `ARCHI-SOUVERAINE` §5 : la découverte du Shadow AI passe par un CASB du marché, et
    il n'en existe aucun dont la décision reste dans le périmètre. C'est la ligne qui
    montre ce que la doctrine coûte quand on l'applique — si elle repassait `Orchestré`
    un jour, ce serait par un substitut nommé, pas par distraction.
    """
    facets = {(r.id, f.cle): f for r in load_rows(_REGISTRY) for f in r.facets}
    decouverte = facets[("M-10", "decouverte")]
    assert decouverte.declasse is True
    assert decouverte.mode == "X"


def test_every_published_orchestrated_facet_names_its_substitute() -> None:
    """L'invariant, sur le registre réel : `Orchestré` publié ⇒ substitut nommé."""
    for row in load_rows(_REGISTRY):
        for f in row.facets:
            if f.mode == "O":
                assert f.substitut is not None, f"{row.id}/{f.cle} publié Orchestré sans substitut"
