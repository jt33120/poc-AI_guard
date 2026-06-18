"""Client/project entity: CRUD, agent assignment, per-client rollups, filtering."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit, billing, usage
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'Acme')", (tid,))
    db.conn.commit()
    return tid


def _agent(db: DBHandle, tenant_id: str, name: str) -> str:
    gid = str(uuid4())
    db.conn.execute(
        "insert into gateway_tokens (id, tenant_id, name, token_hash) values (%s, %s, %s, %s)",
        (gid, tenant_id, name, f"h-{gid}"),
    )
    db.conn.commit()
    return gid


def test_client_crud_and_assignment_and_rollup(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    gid = _agent(db, tid, "uti-bot")
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")

    # Create a client/project with a website.
    created = client.post(
        "/v1/clients",
        headers=_auth(admin),
        json={"name": "UTI", "website": "https://uti.example"},
    )
    assert created.status_code == 201
    cid = created.json()["id"]
    assert created.json()["website"] == "https://uti.example"

    # Attach the agent to the client.
    assigned = client.post(
        "/v1/clients/assign", headers=_auth(admin), json={"token_id": gid, "client_id": cid}
    )
    assert assigned.status_code == 204

    # Seed real-shaped data for that agent, then check the per-client rollup.
    usage.record_usage(
        db.conn,
        tenant_id=tid,
        gateway_token_id=gid,
        provider="openrouter",
        model="openai/gpt-4o-mini",
        prompt_tokens=1000,
        completion_tokens=500,
        cost_usd=0.001,
    )
    billing.record_billed(
        db.conn,
        tenant_id=tid,
        gateway_token_id=gid,
        provider="openrouter",
        source="openrouter_inline",
        model="openai/gpt-4o-mini",
        amount_usd=0.0012,
        external_id="gen-1",
    )
    audit.log_event(db.conn, tenant_id=tid, decision="allow", tool_name="x", gateway_token_id=gid)
    db.conn.commit()

    rows = client.get("/v1/clients", headers=_auth(admin)).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "UTI" and row["agents"] == 1 and row["actions"] == 1
    assert row["tokens"] == 1500
    assert round(row["billed_cost_usd"], 4) == 0.0012

    # Update the website; archive removes it from the list.
    client.patch(f"/v1/clients/{cid}", headers=_auth(admin), json={"website": "https://uti.fr"})
    assert client.get("/v1/clients", headers=_auth(admin)).json()[0]["website"] == "https://uti.fr"
    assert client.delete(f"/v1/clients/{cid}", headers=_auth(admin)).status_code == 204
    assert client.get("/v1/clients", headers=_auth(admin)).json() == []


def test_usage_and_audit_filter_by_client(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    g1, g2 = _agent(db, tid, "a1"), _agent(db, tid, "a2")
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    cid = client.post("/v1/clients", headers=_auth(admin), json={"name": "C1"}).json()["id"]
    client.post("/v1/clients/assign", headers=_auth(admin), json={"token_id": g1, "client_id": cid})

    for gid, cost in ((g1, 0.01), (g2, 0.05)):
        usage.record_usage(
            db.conn,
            tenant_id=tid,
            gateway_token_id=gid,
            provider="openai",
            model="gpt-4o",
            prompt_tokens=100,
            completion_tokens=50,
            cost_usd=cost,
        )
        audit.log_event(
            db.conn, tenant_id=tid, decision="allow", tool_name="t", gateway_token_id=gid
        )
    db.conn.commit()

    everything = client.get("/v1/usage", headers=_auth(admin)).json()
    assert everything["calls"] == 2
    scoped = client.get(f"/v1/usage?client_id={cid}", headers=_auth(admin)).json()
    assert scoped["calls"] == 1 and round(scoped["total_cost_usd"], 4) == 0.01

    audit_scoped = client.get(f"/v1/audit?client_id={cid}", headers=_auth(admin)).json()
    assert len(audit_scoped) == 1


def test_clients_admin_only_and_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    a, b = _tenant(db), _tenant(db)
    client = _client(db.url, test_verifier)
    # viewer cannot create
    assert (
        client.post(
            "/v1/clients", headers=_auth(make_token(tenant_id=a, role="viewer")), json={"name": "X"}
        ).status_code
        == 403
    )
    # tenant A's client is invisible to tenant B
    client.post(
        "/v1/clients", headers=_auth(make_token(tenant_id=a, role="admin")), json={"name": "A"}
    )
    assert (
        client.get("/v1/clients", headers=_auth(make_token(tenant_id=b, role="admin"))).json() == []
    )
