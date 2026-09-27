"""Le contrat « Règles sur mesure » v1, vecteur par vecteur, côté plateforme.

``secret-guard/contracts/fixtures/rules-pack-vectors.json`` est figé ; le poste le rejoue
en TypeScript. Chaque vecteur est un test à part entière : un écart se lit par son nom, et
aucun vecteur ne peut disparaître sans que le compte ci-dessous ne casse.
"""

from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from core import rules_pack_engine as engine
from core import rules_packs
from core.checkpoints import Ed25519Signer

_CONTRACT = Path(__file__).resolve().parents[1] / "secret-guard" / "contracts"
VECTORS: dict[str, Any] = json.loads(
    (_CONTRACT / "fixtures" / "rules-pack-vectors.json").read_text(encoding="utf-8")
)


def test_every_vector_family_is_exercised() -> None:
    """Un vecteur ajouté ou retiré se voit ici avant de passer inaperçu."""
    assert len(VECTORS["grammar"]) == 59
    assert len(VECTORS["detection"]) == 20
    assert len(VECTORS["terms"]["cases"]) == 7
    assert len(VECTORS["packs"]) == 10


@pytest.mark.parametrize(
    "vector", VECTORS["grammar"], ids=[repr(v["pattern"])[:48] for v in VECTORS["grammar"]]
)
def test_grammar_vector(vector: dict[str, Any]) -> None:
    expected = None if vector["valid"] else vector["error"]
    assert engine.pattern_error(vector["pattern"], has_context=vector["hasContext"]) == expected


@pytest.mark.parametrize(
    "vector", VECTORS["detection"], ids=[v["name"] for v in VECTORS["detection"]]
)
def test_detection_vector(vector: dict[str, Any]) -> None:
    text = vector["text"]
    found = [text[start:end] for start, end in engine.detect(vector["detector"], text)]
    assert found == vector["matches"]


@pytest.mark.parametrize(
    "case", VECTORS["terms"]["cases"], ids=[c["term"] for c in VECTORS["terms"]["cases"]]
)
def test_terms_digest_vector(case: dict[str, str]) -> None:
    salt = base64.b64decode(VECTORS["terms"]["salt"])
    normalized = engine.normalize_term(case["term"])
    assert normalized == case["normalized"]
    assert engine.term_digest(salt, normalized) == case["digest"]


@pytest.mark.parametrize("vector", VECTORS["packs"], ids=[v["name"] for v in VECTORS["packs"]])
def test_pack_validity_vector_through_the_isolated_engine(vector: dict[str, Any]) -> None:
    """Le chemin réel de la plateforme : schéma dans le processus, le reste isolé."""
    if vector["valid"]:
        rules_packs.validate(vector["pack"])
        return
    with pytest.raises(rules_packs.RulesPackError) as refused:
        rules_packs.validate(vector["pack"])
    assert refused.value.code == vector["error"]


@pytest.mark.parametrize("vector", VECTORS["packs"], ids=[v["name"] for v in VECTORS["packs"]])
def test_pack_validity_vector_in_process(vector: dict[str, Any]) -> None:
    rules_packs.check_schema(vector["pack"])
    try:
        engine.check_pack(vector["pack"])
    except engine.PackError as exc:
        assert not vector["valid"] and exc.code == vector["error"]
    else:
        assert vector["valid"]


def _signer() -> Ed25519Signer:
    return Ed25519Signer(base64.b64decode(VECTORS["signature"]["seedBase64"]))


def test_signature_vector_key_identity() -> None:
    signing = _signer()
    assert signing.public_key == VECTORS["signature"]["publicKeyBase64"]
    assert signing.key_id == VECTORS["signature"]["keyId"]


def test_signature_vector_canonical_bytes_and_digest() -> None:
    vector = VECTORS["signature"]
    payload = vector["envelope"]["payload"]
    assert rules_packs.canonical(payload) == vector["canonicalPayload"].encode("utf-8")
    assert rules_packs.payload_digest(payload) == vector["payloadDigest"]


def test_signature_vector_envelope_is_reproduced_byte_for_byte() -> None:
    vector = VECTORS["signature"]
    assert rules_packs.envelope(vector["envelope"]["payload"], _signer()) == vector["envelope"]


def _trusted() -> dict[str, bytes]:
    vector = VECTORS["signature"]
    return {vector["keyId"]: base64.b64decode(vector["publicKeyBase64"])}


def test_signature_vector_verifies_and_tampering_is_rejected() -> None:
    vector = VECTORS["signature"]
    assert rules_packs.verify_envelope(vector["envelope"], _trusted())
    tampered = copy.deepcopy(vector["envelope"])
    tampered["payload"].update(vector["tampered"]["payloadPatch"])
    assert not rules_packs.verify_envelope(tampered, _trusted())


def test_a_key_carried_by_the_envelope_is_never_trusted() -> None:
    """§1 : la clé vient de la liste du poste ; une autre autorité est refusée."""
    other = Ed25519Signer(bytes(32))
    forged = rules_packs.envelope(VECTORS["signature"]["envelope"]["payload"], other)
    assert not rules_packs.verify_envelope(forged, _trusted())
    assert not rules_packs.verify_envelope(forged, {})


def test_the_reference_pack_matches_the_frozen_json_schema() -> None:
    """Le schéma Pydantic et ``rules-pack.schema.json`` s'accordent sur les vecteurs."""
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((_CONTRACT / "rules-pack.schema.json").read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    reference = VECTORS["packs"][0]["pack"]
    mutations: list[tuple[str, Any]] = [
        ("reference", reference),
        ("extra field", {**reference, "extra": 1}),
        ("wrong kind", {**reference, "kind": "other"}),
        ("schema v2", {**reference, "schemaVersion": 2}),
        ("bad pack id", {**reference, "packId": "Acme"}),
        ("version zero", {**reference, "version": 0}),
        ("bad timestamp", {**reference, "issuedAt": "2026-09-01"}),
        ("no detector", {**reference, "detectors": []}),
        ("string version", {**reference, "version": "3"}),
        ("null issuer", {**reference, "issuer": None}),
    ]
    for name, candidate in mutations:
        expected = validator.is_valid(candidate)
        try:
            rules_packs.check_schema(candidate)
            accepted = True
        except rules_packs.RulesPackError:
            accepted = False
        assert accepted == expected, name


@pytest.mark.parametrize(
    "patch",
    [
        {"version": 3.0},
        {"version": True},
        {"issuer": "nul\x00"},
        {"issuer": "surrogate \ud800"},
    ],
    ids=["float", "boolean", "nul", "lone surrogate"],
)
def test_the_platform_refuses_what_cannot_be_signed_identically(patch: dict[str, Any]) -> None:
    """Plus strict que le schéma, et c'est voulu : ces valeurs n'ont pas une seule forme.

    ``3.0`` s'écrit ``3`` en JavaScript et ``3.0`` en Python ; un surrogat isolé ne s'encode
    pas en UTF-8 ; ``jsonb`` refuse NUL. Signer l'un d'eux produirait une signature que
    le poste ne recalcule pas, ou une ligne que la base n'accepte pas.
    """
    candidate = {**VECTORS["packs"][0]["pack"], **patch}
    with pytest.raises(rules_packs.RulesPackError) as refused:
        rules_packs.check_schema(candidate)
    assert refused.value.code == "schema"
