"""Control API for downstream servers: CRUD, RBAC, and tenant isolation (M2)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

_STDIO = {"command": "python", "args": ["-m", "srv"]}


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_servers_crud_rbac_and_isolation(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant_a, tenant_b = uuid4(), uuid4()
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b)
    )
    db.conn.commit()

    client = _client(db.url, test_verifier)
    admin_a = make_token(tenant_id=str(tenant_a), role="admin")
    admin_b = make_token(tenant_id=str(tenant_b), role="admin")
    viewer_a = make_token(tenant_id=str(tenant_a), role="viewer")

    # Admin A creates a server.
    created = client.post(
        "/v1/servers",
        headers=_auth(admin_a),
        json={"name": "crm", "transport": "stdio", "config": _STDIO},
    )
    assert created.status_code == 201
    server = created.json()
    assert server["transport"] == "stdio" and server["enabled"] is True
    server_id = server["id"]

    # A sees it (RLS read); B sees nothing (isolation).
    assert [s["name"] for s in client.get("/v1/servers", headers=_auth(admin_a)).json()] == ["crm"]
    assert client.get("/v1/servers", headers=_auth(admin_b)).json() == []

    # Viewer cannot create (RBAC).
    forbidden = client.post(
        "/v1/servers",
        headers=_auth(viewer_a),
        json={"name": "x", "transport": "stdio", "config": _STDIO},
    )
    assert forbidden.status_code == 403

    # B cannot patch A's server (write scoped to tenant -> 404).
    assert (
        client.patch(
            f"/v1/servers/{server_id}", headers=_auth(admin_b), json={"enabled": False}
        ).status_code
        == 404
    )

    # A can patch its own server.
    patched = client.patch(
        f"/v1/servers/{server_id}", headers=_auth(admin_a), json={"enabled": False}
    )
    assert patched.status_code == 200 and patched.json()["enabled"] is False

    # Duplicate name -> 409.
    assert (
        client.post(
            "/v1/servers",
            headers=_auth(admin_a),
            json={"name": "crm", "transport": "stdio", "config": _STDIO},
        ).status_code
        == 409
    )


def test_create_rejects_invalid_transport_config(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="admin")
    # http transport requires config.url.
    response = client.post(
        "/v1/servers",
        headers=_auth(token),
        json={"name": "bad", "transport": "http", "config": {}},
    )
    assert response.status_code == 422


def test_create_refuses_a_downstream_url_pointed_at_our_own_infrastructure(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """FR-164: an admin cannot register a server that spends the gateway's position.

    The write-time half. Its value is that the bad row never exists; the row that
    already exists is caught at connect time (`tests/test_egress.py`).
    """
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="admin")

    for url in (
        "http://169.254.169.254/latest/meta-data/",  # cloud instance credentials
        "http://127.0.0.1:8000/v1/authorize",  # our own control API
        "file:///etc/passwd",  # not a fetch at all
    ):
        refused = client.post(
            "/v1/servers",
            headers=_auth(token),
            json={"name": "evil", "transport": "http", "config": {"url": url}},
        )
        assert refused.status_code == 422, url

    # The other half: a tool server on the tenant's own network is registered.
    created = client.post(
        "/v1/servers",
        headers=_auth(token),
        json={"name": "crm", "transport": "http", "config": {"url": "http://10.0.0.5:9000/mcp"}},
    )
    assert created.status_code == 201

    # And a PATCH cannot smuggle in what POST refused.
    patched = client.patch(
        f"/v1/servers/{created.json()['id']}",
        headers=_auth(token),
        json={"config": {"url": "http://169.254.169.254/latest/meta-data/"}},
    )
    assert patched.status_code == 422
