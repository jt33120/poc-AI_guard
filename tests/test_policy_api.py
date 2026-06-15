"""Control API: policy GET/PUT (validation, RBAC, isolation) and /v1/tools (M3)."""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Json

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"

_VALID_POLICY = """
tools:
  - name: mock.echo
    class: read
    approval: auto
  - name: mock.delete_contact
    class: irreversible
    approval: deny
defaults:
  unknown_tool: deny
"""


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_policy_get_default_then_put_and_version_bump(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=str(tenant), role="admin")

    # No policy yet -> default at version 0.
    default = client.get("/v1/policy", headers=_auth(admin))
    assert default.status_code == 200 and default.json()["version"] == 0

    # PUT valid -> version 1, then 2.
    first = client.put("/v1/policy", headers=_auth(admin), json={"yaml": _VALID_POLICY})
    assert first.status_code == 200 and first.json()["version"] == 1
    second = client.put("/v1/policy", headers=_auth(admin), json={"yaml": _VALID_POLICY})
    assert second.json()["version"] == 2

    fetched = client.get("/v1/policy", headers=_auth(admin))
    assert fetched.json()["version"] == 2 and "mock.echo" in fetched.json()["yaml"]


def test_put_invalid_policy_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=str(tenant), role="admin")
    response = client.put(
        "/v1/policy",
        headers=_auth(admin),
        json={"yaml": "tools:\n  - name: t\n    approval: nonsense\n"},
    )
    assert response.status_code == 422


def test_put_policy_requires_admin(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=str(tenant), role="viewer")
    response = client.put("/v1/policy", headers=_auth(viewer), json={"yaml": _VALID_POLICY})
    assert response.status_code == 403


def test_tools_endpoint_reports_effective_class(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.execute(
        "insert into downstream_servers (tenant_id, name, transport, config) "
        "values (%s, 'mock', 'stdio', %s)",
        (tenant, Json({"command": sys.executable, "args": [str(_MOCK)]})),
    )
    db.conn.commit()
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=str(tenant), role="admin")
    client.put("/v1/policy", headers=_auth(admin), json={"yaml": _VALID_POLICY})

    tools = {t["name"]: t for t in client.get("/v1/tools", headers=_auth(admin)).json()}
    assert tools["echo"]["action_class"] == "read"
    assert tools["echo"]["decision"] == "auto"
    assert tools["delete_contact"]["action_class"] == "irreversible"
    assert tools["delete_contact"]["decision"] == "deny"
