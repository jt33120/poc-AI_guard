"""The CM-7 gate itself. A gate that never fails is a decorative control.

`scripts/gen_coverage.py` is the thing that stops a `Bloqué` claim from being
published without a scenario. If it silently passed everything, nothing downstream
would notice -- the map would look identical. So its *refusal* is tested here, not
only its success. Rule 3 -- both halves of a `Bloqué` claim -- is the one most
likely to be argued away, so it has a test on each side of it.

The *real* registry is deliberately not gated from inside this suite: the scenario
report is written at session finish, so a test reading it mid-session would depend on
a previous run having left the file behind -- green locally, red on a fresh CI
checkout. CI runs `gen_coverage.py --check` after pytest instead, which is the honest
place for it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_SCRIPT = _REPO / "scripts" / "gen_coverage.py"

_REGISTRY = """
version: 1
modes:
  B: {libelle: "Bloqué", exige_scenario: true}
  D: {libelle: "Détecté", exige_scenario: false}
ingress:
  mcp: "Gateway MCP"
  http: "/v1/authorize"
rows:
  - id: M-99
    titre: "Menace de test"
    famille: usage_ia
    profils: [P3]
    facettes:
      - {cle: dur, libelle: "revendication dure", mode: B, ingress: [mcp], profils: [P3]}
      - {cle: mou, libelle: "revendication molle", mode: D, profils: [P3]}
