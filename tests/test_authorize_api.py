"""Control API: gateway-token minting + the cooperative /v1/authorize flow."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

POLICY_YAML = """tools:
  - {name: mock.echo, class: read, approval: auto}
  - name: mock.mail
    class: external_send
    approval: human_in_the_loop
defaults:
  unknown_tool: deny
"""


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return tid


def test_mint_authorize_and_hitl_flow(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    operator = make_token(tenant_id=tid, role="operator")

    assert (
        client.put("/v1/policy", headers=_auth(admin), json={"yaml": POLICY_YAML}).status_code
        == 200
    )

    created = client.post("/v1/gateway-tokens", headers=_auth(admin), json={"name": "uti-agent"})
    assert created.status_code == 201
    raw = created.json()["token"]
    assert raw.startswith("xsg_")
    # The metadata listing never leaks the raw secret.
    listed = client.get("/v1/gateway-tokens", headers=_auth(admin)).json()
    assert listed[0]["name"] == "uti-agent" and "token" not in listed[0]

    gw = {"X-Gateway-Token": raw}

    # read -> allow
    allow = client.post(
        "/v1/authorize", headers=gw, json={"tool": "mock.echo", "arguments": {"t": "hi"}}
    )
    assert allow.status_code == 200 and allow.json()["decision"] == "allow"

    # external_send -> hold, surfaces in the approval queue
    held = client.post(
        "/v1/authorize", headers=gw, json={"tool": "mock.mail", "arguments": {"to": "x@client.fr"}}
    )
    assert held.status_code == 200 and held.json()["decision"] == "hold"
    approval_id = held.json()["approval_id"]
    queue = client.get("/v1/approvals?status=pending", headers=_auth(operator)).json()
    assert approval_id in [a["id"] for a in queue]

    # poll pending, approve, poll allow
    assert client.get(f"/v1/authorize/{approval_id}", headers=gw).json()["decision"] == "hold"
    decided = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(operator),
        json={"decision": "approve"},
    )
    assert decided.status_code == 200
    polled = client.get(f"/v1/authorize/{approval_id}", headers=gw)
    assert polled.status_code == 200 and polled.json()["decision"] == "allow"


def test_missing_or_invalid_gateway_token_denies(
    db: DBHandle, test_verifier: TokenVerifier
) -> None:
    client = _client(db.url, test_verifier)
    body = {"tool": "x", "arguments": {}}
    assert client.post("/v1/authorize", json=body).status_code == 401
    assert (
        client.post("/v1/authorize", headers={"X-Gateway-Token": "xsg_nope"}, json=body).status_code
        == 401
    )
    assert (
        client.get(f"/v1/authorize/{uuid4()}", headers={"X-Gateway-Token": "xsg_nope"}).status_code
        == 401
    )


def test_revoked_token_is_refused(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    created = client.post("/v1/gateway-tokens", headers=_auth(admin), json={"name": "k"}).json()
    raw, token_id = created["token"], created["id"]
    body = {"tool": "x", "arguments": {}}

    assert (
        client.post("/v1/authorize", headers={"X-Gateway-Token": raw}, json=body).status_code == 200
    )
    assert client.delete(f"/v1/gateway-tokens/{token_id}", headers=_auth(admin)).status_code == 204
    assert (
        client.post("/v1/authorize", headers={"X-Gateway-Token": raw}, json=body).status_code == 401
    )


def test_gateway_token_endpoints_are_admin_only(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    operator = make_token(tenant_id=tid, role="operator")
    assert (
        client.post("/v1/gateway-tokens", headers=_auth(operator), json={"name": "k"}).status_code
        == 403
    )
    assert client.get("/v1/gateway-tokens", headers=_auth(operator)).status_code == 403
