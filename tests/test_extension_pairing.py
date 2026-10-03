"""Browser authorization, scoped device credentials, presence, expiry and real RLS."""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

import psycopg
import pytest

from api.security import TokenVerifier
from core import db as database
from core import tenant_tokens
from tests.conftest import DBHandle
from tests.test_llm_proxy import _client, _tenant


def _start(client, installation=None):
    credential = tenant_tokens.generate_token()
    body = {
        "installation_id": installation or str(uuid4()),
        "platform": "darwin",
        "extension_version": "0.6.2",
        "mode": "block",
        "credential_hash": tenant_tokens.hash_token(credential),
    }
    response = client.post("/v1/extension-enrollment/start", json=body)
    assert response.status_code == 201, response.text
    assert credential not in response.text
    return credential, body, response.json()["code"]


def _access(db, tenant, seats=10):
    db.conn.execute(
        "insert into tenant_product_access (tenant_id,product,status,edition,seats) "
        "values (%s,'secret_guard','internal','Équipe',%s)",
        (tenant, seats),
    )
    db.conn.commit()


def test_browser_confirmation_and_independent_workstation_presence(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant, other = _tenant(db), _tenant(db)
    _access(db, tenant)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    credential, registration, code = _start(client)
    headers = {"X-Gateway-Token": credential}
    assert client.post("/v1/extension-enrollment/status", headers=headers).json() == {
        "status": "pending"
    }
    assert client.get("/v1/extensions/enrollment", params={"code": code}).status_code == 401
    info = client.get("/v1/extensions/enrollment", params={"code": code}, headers=admin)
    assert info.json()["platform"] == "darwin"
    payload = {
        "code": code,
        "name": "Mac de test",
        "member_label": "Membre test",
        "team": "Produit",
    }
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='viewer')}"}
    assert client.post("/v1/extensions/enrollment", json=payload, headers=viewer).status_code == 403
    confirmed = client.post("/v1/extensions/enrollment", json=payload, headers=admin)
    assert confirmed.status_code == 200, confirmed.text
    assert client.post("/v1/extensions/enrollment", json=payload, headers=admin).status_code == 410
    result = client.post("/v1/extension-enrollment/status", headers=headers).json()
    assert result["organization"]["id"] == tenant
    assert result["device_id"] == registration["installation_id"]
    assert "token" not in result
    registration.pop("credential_hash")
    assert (
        client.post("/v1/extension/register", json=registration, headers=headers).status_code == 200
    )
    db.conn.execute("update extension_devices set last_seen_at=now()-interval '5 minutes'")
    db.conn.commit()
    assert client.get("/v1/extensions/devices", headers=admin).json()[0]["presence"] == "stale"
    heartbeat = {
        "events": [
            {
                "event_id": str(uuid4()),
                "at": datetime.now(UTC).isoformat(),
                "kind": "heartbeat",
                "assistant": "secretguard",
                "mode": "block",
                "outcome": "configured",
            }
        ]
    }
    assert client.post("/v1/extension/events", json=heartbeat, headers=headers).status_code == 200
    inventory = client.get("/v1/extensions/devices", headers=admin).json()
    assert len(inventory) == 1
    assert inventory[0]["presence"] == "recent"
    assert inventory[0]["member_label"] == "Membre test"
    assert inventory[0]["team"] == "Produit"
    assert inventory[0]["mode"] == "block"
    assert client.get("/v1/agents", headers=admin).json()["agents"] == []
    # A workstation token does not become a production agent or a console session.
    with pytest.raises(PermissionError):
        tenant_tokens.authenticate_gateway_session(db.conn, credential)
    assert client.post("/v1/authorize", json={}, headers=headers).status_code == 401
    assert client.get("/v1/extensions/devices", headers=headers).status_code == 401
    alien = {"Authorization": f"Bearer {make_token(tenant_id=other, role='admin')}"}
    assert client.get("/v1/extensions/devices", headers=alien).json() == []
    with database.tenant_reader(db.url, user_id=str(uuid4()), tenant_id=other) as conn:
        assert conn.execute("select id from extension_devices").fetchall() == []
        with pytest.raises(psycopg.errors.InsufficientPrivilege), conn.transaction():
            conn.execute("select * from extension_pairings")
    db.conn.execute(
        "update gateway_tokens set revoked_at=now() where token_hash=%s",
        (tenant_tokens.hash_token(credential),),
    )
    db.conn.commit()
    assert client.post("/v1/extension/events", json=heartbeat, headers=headers).status_code == 401
    assert client.get("/v1/extensions/devices", headers=admin).json()[0]["presence"] == "revoked"


