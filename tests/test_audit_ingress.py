"""FR-160 / INV-2 — the audit row says which door, and nobody outside chooses it.

The product ships three ingress paths whose guarantees are not the same: the MCP
gateway is mandatory, `/v1/authorize` is cooperative, and the LLM proxy removes a
tool call from a response rather than standing between the agent and the act.
`AD-28` requires a coverage claim to carry its ingress path — which the log could
not evidence while it did not record one.

The field the requirement is named after is `enforcement_mode`, and the point is
where its value comes from: the control plane, never the audited party. An agent
that could label how strongly it was audited would be grading its own paper.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
from core import monitor
from core.audit import EnforcementMode, Ingress, Origin
from core.config import Settings
from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle, mint_agent
from tests.test_llm_proxy import _FakeClient, _FakeResp

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"

_POLICY_YAML = """tools:
  - {name: mock.echo, class: read, approval: auto}
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals: {read: auto, write: human_in_the_loop}
"""

_PROXY_BODY = {
    "id": "chatcmpl-door",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "crm.update_contact", "arguments": "{}"},
                    }
                ],
            },
        }
    ],
}


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return tid


def _doors(db_url: str, tenant: str) -> list[tuple[str | None, str | None]]:
    with psycopg.connect(db_url) as check:
        return [
            (r[0], r[1])
            for r in check.execute(
                "select ingress, enforcement_mode from audit_log where tenant_id = %s",
                (tenant,),
            ).fetchall()
        ]


def test_origin_cannot_be_built_out_of_a_string() -> None:
    """The requirement, expressed where it cannot be forgotten.

    `Origin` has no constructor taking text. A value that cannot be parsed from
    untrusted input has no path from a request body into the audit row — which is
    a stronger statement than any validator, because there is nothing to validate.
    """
    assert not [name for name in dir(Origin) if name.startswith(("from_", "parse"))]
    assert Origin.mcp_gateway().enforcement_mode is EnforcementMode.enforcing
    assert Origin.llm_proxy(observing=True).enforcement_mode is EnforcementMode.observing
    assert Origin.llm_proxy(observing=False).enforcement_mode is EnforcementMode.enforcing


async def test_the_mandatory_door_records_itself(db: DBHandle) -> None:
    tenant = _tenant(db)
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    backend = PolicyBackend(
        parse_policy(_POLICY_YAML),
        proxy,
        ApprovalContext(database_url=db.url, tenant_id=tenant, timeout_seconds=60),
    )
    await backend.call_tool("echo", {"text": "hi"})
    assert _doors(db.url, tenant) == [(Ingress.mcp_gateway.value, EnforcementMode.enforcing.value)]


def test_the_cooperative_door_records_itself(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    auth = {"Authorization": f"Bearer {admin}"}
    assert client.put("/v1/policy", headers=auth, json={"yaml": _POLICY_YAML}).status_code == 200
    raw = client.post("/v1/gateway-tokens", headers=auth, json={"name": "a"}).json()["token"]

    assert (
        client.post(
            "/v1/authorize",
            headers={"X-Gateway-Token": raw},
            json={"tool": "mock.echo", "arguments": {}},
        ).status_code
        == 200
    )
    assert _doors(db.url, tenant) == [
        (Ingress.authorize_api.value, EnforcementMode.enforcing.value)
    ]


def test_an_agent_cannot_submit_the_field_that_grades_it(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Rejected explicitly, not ignored quietly — the difference INV-2 turns on.

    An ignored field reads to its sender as an accepted one. The agent walks away
    believing it set the label describing how strongly it was audited.
    """
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    auth = {"Authorization": f"Bearer {admin}"}
    assert client.put("/v1/policy", headers=auth, json={"yaml": _POLICY_YAML}).status_code == 200
    raw = client.post("/v1/gateway-tokens", headers=auth, json={"name": "a"}).json()["token"]

    for smuggled in ("enforcement_mode", "ingress"):
        refused = client.post(
            "/v1/authorize",
            headers={"X-Gateway-Token": raw},
            json={"tool": "mock.echo", "arguments": {}, smuggled: "observing"},
        )
        assert refused.status_code == 422, smuggled
    assert _doors(db.url, tenant) == []  # refused before any row was written


