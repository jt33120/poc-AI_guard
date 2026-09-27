"""The public Secret Guard ledger is generated, complete and fail-closed.

« Developer Guard » reste le nom interne du générateur ; le document publié porte le nom
commercial (`CLAUDE.md` §1), et c'est ce nom que le contrôle de dérive altère.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "gen_product_coverage.mjs"
OUTPUT = ROOT / "frontend" / "lib" / "generated" / "product-coverage.json"


def _check() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(GENERATOR), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def test_generated_product_coverage_is_current_and_complete() -> None:
    result = _check()
    assert result.returncode == 0, result.stderr
    document = json.loads(OUTPUT.read_text(encoding="utf-8"))
    threats = document["threats"]
    assert document["schemaVersion"] == 1
    assert document["product"] == "Secret Guard"
    assert len(threats) == 77
    assert len({threat["id"] for threat in threats}) == 77
    for threat in threats:
        assert threat["mode"] in {"B", "D", "O", "A", "X"}
        assert threat["status"] in {"implemented_local", "out_of_scope"}
        assert isinstance(threat["limit"], str) and threat["limit"]


def test_generated_product_coverage_gate_rejects_drift() -> None:
    original = OUTPUT.read_text(encoding="utf-8")
    try:
        stale = original.replace('"Secret Guard"', '"Stale Guard"', 1)
        assert stale != original
        OUTPUT.write_text(stale, encoding="utf-8")
        result = _check()
        assert result.returncode != 0
        assert "stale" in result.stderr
    finally:
        OUTPUT.write_text(original, encoding="utf-8")
