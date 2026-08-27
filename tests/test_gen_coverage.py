"""The CM-7 gate itself. A gate that never fails is a decorative control.

`scripts/gen_coverage.py` is the thing that stops a `Bloqué` claim from being
published without a scenario. If it silently passed everything, nothing downstream
would notice -- the map would look identical. So its *refusal* is tested here, not
only its success.

The *real* registry is deliberately not gated from inside this suite: the scenario
report is written at session finish, so a test reading it mid-session would depend on
a previous run having left the file behind -- green locally, red on a fresh CI
checkout. CI runs `gen_coverage.py --check` after pytest instead, which is the honest
place for it.
"""

from __future__ import annotations

import json
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
    facettes:
      - {cle: dur, libelle: "revendication dure", mode: B, ingress: [mcp]}
      - {cle: mou, libelle: "revendication molle", mode: D}
"""


def _run(tmp_path: Path, scenarios: list[dict[str, object]]) -> subprocess.CompletedProcess[str]:
    """Run the generator against a throwaway registry + scenario report."""
    cov = tmp_path / "coverage"
    cov.mkdir()
    (cov / "rows.yaml").write_text(_REGISTRY, encoding="utf-8")
    (cov / ".scenarios.json").write_text(json.dumps(scenarios), encoding="utf-8")
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "gen_coverage.py").write_text(
        _SCRIPT.read_text(encoding="utf-8"), encoding="utf-8"
    )
    return subprocess.run(
        [sys.executable, str(tmp_path / "scripts" / "gen_coverage.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )


def _passing(row: str, facet: str, ingress: str) -> dict[str, object]:
    return {"row": row, "facet": facet, "ingress": ingress, "test": "t", "outcome": "passed"}


def test_a_blocked_claim_without_a_scenario_fails_the_build(tmp_path: Path) -> None:
    result = _run(tmp_path, [])
    assert result.returncode == 1
    assert "M-99/dur" in result.stderr
    assert "aucun scénario ne l'asserte" in result.stderr


def test_a_failing_scenario_proves_nothing(tmp_path: Path) -> None:
    # The distinction that matters: the marker existing is not the marker passing.
    failed = _passing("M-99", "dur", "mcp") | {"outcome": "failed"}
    result = _run(tmp_path, [failed])
    assert result.returncode == 1


def test_a_passing_scenario_satisfies_the_gate(tmp_path: Path) -> None:
    result = _run(tmp_path, [_passing("M-99", "dur", "mcp")])
    assert result.returncode == 0, result.stderr
    assert "CM-7 = 0" in result.stdout


def test_a_marker_naming_an_unknown_facet_fails(tmp_path: Path) -> None:
    # Same shape as the closed constraint vocabulary: an unknown key is rejected,
    # never silently ignored. A typo'd marker would otherwise prove nothing while
    # looking like proof.
    result = _run(tmp_path, [_passing("M-99", "inexistante", "mcp")])
    assert result.returncode == 1
    assert "marqueur inconnu" in result.stderr


def test_a_scenario_on_an_unclaimed_ingress_is_rejected(tmp_path: Path) -> None:
    # The registry claims `mcp` only. A test asserting the http path would be real
    # evidence, but not evidence for *this* claim -- accepting it would let the map
    # publish a path nobody claimed.
    result = _run(tmp_path, [_passing("M-99", "dur", "http")])
    assert result.returncode == 1
    assert "absent de la revendication" in result.stderr


def test_a_missing_scenario_report_fails_closed(tmp_path: Path) -> None:
    cov = tmp_path / "coverage"
    cov.mkdir()
    (cov / "rows.yaml").write_text(_REGISTRY, encoding="utf-8")
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "gen_coverage.py").write_text(
        _SCRIPT.read_text(encoding="utf-8"), encoding="utf-8"
    )
    result = subprocess.run(
        [sys.executable, str(tmp_path / "scripts" / "gen_coverage.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    # No report means nothing was proven -- not that everything is fine.
    assert result.returncode == 1
    assert "fail-closed" in result.stderr