def test_the_proxy_door_takes_its_posture_from_the_control_plane(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The proxy forwards an arbitrary provider body, so `extra: forbid` cannot help.

    Its guarantee is of a different kind and has to be shown, not asserted: the
    value is read from the observation window, so a body that names it changes
    nothing — and opening a real window changes everything.
    """
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    auth = {"Authorization": f"Bearer {admin}"}
    assert client.put("/v1/policy", headers=auth, json={"yaml": _POLICY_YAML}).status_code == 200
    minted = client.post("/v1/gateway-tokens", headers=auth, json={"name": "bot"}).json()
    raw, token_id = minted["token"], minted["id"]

    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(_PROXY_BODY)))
    assert (
        client.post(
            "/proxy/openai/v1/chat/completions",
            headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-k"},
            # The agent asks to be graded leniently. It is forwarded to the provider,
            # which is what a proxy does, and it is not consulted here.
            json={"model": "gpt-4o", "messages": [], "enforcement_mode": "observing"},
        ).status_code
        == 200
    )
    assert _doors(db.url, tenant) == [(Ingress.llm_proxy.value, EnforcementMode.enforcing.value)]

    # Now an admin opens a real window on this agent, through the control plane.
    with psycopg.connect(db.url) as conn:
        monitor.open_window(
            conn,
            tenant_id=tenant,
            gateway_token_id=token_id,
            hours=1,
            max_hours=8,
            opened_by="op-1",
        )
        conn.commit()
    assert (
        client.post(
            "/proxy/openai/v1/chat/completions",
            headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-k"},
            json={"model": "gpt-4o", "messages": []},
        ).status_code
        == 200
    )
    assert (Ingress.llm_proxy.value, EnforcementMode.observing.value) in _doors(db.url, tenant)


# ---------------------------------------------------------------------------
# L'attribution sur la porte obligatoire
# ---------------------------------------------------------------------------
def _mcp_backend(db: DBHandle, tenant: str, token_id: str) -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    return PolicyBackend(
        parse_policy(_POLICY_YAML),
        proxy,
        ApprovalContext(
            database_url=db.url,
            tenant_id=tenant,
            timeout_seconds=60,
            gateway_token_id=token_id,
        ),
    )


async def test_every_mcp_audit_line_names_its_agent(db: DBHandle) -> None:
    """`AD-28` — le proxy LLM attribuait ses lignes, le gateway MCP non.

    La colonne existe depuis `0006` et le contexte porte l'identité à chaque appel :
    elle sert déjà au taint, à la fenêtre d'observation et à l'ordre d'arrêt. Seuls les
    deux sites d'audit ne la passaient pas, si bien que **toute** ligne du chemin
    obligatoire était anonyme.

    Ce n'était pas cosmétique. Trois fonctionnalités livrées lisent cette colonne : le
    compte d'actions par agent (`core/agents.py`), le compte par client
    (`core/clients.py`) et le filtre `agent` de l'explorateur d'audit
    (`core/audit.py`). Toutes rendaient zéro sur le gateway — et `scripts/seed_demo.py`
    écrit la colonne, donc la démonstration montrait une attribution que le produit ne
    produisait pas.
    """
    tenant = _tenant(db)
    token_id = mint_agent(db, tenant)
    backend = _mcp_backend(db, tenant, token_id)

    await backend.call_tool("echo", {"text": "hi"})  # relayé → `_audit`
    await backend.call_tool("inconnu", {})  # refusé → `_audit` sur un outil inconnu

    rows = db.conn.execute(
        "select decision, gateway_token_id from audit_log order by id"
    ).fetchall()
    assert rows, "aucune ligne d'audit : le test ne prouverait rien"
    anonymes = [r[0] for r in rows if r[1] is None]
    assert not anonymes, f"lignes anonymes sur la porte obligatoire : {anonymes}"
    assert {str(r[1]) for r in rows} == {token_id}


async def test_the_per_agent_action_count_sees_mcp_traffic(db: DBHandle) -> None:
    """La conséquence, mesurée là où un opérateur la regarde.

    `list_agents` joint `audit_log` sur `gateway_token_id` : elle comptait 0 action
    pour tout agent MCP, quelle que soit son activité.
    """
    from core import agents

    tenant = _tenant(db)
    token_id = mint_agent(db, tenant)
    await _mcp_backend(db, tenant, token_id).call_tool("echo", {"text": "hi"})

    listed = [a for a in agents.list_agents(db.conn) if a["id"] == token_id]
    assert len(listed) == 1
    assert listed[0]["actions"] >= 1
