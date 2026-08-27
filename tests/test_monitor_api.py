"""Control-plane routes for observation windows: RBAC, bounds, tenant isolation."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle


def _client(url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def test_admin_opens_and_closes_a_window(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    created = client.post(
        "/v1/monitor-windows", headers=admin, json={"gateway_token_id": "tok-1", "hours": 2}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["active"] is True and body["gateway_token_id"] == "tok-1"

    closed = client.delete(f"/v1/monitor-windows/{body['id']}", headers=admin)
    assert closed.status_code == 200
    assert closed.json()["active"] is False

    # The row stays: a period during which enforcement was relaxed is evidence.
    listed = client.get("/v1/monitor-windows", headers=admin).json()
    assert len(listed) == 1 and listed[0]["closed_at"] is not None


def test_reopening_extends_and_does_not_stack(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    first = client.post(
        "/v1/monitor-windows", headers=admin, json={"gateway_token_id": "t", "hours": 1}
    ).json()
    second = client.post(
        "/v1/monitor-windows", headers=admin, json={"gateway_token_id": "t", "hours": 6}
    ).json()

    assert second["id"] == first["id"]
    assert second["expires_at"] > first["expires_at"]
    assert len(client.get("/v1/monitor-windows", headers=admin).json()) == 1


def test_an_operator_may_not_relax_enforcement(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    # An operator deciding an approval judges one action; opening a window suspends
    # judgement on a whole agent for hours. That is an admin decision.
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    operator = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='operator')}"}

    resp = client.post(
        "/v1/monitor-windows", headers=operator, json={"gateway_token_id": "t", "hours": 1}
    )
    assert resp.status_code == 403


def test_a_viewer_may_read_but_not_open(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='viewer')}"}

    assert client.get("/v1/monitor-windows", headers=viewer).status_code == 200
    assert (
        client.post(
            "/v1/monitor-windows", headers=viewer, json={"gateway_token_id": "t", "hours": 1}
        ).status_code
        == 403
    )


def test_a_duration_beyond_the_ceiling_is_refused_and_names_it(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    resp = client.post(
        "/v1/monitor-windows", headers=admin, json={"gateway_token_id": "t", "hours": 100}
    )
    assert resp.status_code == 422
    assert "24" in resp.json()["detail"]  # names the ceiling, not a generic refusal


def test_a_window_is_not_visible_to_another_tenant(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    a, b = _tenant(db), _tenant(db)
    client = _client(db.url, test_verifier)
    admin_a = {"Authorization": f"Bearer {make_token(tenant_id=a, role='admin')}"}
    admin_b = {"Authorization": f"Bearer {make_token(tenant_id=b, role='admin')}"}

    created = client.post(
        "/v1/monitor-windows", headers=admin_a, json={"gateway_token_id": "t", "hours": 1}
    ).json()

    assert client.get("/v1/monitor-windows", headers=admin_b).json() == []
    # And B cannot close A's window by guessing its id.
    assert client.delete(f"/v1/monitor-windows/{created['id']}", headers=admin_b).status_code == 404


def test_anonymous_may_not_open_a_window(db: DBHandle, test_verifier: TokenVerifier) -> None:
    client = _client(db.url, test_verifier)
    assert client.post(
        "/v1/monitor-windows", json={"gateway_token_id": "t", "hours": 1}
    ).status_code in (401, 403)