"""


def _run(
    tmp_path: Path, scenarios: list[dict[str, object]] | None, registry: str = _REGISTRY
) -> subprocess.CompletedProcess[str]:
    """Run the generator against a throwaway registry + scenario report.

    `scenarios=None` writes no report at all, which is its own test case.
    """
    cov = tmp_path / "coverage"
    cov.mkdir()
    (cov / "rows.yaml").write_text(registry, encoding="utf-8")
    if scenarios is not None:
        (cov / ".scenarios.json").write_text(json.dumps(scenarios), encoding="utf-8")
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "gen_coverage.py").write_text(
        _SCRIPT.read_text(encoding="utf-8"), encoding="utf-8"
    )
    # The script is copied so it reads the throwaway registry beside it (it anchors
    # its data paths on its own location). Its *code* still imports `core.profiles`,
    # which the copy cannot see from a tmp dir -- hence the real repo on PYTHONPATH.
    env = {**os.environ, "PYTHONPATH": str(_REPO)}
    return subprocess.run(
        [sys.executable, str(tmp_path / "scripts" / "gen_coverage.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=tmp_path,
        env=env,
    )


def _passing(row: str, facet: str, ingress: str, sens: str = "bloque") -> dict[str, object]:
    return {
        "row": row,
        "facet": facet,
        "ingress": ingress,
        "sens": sens,
        "test": f"t_{sens}",
        "outcome": "passed",
    }


def _complete(row: str, facet: str, ingress: str) -> list[dict[str, object]]:
    """All three parts of a `Bloqué` claim: it blocks, a legitimate call still gets
    through, and with the guard off the same dangerous call reaches the downstream."""
    return [
        _passing(row, facet, ingress, sens)
        for sens in ("bloque", "laisse_passer", "controle_negatif")
    ]


def test_a_blocked_claim_without_a_scenario_fails_the_build(tmp_path: Path) -> None:
    result = _run(tmp_path, [])
    assert result.returncode == 1
    assert "M-99/dur" in result.stderr
    assert "aucun scénario ne l'asserte" in result.stderr


def test_a_failing_scenario_proves_nothing(tmp_path: Path) -> None:
    # The distinction that matters: the marker existing is not the marker passing.
    scenarios = [s | {"outcome": "failed"} for s in _complete("M-99", "dur", "mcp")]
    result = _run(tmp_path, scenarios)
    assert result.returncode == 1


def test_all_three_parts_satisfy_the_gate(tmp_path: Path) -> None:
    result = _run(tmp_path, _complete("M-99", "dur", "mcp"))
    assert result.returncode == 0, result.stderr
    assert "CM-7 = 0" in result.stdout


def test_a_blocking_only_claim_fails(tmp_path: Path) -> None:
    # A guard that refuses everything is not a control, it is an outage -- and the
    # blocking scenario stays green on a gateway that blocks blindly. Proving the
    # refusal without proving the discrimination proves the wrong thing.
    result = _run(tmp_path, [_passing("M-99", "dur", "mcp", "bloque")])
    assert result.returncode == 1
    assert "une garde qui refuse tout est une panne" in result.stderr


def test_a_pass_through_only_claim_fails(tmp_path: Path) -> None:
    result = _run(tmp_path, [_passing("M-99", "dur", "mcp", "laisse_passer")])
    assert result.returncode == 1
    assert "ne prouve que l'action est refusée" in result.stderr


def test_a_claim_without_its_negative_control_fails(tmp_path: Path) -> None:
    """`AD-30.3` — the part that is easiest to argue away and hardest to do without.

    Both other halves can pass while the dangerous invocation was never going to
    arrive: a crash, an unreachable downstream, a misspelt tool name. Then "the
    defence held" is a statement about nothing.
    """
    result = _run(
        tmp_path,
        [_passing("M-99", "dur", "mcp", "bloque"), _passing("M-99", "dur", "mcp", "laisse_passer")],
    )
    assert result.returncode == 1
    assert "aucun contrôle négatif" in result.stderr


def test_a_marker_naming_an_unknown_facet_fails(tmp_path: Path) -> None:
    # Same shape as the closed constraint vocabulary: an unknown key is rejected,
    # never silently ignored. A typo'd marker would otherwise prove nothing while
    # looking like proof.
    result = _run(tmp_path, _complete("M-99", "inexistante", "mcp"))
    assert result.returncode == 1
    assert "marqueur inconnu" in result.stderr


def test_a_scenario_on_an_unclaimed_ingress_is_rejected(tmp_path: Path) -> None:
    # The registry claims `mcp` only. A test asserting the http path would be real
    # evidence, but not evidence for *this* claim -- accepting it would let the map
    # publish a path nobody claimed.
    result = _run(tmp_path, _complete("M-99", "dur", "http"))
    assert result.returncode == 1
    assert "absent de la revendication" in result.stderr


def test_a_missing_scenario_report_fails_closed(tmp_path: Path) -> None:
    result = _run(tmp_path, None)
    # No report means nothing was proven -- not that everything is fine.
    assert result.returncode == 1
    assert "fail-closed" in result.stderr


def test_a_row_without_its_applicability_stops_the_map(tmp_path: Path) -> None:
    """`FR-173`: the second axis is not optional decoration.

    A row with no `profils` would render as applying to nobody, and a map that
    quietly drops a threat is worse than one that admits it is uncovered.
    """
    result = _run(tmp_path, [], registry=_REGISTRY.replace("    profils: [P3]\n", "", 1))
    assert result.returncode != 0
    assert "profils" in result.stderr


def test_the_verb_bloquer_is_refused_on_a_line_nothing_publishes_as_blocked(
    tmp_path: Path,
) -> None:
    """FR-175 — the same defect as CM-7, one release further downstream.

    A support that says "we block M-99" when M-99 publishes `Détecté` is a false
    claim about a security control, made in front of a customer. The gate reads the
    published mode, so it cannot be argued with.
    """
    (tmp_path / "README.md").write_text(
        "xSOM bloque M-99 nativement, chez vous, aujourd'hui.\n", encoding="utf-8"
    )
    result = _run(tmp_path, [], registry=_REGISTRY.replace("mode: B", "mode: D", 1))
    assert result.returncode == 1
    assert "« bloquer » attribué à M-99" in result.stderr


def test_the_same_sentence_passes_once_the_line_is_actually_blocked(tmp_path: Path) -> None:
    """The other half. A gate that refused every claim would be one nobody keeps on."""
    (tmp_path / "README.md").write_text(
        "xSOM bloque M-99 nativement, chez vous, aujourd'hui.\n", encoding="utf-8"
    )
    result = _run(tmp_path, _complete("M-99", "dur", "mcp"))
    assert result.returncode == 0, result.stderr
    assert "FR-175 = 0" in result.stdout


def test_the_mode_name_is_vocabulary_and_not_a_claim(tmp_path: Path) -> None:
    """The public page's own heading is « un seul mode autorise le verbe bloquer ».

    A gate that failed on the word used to *define* the rule would be a gate nobody
    could keep switched on, so only conjugated verbs count.
    """
    (tmp_path / "README.md").write_text(
        "M-99 est publiée en mode Bloqué ? Non : cinq modes existent, "
        "et un seul autorise le verbe « bloquer ».\n",
        encoding="utf-8",
    )
    result = _run(tmp_path, [], registry=_REGISTRY.replace("mode: B", "mode: D", 1))
    assert result.returncode == 0, result.stderr