def test_expiry_missing_access_seats_and_credential_proof(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    credential, _, code = _start(client)
    payload = {"code": code, "name": "Mac de test"}
    assert client.post("/v1/extensions/enrollment", json=payload, headers=admin).status_code == 403
    _access(db, tenant, seats=1)
    assert client.post("/v1/extensions/enrollment", json=payload, headers=admin).status_code == 200
    wrong = {"X-Gateway-Token": tenant_tokens.generate_token()}
    assert client.post("/v1/extension-enrollment/status", headers=wrong).status_code == 410
    _, _, second = _start(client)
    assert (
        client.post(
            "/v1/extensions/enrollment", json={**payload, "code": second}, headers=admin
        ).status_code
        == 403
    )
    db.conn.execute("update extension_pairings set expires_at=now()-interval '1 second'")
    db.conn.commit()
    assert (
        client.post(
            "/v1/extension-enrollment/status", headers={"X-Gateway-Token": credential}
        ).status_code
        == 410
    )
    assert (
        client.post(
            "/v1/extensions/enrollment", json={**payload, "code": second}, headers=admin
        ).status_code
        == 410
    )
    assert db.conn.execute("select count(*) from gateway_tokens").fetchone() == (1,)


def test_cancellation_disconnect_and_reenrollment_keep_identity_and_tenant(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
) -> None:
    tenant, other = _tenant(db), _tenant(db)
    _access(db, tenant, seats=1)
    _access(db, other)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    alien = {"Authorization": f"Bearer {make_token(tenant_id=other, role='admin')}"}
    credential, registration, code = _start(client)
    headers = {"X-Gateway-Token": credential}
    wrong = {"X-Gateway-Token": tenant_tokens.generate_token()}
    assert client.post("/v1/extension-enrollment/cancel", headers=wrong).status_code == 200
    assert client.post("/v1/extension-enrollment/status", headers=headers).status_code == 200
    assert client.post("/v1/extension-enrollment/cancel", headers=headers).status_code == 200
    assert client.post("/v1/extension-enrollment/status", headers=headers).status_code == 410
    assert (
        client.post(
            "/v1/extensions/enrollment", json={"code": code, "name": "Annulé"}, headers=admin
        ).status_code
        == 410
    )

    def confirm(code, headers=admin):
        return client.post(
            "/v1/extensions/enrollment", json={"code": code, "name": "Mac test"}, headers=headers
        )

    installation = registration["installation_id"]
    credential, _, code = _start(client, installation)
    headers = {"X-Gateway-Token": credential}
    assert confirm(code).status_code == 200
    _, _, duplicate = _start(client, installation)
    assert confirm(duplicate).status_code == 409  # Active binding cannot be replaced.
    assert client.post("/v1/extension/disconnect", headers=wrong).status_code == 401
    assert client.post("/v1/extension/disconnect", headers=headers).status_code == 200
    assert client.post("/v1/extension/disconnect", headers=headers).status_code == 401
    assert client.get("/v1/extensions/devices", headers=admin).json()[0]["presence"] == "revoked"
    assert confirm(duplicate, alien).status_code == 409  # Even revoked: no tenant transfer.
    assert confirm(duplicate).status_code == 200  # Released seat + same inventory row.
    assert db.conn.execute("select count(*) from extension_devices").fetchone() == (1,)
    # Cancelling after confirmation also revokes the credential if the extension
    # failed before saving it. It cannot leave an unreachable active seat.
    new_hash = db.conn.execute(
        "select credential_hash from extension_pairings where code_hash=%s",
        (tenant_tokens.hash_token(duplicate),),
    ).fetchone()[0]
    assert db.conn.execute(
        "select revoked_at from gateway_tokens where token_hash=%s", (new_hash,)
    ).fetchone() == (None,)


def test_cancel_after_confirmation_releases_seat(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    _access(db, tenant, seats=1)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    credential, _, code = _start(client)
    assert (
        client.post(
            "/v1/extensions/enrollment", json={"code": code, "name": "Mac test"}, headers=admin
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/v1/extension-enrollment/cancel", headers={"X-Gateway-Token": credential}
        ).status_code
        == 200
    )
    assert client.get("/v1/extensions/devices", headers=admin).json()[0]["presence"] == "revoked"


def test_pairing_poll_limit_partitions_by_proof_not_console_ip():
    from starlette.requests import Request

    from api.extension_pairing import _pairing_key

    def request(proof: str) -> Request:
        return Request(
            {
                "type": "http",
                "client": ("127.0.0.1", 80),
                "headers": [(b"x-gateway-token", proof.encode())],
            }
        )

    first = _pairing_key(request("synthetic-proof-one"))
    assert first != _pairing_key(request("synthetic-proof-two"))
    assert first == _pairing_key(request("synthetic-proof-one"))
    assert "synthetic-proof" not in first
