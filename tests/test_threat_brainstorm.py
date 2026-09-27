"""The internal threat brainstorm is generated from the typed glossary AST."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]
DOCUMENT = ROOT / "docs" / "menaces-backend-brainstorm.md"


def test_threat_brainstorm_is_current_complete_and_french() -> None:
    subprocess.run(
        ["node", "scripts/gen_threat_backend_brainstorm.mjs", "--check"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    content = DOCUMENT.read_text(encoding="utf-8")
    assert content.count("\n## ") - 1 == 77  # exclude "Comment l'utiliser"
    assert "`modele-piege`" in content
    assert "Moteur de policy maison, Custom policy engine" not in content
    assert "Outils de recherche, Research tooling" not in content
