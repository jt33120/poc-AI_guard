"""Les promesses de la plateforme restent adossées à des preuves qui existent.

`docs/ai-guard/CLAIMS.md` rattache chaque phrase publique d'AI Guard à un test. Ce
fichier vérifie que ces tests existent toujours : une preuve renommée ou supprimée
laisserait une promesse sans rien derrière, et personne ne relit un tableau de doc.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from api.main import create_app
from core.config import Settings

_ROOT = Path(__file__).resolve().parent.parent
_CLAIMS = _ROOT / "docs" / "ai-guard" / "CLAIMS.md"
_REFERENCE = re.compile(r"`(tests/[\w/]+\.py)::(\w+)`")


def _rows() -> list[str]:
    return [line for line in _CLAIMS.read_text("utf-8").splitlines() if line.startswith("| ")]


def test_every_cited_proof_exists() -> None:
    cited = _REFERENCE.findall(_CLAIMS.read_text("utf-8"))
    assert len(cited) >= 40, "le tableau ne cite presque plus rien"
    missing = []
    for path, name in cited:
        source = _ROOT / path
        if not source.is_file() or not re.search(
            rf"^(?:async )?def {name}\(", source.read_text("utf-8"), re.MULTILINE
        ):
            missing.append(f"{path}::{name}")
    assert missing == []


def test_every_proven_claim_cites_a_test() -> None:
    unproven = [
        row.split("|")[1].strip()
        for row in _rows()
        if ("| Prouvé" in row or "| Partiel" in row) and not _REFERENCE.search(row)
    ]
    assert unproven == []


def test_an_unhandled_error_reveals_nothing_to_the_client() -> None:
    """``CLAUDE.md`` §4.8 : un 500 générique et un identifiant, jamais la trace."""
    app = create_app(Settings(_env_file=None, env="prod", cors_allow_origins=["https://x.test"]))

    @app.get("/v1/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail at /srv/app/core.py line 42")

    response = TestClient(app, raise_server_exceptions=False).get("/v1/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Internal server error"
    assert re.fullmatch(r"[0-9a-f]{32}", body["error_id"])
    assert "secret internal detail" not in response.text
    assert "Traceback" not in response.text
