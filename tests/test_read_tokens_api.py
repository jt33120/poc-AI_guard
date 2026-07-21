"""Read-token admin API: mint (once) / list / revoke + RBAC."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'P')", (tid,))
    db.conn.commit()
    return tid


def test_mint_list_revoke(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    created = client.post("/v1/read-tokens", headers=admin, json={"name": "mip-rum"})
    assert created.status_code == 201
    body = created.json()
    assert body["token"].startswith("xsr_") and body["name"] == "mip-rum"
    token_id = body["id"]

    listed = client.get("/v1/read-tokens", headers=admin).json()
    assert [t["id"] for t in listed] == [token_id]
    assert "token" not in listed[0]  # never expose the raw secret on list

    assert client.delete(f"/v1/read-tokens/{token_id}", headers=admin).status_code == 204
    assert client.get("/v1/read-tokens", headers=admin).json()[0]["revoked_at"] is not None
    # Revoking an unknown id → 404.
    assert client.delete(f"/v1/read-tokens/{uuid4()}", headers=admin).status_code == 404


def test_viewer_cannot_mint(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='viewer')}"}
    assert client.post("/v1/read-tokens", headers=viewer, json={"name": "x"}).status_code == 403
