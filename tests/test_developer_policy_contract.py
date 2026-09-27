"""Shared Developer Guard policy vectors must agree in Python and TypeScript."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from core import developer_policies

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
