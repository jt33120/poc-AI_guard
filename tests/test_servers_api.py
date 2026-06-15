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
