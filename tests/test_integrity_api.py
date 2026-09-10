"""Control API: MCP tool integrity view + approve (M10)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import integrity
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def _seed(db: DBHandle, tenant: str, *, server: str = "mock", tool: str = "echo") -> None:
    integrity.record_sighting(db.conn, tenant_id=tenant, server=server, tool_name=tool, fp="A")
    db.conn.commit()


def test_list_integrity_shows_pending_tool(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    _seed(db, tenant)
    client = _client(db.url, test_verifier)
    rows = client.get(
        "/v1/tools/integrity", headers=_auth(make_token(tenant_id=tenant, role="viewer"))
    )
    assert rows.status_code == 200
    body = rows.json()
    assert len(body) == 1
    assert body[0]["tool_name"] == "echo" and body[0]["status"] == "new"


def test_list_integrity_is_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    _seed(db, tenant)
    client = _client(db.url, test_verifier)
    # Un tenant que la base ne connaît pas n'a aucune capacité (`load_entitlement`
    # retombe sur `AUCUNE`, jamais sur `free`) : il est arrêté avant la route. Plus
    # tôt et plus fort que « RLS lui rend zéro ligne », qui reste vrai en dessous.
    inconnu = make_token(tenant_id=str(uuid4()), role="viewer")
    assert client.get("/v1/tools/integrity", headers=_auth(inconnu)).status_code == 402

    # Et l'isolation d'origine, sur un tenant qui existe : c'est RLS qui répond.
    voisin = _tenant(db)
    jeton = make_token(tenant_id=voisin, role="viewer")
    assert client.get("/v1/tools/integrity", headers=_auth(jeton)).json() == []


def test_admin_approve_rebaselines_tool(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    _seed(db, tenant)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")

    r = client.post("/v1/tools/mock/echo/approve", headers=_auth(admin))
    assert r.status_code == 200 and r.json()["approved"] is True

    rows = client.get("/v1/tools/integrity", headers=_auth(admin)).json()
    assert rows[0]["status"] == "ok" and rows[0]["approved"] is True


def test_approve_requires_admin(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    _seed(db, tenant)
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tenant, role="viewer")
    assert client.post("/v1/tools/mock/echo/approve", headers=_auth(viewer)).status_code == 403


def test_approve_unknown_tool_returns_404(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    assert client.post("/v1/tools/ghost/nope/approve", headers=_auth(admin)).status_code == 404
