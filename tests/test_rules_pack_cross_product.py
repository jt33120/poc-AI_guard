"""Un réglage publié par la plateforme est celui que le poste accepte et applique.

La plateforme compose un paquet depuis un brouillon d'opérateur (termes en clair
compris), le valide et le signe. Le résultat, à sel et date fixés, doit être
exactement l'enveloppe figée dans
`secret-guard/tests/fixtures/platform-signed-rules-pack.json` ; côté poste,
`secret-guard/tests/runner/platform-signed-pack.test.ts` vérifie cette même
enveloppe avec la clé d'autorité de test, puis détecte et masque les données
qu'elle décrit. Les deux moitiés tournent chacune dans sa CI ; ensemble, elles
prouvent la chaîne opérateur → signature → poste sans runtime croisé.

Régénérer après un changement voulu :
``uv run python -m tests.test_rules_pack_cross_product``.
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from core import rules_packs
from core.checkpoints import Ed25519Signer

_ROOT = Path(__file__).resolve().parent.parent
_VECTORS = _ROOT / "secret-guard" / "contracts" / "fixtures" / "rules-pack-vectors.json"
_FIXTURE = _ROOT / "secret-guard" / "tests" / "fixtures" / "platform-signed-rules-pack.json"
_TENANT = "00000000-0000-4000-8000-00000000c0de"
_NOW = datetime(2026, 9, 27, 8, 0, tzinfo=UTC)
_SALT = bytes(range(200, 216))

_DRAFT: dict[str, Any] = {
    "packId": "heron-main",
    "validityDays": 365,
    "detectors": [
        {
            "id": "heron.dossier",
            "label": "Numéro de dossier Héron",
            "category": "customer_data",
            "action": "block",
            "match": {"type": "pattern", "pattern": "DOS-[0-9]{6}-[A-Z]{2}"},
        },
        {
            "id": "heron.contrat",
            "label": "Référence de contrat",
            "category": "customer_data",
            "action": "warn",
            "match": {"type": "pattern", "pattern": "[0-9]{10}", "caseInsensitive": False},
            "context": {"keywords": ["contrat", "contract"], "window": 24},
        },
        {
            "id": "heron.hosts",
            "label": "Hôte interne",
            "category": "internal_infra",
            "action": "block",
            "match": {
                "type": "pattern",
                "pattern": "[a-z0-9\\-]{2,20}\\.corp\\.heron",
                "caseInsensitive": True,
            },
        },
        {
            "id": "heron.codenames",
            "label": "Nom de code",
            "category": "project",
            "action": "block",
            "match": {
                "type": "terms",
                "terms": ["Opération Martin-Pêcheur", "Aigrette", "Bec Jaune"],
            },
        },
    ],
    "tests": {
        "positives": [
            {"detector": "heron.dossier", "text": "Voir le dossier DOS-104233-FR avant lundi."},
            {"detector": "heron.contrat", "text": "Contrat n° 4400012345, signé hier."},
            {"detector": "heron.hosts", "text": "ssh deploy@api-01.corp.heron"},
        ],
        "negatives": [
            "Le ticket 4400012345 est clos.",
            "DOS-12-FR n'est pas un dossier.",
            "api-01.corp.example.com répond.",
        ],
    },
}


def _test_signer() -> Ed25519Signer:
    vectors = json.loads(_VECTORS.read_text("utf-8"))
    return Ed25519Signer(base64.b64decode(vectors["signature"]["seedBase64"]))


def build_envelope(monkeypatch: pytest.MonkeyPatch | None = None) -> dict[str, Any]:
    """Le chemin de publication, sans base : brouillon → charge utile validée → enveloppe."""
    fixed = pytest.MonkeyPatch() if monkeypatch is None else monkeypatch
    fixed.setattr(rules_packs.secrets, "token_bytes", lambda size: _SALT[:size])
    try:
        draft = rules_packs.PackDraft.model_validate(_DRAFT)
        payload = rules_packs.build_payload(
            draft, tenant_id=_TENANT, version=1, previous=None, now=_NOW
        )
    finally:
        if monkeypatch is None:
            fixed.undo()
    rules_packs.validate(payload)
    return rules_packs.envelope(payload, _test_signer())


def test_the_platform_signs_exactly_the_pack_the_workstation_test_applies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    produced = build_envelope(monkeypatch)
    frozen = json.loads(_FIXTURE.read_text("utf-8"))
    assert produced == frozen["envelope"]
    assert rules_packs.payload_digest(produced["payload"]) == frozen["payloadDigest"]


def test_the_clear_terms_never_reach_the_signed_pack(monkeypatch: pytest.MonkeyPatch) -> None:
    signed = json.dumps(build_envelope(monkeypatch), ensure_ascii=False).casefold()
    for term in ("martin", "pêcheur", "pecheur", "aigrette", "bec jaune"):
        assert term not in signed


if __name__ == "__main__":
    envelope = build_envelope()
    document = {
        "description": (
            "Enveloppe produite par la plateforme (tests/test_rules_pack_cross_product.py), "
            "signée avec la clé de TEST des vecteurs. Les termes en clair du brouillon ne "
            "sont que dans les deux tests, jamais dans ce fichier."
        ),
        "payloadDigest": rules_packs.payload_digest(envelope["payload"]),
        "envelope": envelope,
    }
    _FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    _FIXTURE.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"écrit : {_FIXTURE.relative_to(_ROOT)}")
