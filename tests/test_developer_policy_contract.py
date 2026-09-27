"""Shared Developer Guard policy vectors must agree in Python and TypeScript."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from core import developer_policies
from core.checkpoints import Ed25519Signer

FIXTURE = (
    Path(__file__).parents[1] / "secret-guard" / "contracts" / "fixtures" / "policy-vectors.json"
)


def test_shared_policy_vectors() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    policy = developer_policies.DeveloperPolicyBody.model_validate(fixture["policy"])
    now = datetime(2026, 9, 22, tzinfo=UTC)
    for vector in fixture["vectors"]:
        request = developer_policies.DeveloperActionRequest.model_validate(vector["request"])
        assert developer_policies.evaluate(policy, request, now) == vector["effect"], vector["name"]


def test_contract_rejects_unknown_versions_and_fields() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))["policy"]
    with pytest.raises(ValidationError):
        developer_policies.DeveloperPolicyBody.model_validate({**fixture, "schemaVersion": 2})
    with pytest.raises(ValidationError):
        developer_policies.DeveloperPolicyBody.model_validate({**fixture, "projectOverride": True})


_SCHEMA = FIXTURE.parent.parent / "policy.schema.json"


def _vectors() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return loaded


def test_workstation_cap_vectors_agree_with_the_json_schema() -> None:
    """Pydantic, ``policy.schema.json`` et le runner du poste lisent les mêmes vecteurs."""
    jsonschema = pytest.importorskip("jsonschema")
    validator = jsonschema.Draft202012Validator(json.loads(_SCHEMA.read_text(encoding="utf-8")))
    fixture = _vectors()
    base = fixture["policy"]
    for value in fixture["workstation"]["valid"]:
        candidate = {**base, "workstation": value}
        assert validator.is_valid(candidate), value
        body = developer_policies.DeveloperPolicyBody.model_validate(candidate)
        assert body.workstation is not None
        assert body.workstation.observe_max_minutes == value["observeMaxMinutes"]
    for vector in fixture["workstation"]["invalid"]:
        candidate = {**base, "workstation": vector["value"]}
        assert not validator.is_valid(candidate), vector["name"]
        with pytest.raises(ValidationError):
            developer_policies.DeveloperPolicyBody.model_validate(candidate)


def test_the_platform_signs_the_capped_envelope_byte_for_byte() -> None:
    """L'enveloppe figée que ``tests/runner/policy-workstation.test.ts`` vérifie."""
    vector = _vectors()["signature"]
    body = developer_policies.DeveloperPolicyBody.model_validate(vector["body"])
    envelope = developer_policies.sign(body, vector["tenantId"], Ed25519Signer(bytes(range(32))))
    assert envelope == vector["envelope"]
    assert developer_policies._canonical(envelope["policy"]) == vector["canonical"].encode("utf-8")
    assert envelope["policy"]["workstation"] == {"observeMaxMinutes": 60}


def test_a_cap_raises_the_runner_floor_so_older_workstations_refuse_it() -> None:
    base = _vectors()["policy"]
    capped = {**base, "workstation": {"observeMaxMinutes": 0}}

    def floor(extra: dict[str, Any]) -> str | None:
        body = developer_policies.DeveloperPolicyBody.model_validate({**capped, **extra})
        return body.min_runner_version

    assert developer_policies.WORKSTATION_MIN_RUNNER == "0.7.1"
    assert floor({}) == "0.7.1"
    assert floor({"minRunnerVersion": "0.6.0"}) == "0.7.1"
    assert floor({"minRunnerVersion": "0.9.2"}) == "0.9.2"
    with pytest.raises(ValidationError):
        floor({"minRunnerVersion": "latest"})
    uncapped = developer_policies.DeveloperPolicyBody.model_validate(base)
    assert uncapped.min_runner_version is None
    assert "workstation" not in uncapped.canonical_payload("tenant-a")


def test_the_extension_that_applies_the_cap_meets_the_floor_the_platform_sets() -> None:
    """Le plancher ``minRunnerVersion`` désigne une extension qui existe dans ce dépôt."""
    manifest = json.loads(
        (FIXTURE.parents[2] / "packages" / "vscode" / "package.json").read_text(encoding="utf-8")
    )
    shipped = tuple(int(part) for part in manifest["version"].split("."))
    floor = tuple(int(part) for part in developer_policies.WORKSTATION_MIN_RUNNER.split("."))
    assert shipped >= floor
