"""Policy signing, tenant isolation, assignment and workstation retrieval."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import developer_policies, tenant_tokens
from core.config import Settings
from tests.conftest import DBHandle


def _seed() -> str:
    return base64.b64encode(bytes(range(32))).decode("ascii")


def _client(db: DBHandle, verifier: TokenVerifier) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None,
            env="dev",
            database_url=db.url,
            developer_policy_signing_key=_seed(),
        )
    )
    app.state.verifier = verifier
    return TestClient(app)


def _payload(policy_id: str, version: int = 1) -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "schemaVersion": 1,
        "policyId": policy_id,
        "version": version,
        "issuedAt": (now - timedelta(minutes=1)).isoformat(),
        "expiresAt": (now + timedelta(hours=1)).isoformat(),
        "defaults": {"unknownAction": "deny"},
        "rules": [],
    }


def test_published_policy_is_signed_assigned_and_scoped_to_the_workstation(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id,name) values (%s,'Developer Guard')", (tenant,))
    raw, gateway = tenant_tokens.mint(db.conn, tenant_id=tenant, name="developer-laptop")
    db.conn.commit()
    client = _client(db, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    device_id = str(uuid4())
    registered = client.post(
        "/v1/extension/register",
        headers={"X-Gateway-Token": raw},
        json={
            "installation_id": device_id,
            "platform": "linux",
            "extension_version": "0.6.0",
            "mode": "block",
        },
    )
    assert registered.status_code == 200
    created = client.put(
        "/v1/developer-policies/team-default",
        headers=admin,
        json=_payload("team-default"),
    )
    assert created.status_code == 200, created.text
    envelope = created.json()
    assert envelope["policy"]["tenantId"] == tenant
    assert envelope["signature"] and envelope["publicKey"]
    assigned = client.post(
        "/v1/developer-policies/team-default/assign/" + device_id,
        headers=admin,
    )
    assert assigned.status_code == 204
    fetched = client.get("/v1/extension/policy", headers={"X-Gateway-Token": raw})
    assert fetched.status_code == 200
    assert fetched.json()["signature"] == envelope["signature"]
    assert client.delete("/v1/developer-policies/team-default", headers=admin).status_code == 204
    assert client.get("/v1/extension/policy", headers={"X-Gateway-Token": raw}).status_code == 404
    db.conn.execute("update gateway_tokens set revoked_at=now() where id=%s", (gateway["id"],))
    db.conn.commit()
    assert client.get("/v1/extension/policy", headers={"X-Gateway-Token": raw}).status_code == 401


def test_policy_signer_rejects_a_missing_key() -> None:
    body = developer_policies.DeveloperPolicyBody.model_validate(_payload("safe"))
    try:
        developer_policies.signer(Settings(_env_file=None, env="dev"))
    except developer_policies.DeveloperPolicyError:
        return
    raise AssertionError(f"signer unexpectedly accepted {body.policy_id}")


def test_policy_rejects_malformed_rules_and_non_increasing_versions(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant = str(uuid4())
    db.conn.execute(
        "insert into tenants (id,name) values (%s,'Developer Guard validation')", (tenant,)
    )
    db.conn.commit()
    client = _client(db, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    malformed = _payload("strict")
    malformed["rules"] = [{"id": "untrusted", "effect": "explode", "match": {}}]
    malformed_result = client.put("/v1/developer-policies/strict", headers=admin, json=malformed)
    assert malformed_result.status_code == 422
    created = client.put("/v1/developer-policies/strict", headers=admin, json=_payload("strict", 2))
    assert created.status_code == 200
    stale = client.put("/v1/developer-policies/strict", headers=admin, json=_payload("strict", 2))
    assert stale.status_code == 409


def test_workstation_approval_is_bound_to_device_policy_action_and_single_use(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id,name) values (%s,'Developer approvals')", (tenant,))
    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tenant, name="developer-laptop")
    db.conn.commit()
    client = _client(db, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    device_id = str(uuid4())
    assert (
        client.post(
            "/v1/extension/register",
            headers={"X-Gateway-Token": raw},
            json={
                "installation_id": device_id,
                "platform": "linux",
                "extension_version": "0.6.0",
                "mode": "block",
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/v1/developer-policies/team-default", headers=admin, json=_payload("team-default")
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/v1/developer-policies/team-default/assign/{device_id}", headers=admin
        ).status_code
        == 204
    )
    binding = "a" * 64
    request = {
        "requestId": str(uuid4()),
        "policyId": "team-default",
        "policyVersion": 1,
        "actionBinding": binding,
        "toolName": "Bash",
        "actionClass": "deploy",
    }
    queued = client.post(
        "/v1/extension/approvals/request", headers={"X-Gateway-Token": raw}, json=request
    )
    assert queued.status_code == 201, queued.text
    approval_id = queued.json()["approval_id"]
    assert queued.json()["status"] == "pending"
    # A different action binding cannot poll or consume this decision.
    wrong = client.post(
        f"/v1/extension/approvals/{approval_id}/consume",
        headers={"X-Gateway-Token": raw},
        json={**request, "actionBinding": "b" * 64},
    )
    assert wrong.status_code == 422  # consume payload deliberately permits no request fields
    wrong = client.post(
        f"/v1/extension/approvals/{approval_id}/consume",
        headers={"X-Gateway-Token": raw},
        json={
            "policyId": "team-default",
            "policyVersion": 1,
            "actionBinding": "b" * 64,
        },
    )
    assert wrong.status_code == 404
    assert (
        client.post(
            f"/v1/approvals/{approval_id}/decision", headers=admin, json={"decision": "approve"}
        ).status_code
        == 200
    )
    consumed = client.post(
        f"/v1/extension/approvals/{approval_id}/consume",
        headers={"X-Gateway-Token": raw},
        json={
            "policyId": "team-default",
            "policyVersion": 1,
            "actionBinding": binding,
        },
    )
    assert consumed.status_code == 200 and consumed.json()["status"] == "consumed"
    replay = client.post(
        f"/v1/extension/approvals/{approval_id}/consume",
        headers={"X-Gateway-Token": raw},
        json={
            "policyId": "team-default",
            "policyVersion": 1,
            "actionBinding": binding,
        },
    )
    assert replay.status_code == 200 and replay.json()["status"] == "approved"


def test_publishing_a_policy_without_a_signing_key_fails_closed(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    """Route comprise : sans graine, 503 et aucune ligne, jamais une politique non signée."""
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id,name) values (%s,'Sans clé')", (tenant,))
    db.conn.commit()
    app = create_app(Settings(_env_file=None, env="dev", database_url=db.url))
    app.state.verifier = test_verifier
    client = TestClient(app)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    refused = client.put(
        "/v1/developer-policies/sans-cle", headers=admin, json=_payload("sans-cle")
    )
    assert refused.status_code == 503
    rows = db.conn.execute(
        "select count(*) from developer_policies where tenant_id=%s", (tenant,)
    ).fetchone()
    assert rows == (0,)


def _capped(policy_id: str, cap: object, version: int = 1) -> dict[str, object]:
    return {**_payload(policy_id, version), "workstation": {"observeMaxMinutes": cap}}


def test_an_admin_caps_avertir_and_the_workstation_receives_it_signed(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    """Plafond d'Avertir : validé, signé, exigeant 0.7.1, résumé et distribué au poste."""
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id,name) values (%s,'Plafond Avertir')", (tenant,))
    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tenant, name="developer-laptop")
    db.conn.commit()
    client = _client(db, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='viewer')}"}
    device_id = str(uuid4())
    assert (
        client.post(
            "/v1/extension/register",
            headers={"X-Gateway-Token": raw},
            json={
                "installation_id": device_id,
                "platform": "darwin",
                "extension_version": "0.7.1",
                "mode": "redact",
            },
        ).status_code
        == 200
    )
    for invalid in (30, 720, -15, "60", True, None):
        refused = client.put(
            "/v1/developer-policies/equipe", headers=admin, json=_capped("equipe", invalid)
        )
        assert refused.status_code == 422, invalid
    refused_null = client.put(
        "/v1/developer-policies/equipe",
        headers=admin,
        json={**_payload("equipe"), "workstation": None},
    )
    assert refused_null.status_code == 422
    forbidden = client.put(
        "/v1/developer-policies/equipe", headers=viewer, json=_capped("equipe", 60)
    )
    assert forbidden.status_code == 403

    created = client.put("/v1/developer-policies/equipe", headers=admin, json=_capped("equipe", 60))
    assert created.status_code == 200, created.text
    envelope = created.json()
    assert envelope["policy"]["workstation"] == {"observeMaxMinutes": 60}
    assert envelope["policy"]["minRunnerVersion"] == developer_policies.WORKSTATION_MIN_RUNNER
    assert "null" not in json.dumps(envelope["policy"])
    public = Ed25519PublicKey.from_public_bytes(base64.b64decode(envelope["publicKey"]))
    public.verify(
        base64.b64decode(envelope["signature"]),
        developer_policies._canonical(envelope["policy"]),
    )

    uncapped = client.put("/v1/developer-policies/libre", headers=admin, json=_payload("libre"))
    assert uncapped.status_code == 200
    assert "workstation" not in uncapped.json()["policy"]
    forbid = client.put(
        "/v1/developer-policies/equipe", headers=admin, json=_capped("equipe", 0, version=2)
    )
    assert forbid.status_code == 200

    listed = {
        row["policy_id"]: row for row in client.get("/v1/developer-policies", headers=viewer).json()
    }
    assert listed["equipe"]["observe_max_minutes"] == 0
    assert listed["equipe"]["min_runner_version"] == "0.7.1"
    assert listed["equipe"]["version"] == 2
    assert listed["libre"]["observe_max_minutes"] is None
    assert listed["libre"]["min_runner_version"] is None

    assert (
        client.post(f"/v1/developer-policies/equipe/assign/{device_id}", headers=admin).status_code
        == 204
    )
    fetched = client.get("/v1/extension/policy", headers={"X-Gateway-Token": raw}).json()
    assert fetched["policy"]["workstation"] == {"observeMaxMinutes": 0}
    public.verify(
        base64.b64decode(fetched["signature"]),
        developer_policies._canonical(fetched["policy"]),
    )
