"""Agent overview + usage/cost endpoints: aggregation, agent filter, RLS."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit, billing, usage
from core.config import Settings
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed(db: DBHandle) -> tuple[str, str]:
    """One tenant 'UTI' with one agent 'bot'; 2 usage rows + 2 audit rows."""
    tid, gid = uuid4(), uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'UTI')", (tid,))
    db.conn.execute(
        "insert into gateway_tokens (id, tenant_id, name, token_hash) values (%s, %s, 'bot', %s)",
        (gid, tid, f"hash-{gid}"),
    )
    usage.record_usage(
        db.conn,
        tenant_id=str(tid),
        gateway_token_id=str(gid),
        provider="openai",
        model="gpt-4o",
        prompt_tokens=1000,
        completion_tokens=500,
        cost_usd=0.0075,
        request_id="r1",
    )
    usage.record_usage(
        db.conn,
        tenant_id=str(tid),
        gateway_token_id=str(gid),
        provider="anthropic",
        model="claude-3-5-sonnet",
        prompt_tokens=1000,
        completion_tokens=500,
        cost_usd=0.0105,
        request_id="r2",
    )
    audit.log_event(
        db.conn,
        tenant_id=str(tid),
        decision="allow",
        tool_name="crm.read",
        gateway_token_id=str(gid),
        origin=_ORIGIN,
    )
    # An unattributed (console) decision — no agent.
    audit.log_event(
        db.conn, tenant_id=str(tid), decision="deny", tool_name="crm.delete", origin=_ORIGIN
    )
    db.conn.commit()
    return str(tid), str(gid)


def test_agents_overview_rolls_up_actions_and_spend(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")  # viewer can see the selector

    ov = client.get("/v1/agents", headers=_auth(viewer)).json()
    assert ov["customer"] == "UTI"
    assert ov["agent_count"] == 1
    agent = ov["agents"][0]
    assert agent["id"] == gid
    assert agent["name"] == "bot"
    assert agent["actions"] == 1  # only the attributed audit row
    assert agent["tokens"] == 3000
    assert round(agent["spend_usd"], 4) == 0.018
    assert agent["revoked"] is False


def test_usage_summary_aggregates_and_filters_by_agent(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")

    us = client.get("/v1/usage", headers=_auth(viewer)).json()
    assert us["calls"] == 2
    assert us["total_tokens"] == 3000
    assert round(us["total_cost_usd"], 4) == 0.018
    assert {b["key"] for b in us["by_provider"]} == {"openai", "anthropic"}
    assert {b["key"] for b in us["by_agent"]} == {gid}
    assert len(us["daily"]) == 1

    # Filter to the agent (same totals); a different agent yields zero.
    scoped = client.get(f"/v1/usage?agent_id={gid}", headers=_auth(viewer)).json()
    assert scoped["calls"] == 2
    empty = client.get(f"/v1/usage?agent_id={uuid4()}", headers=_auth(viewer)).json()
    assert empty["calls"] == 0
    assert empty["total_cost_usd"] == 0.0


def test_audit_filter_by_agent(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")

    everything = client.get("/v1/audit", headers=_auth(viewer)).json()
    assert len(everything) == 2

    scoped = client.get(f"/v1/audit?agent_id={gid}", headers=_auth(viewer)).json()
    assert [e["tool_name"] for e in scoped] == ["crm.read"]
    assert scoped[0]["gateway_token_id"] == gid


def test_usage_includes_authoritative_billed_cost(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid, gid = _seed(db)
    billing.record_billed(
        db.conn,
        tenant_id=tid,
        gateway_token_id=gid,
        provider="openrouter",
        source="openrouter_inline",
        model="openai/gpt-4o-mini",
        amount_usd=0.5,
        external_id="gen-x",
    )
    db.conn.commit()
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")

    us = client.get("/v1/usage", headers=_auth(viewer)).json()
    assert round(us["billed_cost_usd"], 4) == 0.5  # exact, separate from the estimate
    scoped = client.get(f"/v1/usage?agent_id={gid}", headers=_auth(viewer)).json()
    assert round(scoped["billed_cost_usd"], 4) == 0.5
    empty = client.get(f"/v1/usage?agent_id={uuid4()}", headers=_auth(viewer)).json()
    assert empty["billed_cost_usd"] == 0.0


def test_usage_and_agents_are_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    _seed(db)
    client = _client(db.url, test_verifier)
    stranger = make_token(tenant_id=str(uuid4()), role="viewer")

    # Un tenant que la base ne connaît pas n'a aucune capacité (`load_entitlement`
    # retombe sur `AUCUNE`, jamais sur `free`), donc il est arrêté avant la route.
    # C'est plus tôt et plus fort que « RLS lui rend zéro ligne », qui restait vrai.
    assert client.get("/v1/usage", headers=_auth(stranger)).status_code == 402
    assert client.get("/v1/agents", headers=_auth(stranger)).status_code == 402

    # Et l'isolation d'origine, sur un tenant qui EXISTE et porte le bon palier :
    # c'est RLS qui répond, et il rend zéro.
    voisin = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'voisin')", (voisin,))
    db.conn.commit()
    jeton = make_token(tenant_id=voisin, role="viewer")
    assert client.get("/v1/usage", headers=_auth(jeton)).json()["calls"] == 0
    overview = client.get("/v1/agents", headers=_auth(jeton)).json()
    assert overview["agents"] == []
    assert overview["agent_count"] == 0
