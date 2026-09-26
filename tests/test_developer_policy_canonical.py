"""Les octets signés d'une politique sont ceux que le poste recalcule.

Le runner (``secret-guard/packages/runner/src/policy-signature.ts``) canonicalise avec
``JSON.stringify`` : un caractère non ASCII y est écrit tel quel. La plateforme signait
avec ``json.dumps`` par défaut, qui l'échappait en ``\\uXXXX`` — un ``reason`` en français
suffisait pour que chaque poste refuse la signature. Ces tests fixent les octets, prouvent
que les enveloppes ASCII déjà publiées restent valides, et, quand un Node capable de lire
le TypeScript est présent, font vérifier la signature par le code du poste lui-même.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from core import developer_policies
from core.checkpoints import Ed25519Signer

_RUNNER = (
    Path(__file__).resolve().parents[1]
    / "secret-guard"
    / "packages"
    / "runner"
    / "src"
    / "policy-signature.ts"
)
_SIGNER = Ed25519Signer(bytes(range(32)))


def _body(reason: str) -> developer_policies.DeveloperPolicyBody:
    return developer_policies.DeveloperPolicyBody.model_validate(
        {
            "schemaVersion": 1,
            "policyId": "equipe",
            "version": 2,
            "issuedAt": "2026-09-01T00:00:00Z",
            "expiresAt": "2027-09-01T00:00:00Z",
            "defaults": {"unknownAction": "deny"},
            "rules": [
                {
                    "id": "no-prod-delete",
                    "effect": "deny",
                    "reason": reason,
                    "match": {"actionClasses": ["delete"]},
                }
            ],
        }
    )


_FRENCH = "Suppression interdite : dépôt de production — voir « procédure » ☢"
_TENANT = "00000000-0000-4000-8000-000000000001"


def _payload(reason: str) -> dict[str, Any]:
    return _body(reason).canonical_payload(_TENANT)


def test_non_ascii_characters_are_signed_as_raw_utf8() -> None:
    canonical = developer_policies._canonical(_payload(_FRENCH))
    expected = (
        '{"defaults":{"unknownAction":"deny"},"expiresAt":"2027-09-01T00:00:00Z",'
        '"issuedAt":"2026-09-01T00:00:00Z","minRunnerVersion":null,"policyId":"equipe",'
        '"rules":[{"effect":"deny","id":"no-prod-delete","match":{"actionClasses":["delete"],'
        '"assistants":null,"events":null,"resourcePrefixes":null,"tools":null},'
        f'"reason":"{_FRENCH}"}}],"schemaVersion":1,"tenantId":"{_TENANT}","version":2}}'
    ).encode("utf-8")
    assert canonical == expected
    assert b"\\u" not in canonical


def test_ascii_policies_keep_the_bytes_already_signed() -> None:
    """Une enveloppe publiée avant la correction se vérifie toujours."""
    payload = _payload("No production deletion")
    before = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    assert developer_policies._canonical(payload) == before
    signature = _SIGNER.sign(before)
    public = Ed25519PublicKey.from_public_bytes(base64.b64decode(_SIGNER.public_key))
    public.verify(signature, developer_policies._canonical(payload))


def test_signed_envelope_verifies_against_the_raw_utf8_bytes() -> None:
    envelope = developer_policies.sign(_body(_FRENCH), _TENANT, _SIGNER)
    public = Ed25519PublicKey.from_public_bytes(base64.b64decode(envelope["publicKey"]))
    raw = json.dumps(
        envelope["policy"], sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    public.verify(base64.b64decode(envelope["signature"]), raw)


def _node() -> str | None:
    node = shutil.which("node")
    if node is None:
        return None
    probe = subprocess.run(
        [node, "--experimental-strip-types", "--no-warnings", "-e", "0"],
        capture_output=True,
        check=False,
    )
    return node if probe.returncode == 0 else None


def test_the_workstation_runner_accepts_a_french_policy(tmp_path: Path) -> None:
    node = _node()
    if node is None:
        pytest.skip("Node sans lecture directe du TypeScript (>= 22.6 requis)")
    envelope = developer_policies.sign(_body(_FRENCH), _TENANT, _SIGNER)
    script = tmp_path / "verify.mjs"
    script.write_text(
        "const m = await import(process.argv[2]);\n"
        "const e = JSON.parse(process.argv[3]);\n"
        "process.stdout.write(String("
        "m.verifyPolicySignature(e.policy, e.signature, e.publicKey)));\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            node,
            "--experimental-strip-types",
            "--no-warnings",
            str(script),
            _RUNNER.as_uri(),
            json.dumps(envelope, ensure_ascii=False),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "true"
