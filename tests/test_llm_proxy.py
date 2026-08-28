"""LLM monitoring proxy: tool-call extraction + audit of a forwarded response."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
from core import monitor
from core.config import Settings
from tests.conftest import DBHandle

AUTO_POLICY = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: auto
    external_send: human_in_the_loop
    irreversible: human_in_the_loop
"""

# A policy that HOLDS a write -- so an observation window has something it may
# legitimately relax. Under AUTO_POLICY a write is auto-allowed, which would prove
# nothing about the window.
WRITE_POLICY = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: human_in_the_loop
    external_send: human_in_the_loop
    irreversible: human_in_the_loop
"""

WRITE_BODY = {
    "id": "chatcmpl-write",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call_w",
                        "type": "function",
                        "function": {"name": "crm.update_contact", "arguments": '{"id": 9}'},
                    }
                ],
            },
        }
    ],
}

# A canned OpenAI chat-completion the model "returned", asking for two tools.
UPSTREAM_BODY = {
    "id": "chatcmpl-test",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "crm.delete_contact", "arguments": '{"id": 42}'},
                    },
                    {
                        "id": "call_2",
                        "type": "function",
                        "function": {"name": "crm.get_contact", "arguments": '{"id": 7}'},
                    },
                ],
            },
        }
    ],
}


def test_extract_tool_calls_handles_messy_input() -> None:
    assert llm_proxy._extract_tool_calls(UPSTREAM_BODY) == [
        ("crm.delete_contact", {"id": 42}),
        ("crm.get_contact", {"id": 7}),
    ]
    # No choices / no tool calls / bad json arguments all degrade gracefully.
    assert llm_proxy._extract_tool_calls({}) == []
    assert llm_proxy._extract_tool_calls({"choices": [{"message": {"content": "hi"}}]}) == []
    bad_args = {"function": {"name": "x", "arguments": "{"}}
    bad = {"choices": [{"message": {"tool_calls": [bad_args]}}]}
    assert llm_proxy._extract_tool_calls(bad) == [("x", {})]


class _FakeResp:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self.status_code = status_code
        self.content = json.dumps(payload).encode()
        self.headers = {"content-type": "application/json"}
        self._payload = payload

    def json(self) -> dict[str, Any]:
        # A real response parses fresh JSON each time; this fake must too. Handing
        # back the shared module-level dict let `_process` -- which rewrites
        # `tool_calls` in place -- amputate the fixture for every later test.
        return json.loads(self.content)


class _FakeClient:
    is_closed = False

    def __init__(self, resp: _FakeResp) -> None:
        self._resp = resp
        self.captured: dict[str, Any] = {}

    async def post(self, url: str, content: bytes, headers: dict[str, str]) -> _FakeResp:
        self.captured = {"url": url, "headers": headers, "content": content}
        return self._resp


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'P')", (tid,))
    db.conn.commit()
    return tid


def test_proxy_forwards_and_audits_tool_calls(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    assert (
        client.put(
            "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
        ).status_code
        == 200
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agentkey"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "remove 42"}]},
    )
    # Enforcement is the DEFAULT now (G-25): no header, no window, so the
    # irreversible call is stripped and the read survives. This assertion is the
    # point of the test -- it previously checked only the response id, and so would
    # not have noticed the mode flipping either way.
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "chatcmpl-test"
    kept = [c["function"]["name"] for c in body["choices"][0]["message"]["tool_calls"]]
    assert kept == ["crm.get_contact"]
    # The agent's own provider key was forwarded upstream, not xSOM's.
    assert fake.captured["headers"]["Authorization"] == "Bearer sk-agentkey"

    # Both tool-calls were audited with the policy verdict (auto-classified).
    # Read on a fresh connection — the proxy committed on its own connection.
    import psycopg

    with psycopg.connect(db.url) as check:
        rows = check.execute(
            "select tool_name, action_class, decision from audit_log "
            "where tenant_id = %s order by tool_name",
            (tid,),
        ).fetchall()
    by_tool = {r[0]: (r[1], r[2]) for r in rows}
    assert by_tool["crm.delete_contact"] == ("irreversible", "hold")
    assert by_tool["crm.get_contact"] == ("read", "allow")


def test_proxy_requires_gateway_token(db: DBHandle, test_verifier: TokenVerifier) -> None:
    client = _client(db.url, test_verifier)
    resp = client.post("/proxy/openai/v1/chat/completions", json={"model": "gpt-4o"})
    assert resp.status_code == 401


# --- Anthropic + enforcement -------------------------------------------------

ANTHROPIC_BODY = {
    "id": "msg_test",
    "type": "message",
    "role": "assistant",
    "content": [
        {"type": "text", "text": "Sure."},
        {"type": "tool_use", "id": "tu_1", "name": "crm.delete_contact", "input": {"id": 42}},
        {"type": "tool_use", "id": "tu_2", "name": "crm.get_contact", "input": {"id": 7}},
    ],
}


def test_extract_tool_use_anthropic() -> None:
    assert llm_proxy._extract_tool_use(ANTHROPIC_BODY) == [
        ("crm.delete_contact", {"id": 42}),
        ("crm.get_contact", {"id": 7}),
    ]


def test_anthropic_proxy_forwards_and_audits(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]

    fake = _FakeClient(_FakeResp(ANTHROPIC_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/anthropic/v1/messages",
        headers={"X-Gateway-Token": raw, "x-api-key": "sk-ant-agent"},
        json={"model": "claude-3-5-sonnet", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200
    assert fake.captured["headers"]["x-api-key"] == "sk-ant-agent"
    import psycopg

    with psycopg.connect(db.url) as check:
        rows = dict(
            check.execute(
                "select tool_name, decision from audit_log where tenant_id = %s", (tid,)
            ).fetchall()
        )
    assert rows == {"crm.delete_contact": "hold", "crm.get_contact": "allow"}


# --- usage capture + agent attribution + extra providers ---------------------

USAGE_BODY = {
    "id": "chatcmpl-usage",
    "object": "chat.completion",
    "model": "gpt-4o",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "crm.get_contact", "arguments": "{}"},
                    }
                ],
            },
        }
    ],
    "usage": {"prompt_tokens": 1000, "completion_tokens": 500, "total_tokens": 1500},
}


def test_proxy_records_usage_and_attributes_the_agent(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    created = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()
    raw, token_id = created["token"], created["id"]

    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(USAGE_BODY)))
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200

    import psycopg

    with psycopg.connect(db.url) as check:
        urow = check.execute(
            "select provider, model, prompt_tokens, completion_tokens, total_tokens, "
            "cost_usd, gateway_token_id, latency_ms, source from usage_events where tenant_id = %s",
            (tid,),
        ).fetchone()
        arow = check.execute(
            "select gateway_token_id from audit_log "
            "where tenant_id = %s and tool_name = 'crm.get_contact'",
            (tid,),
        ).fetchone()
    assert urow is not None and arow is not None
    assert urow[0] == "openai" and urow[1] == "gpt-4o"
    assert (urow[2], urow[3], urow[4]) == (1000, 500, 1500)
    assert float(urow[5]) > 0  # gpt-4o is priced
    assert str(urow[6]) == token_id  # usage attributed to the agent
    assert urow[7] is not None and float(urow[7]) >= 0  # proxy latency measured (Phase 2)
    assert urow[8] == "proxy"  # inline-proxy provenance
    assert str(arow[0]) == token_id  # so is the audited tool-call


def test_mistral_proxy_uses_openai_shape_and_base(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/mistral/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-mistral"},
        json={"model": "mistral-large-latest", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200
    assert "api.mistral.ai" in fake.captured["url"]
    assert fake.captured["url"].endswith("/v1/chat/completions")
    assert fake.captured["headers"]["Authorization"] == "Bearer sk-mistral"


OPENROUTER_BODY = {
    "id": "gen-or-1",
    "object": "chat.completion",
    "model": "openai/gpt-4o-mini",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "hi"}}],
    "usage": {
        "prompt_tokens": 1000,
        "completion_tokens": 500,
        "total_tokens": 1500,
        "cost": 0.00075,
    },
}


def test_openrouter_records_exact_billed_cost_and_requests_usage(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    created = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()
    raw, token_id = created["token"], created["id"]

    fake = _FakeClient(_FakeResp(OPENROUTER_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openrouter/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-or"},
        json={"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200
    # We asked OpenRouter to include the real cost.
    assert json.loads(fake.captured["content"])["usage"]["include"] is True

    import psycopg

    with psycopg.connect(db.url) as check:
        billed = check.execute(
            "select provider, source, amount_usd, gateway_token_id, external_id "
            "from billed_cost where tenant_id = %s",
            (tid,),
        ).fetchone()
    assert billed is not None
    assert billed[0] == "openrouter" and billed[1] == "openrouter_inline"
    assert float(billed[2]) == 0.00075  # the provider's real cost, not an estimate
    assert str(billed[3]) == token_id and billed[4] == "gen-or-1"


def test_token_in_url_path_works_without_header(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    created = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()
    raw, token_id = created["token"], created["id"]

    fake = _FakeClient(_FakeResp(OPENROUTER_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    # No X-Gateway-Token header — the token rides in the URL path.
    resp = client.post(
        f"/proxy/openrouter/{raw}/v1/chat/completions",
        headers={"Authorization": "Bearer sk-or"},
        json={"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200
    assert "openrouter.ai" in fake.captured["url"]
    import psycopg

    with psycopg.connect(db.url) as check:
        billed = check.execute(
            "select gateway_token_id from billed_cost where tenant_id = %s", (tid,)
        ).fetchone()
    assert billed is not None and str(billed[0]) == token_id  # attributed via path token


def test_token_in_url_rejects_bad_token(db: DBHandle, test_verifier: TokenVerifier) -> None:
    client = _client(db.url, test_verifier)
    resp = client.post(
        "/proxy/openrouter/xsg_bogus/v1/chat/completions",
        headers={"Authorization": "Bearer x"},
        json={"model": "m", "messages": []},
    )
    assert resp.status_code == 401


def test_token_in_url_unknown_provider_404(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]
    resp = client.post(
        f"/proxy/bogusprovider/{raw}/v1/chat/completions",
        headers={"Authorization": "Bearer x"},
        json={"model": "m", "messages": []},
    )
    assert resp.status_code == 404


def _agent(client: Any, admin: str) -> tuple[str, str]:
    """A gateway token (raw) and its id -- the id is how a window names the agent."""
    body = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()
    return body["token"], body["id"]


def _relay(client: Any, raw: str) -> Any:
    return client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "remove 42"}]},
    )


def test_a_request_header_can_no_longer_relax_enforcement(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # G-25. `X-XSOM-Mode: monitor` used to turn the guard off. The agent being
    # controlled does not get to say whether it is controlled -- so the header is
    # now inert, and the irreversible call is stripped anyway.
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    raw, _ = _agent(client, admin)

    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(UPSTREAM_BODY)))
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk", "X-XSOM-Mode": "monitor"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "remove 42"}]},
    )

    kept = [c["function"]["name"] for c in resp.json()["choices"][0]["message"]["tool_calls"]]
    assert kept == ["crm.get_contact"]


def test_an_open_window_relays_what_it_may_cover_and_records_it_as_monitor(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The legitimate use the header was working around: an admin wants to see what
    # enforcement would do before turning it loose on a fleet.
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": WRITE_POLICY}
    )
    raw, token_id = _agent(client, admin)
    monitor.open_window(db.conn, tenant_id=tid, gateway_token_id=token_id, hours=2, max_hours=24)
    db.conn.commit()

    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(WRITE_BODY)))
    resp = _relay(client, raw)

    kept = [c["function"]["name"] for c in resp.json()["choices"][0]["message"]["tool_calls"]]
    assert kept == ["crm.update_contact"]  # relayed, though the policy holds it

    with psycopg.connect(db.url) as check:
        rows = check.execute(
            "select tool_name, decision from audit_log where tenant_id = %s", (tid,)
        ).fetchall()
    # AD-27.3: the distinction is inside the hashed payload, so "we blocked it" and
    # "we would have blocked it" cannot hash identically.
    assert dict(rows)["crm.update_contact"] == "monitor_hold"


def test_an_open_window_never_covers_the_irreversible(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # AD-27.2, and the guarantee that must not bend: a window may relax a write, it
    # may never relax a destructive action. Otherwise observation is a documented
    # bypass of CLAUDE.md 4.1, which admits no exception.
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
    )
    raw, token_id = _agent(client, admin)
    monitor.open_window(db.conn, tenant_id=tid, gateway_token_id=token_id, hours=2, max_hours=24)
    db.conn.commit()

    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(UPSTREAM_BODY)))
    resp = _relay(client, raw)

    kept = [c["function"]["name"] for c in resp.json()["choices"][0]["message"]["tool_calls"]]
    assert kept == ["crm.get_contact"]  # the delete is still gone, window or not

    with psycopg.connect(db.url) as check:
        rows = check.execute(
            "select tool_name, decision from audit_log where tenant_id = %s", (tid,)
        ).fetchall()
    # Recorded as a real block, not as "we would have".
    assert dict(rows)["crm.delete_contact"] == "hold"


# --- Egress DLP guard --------------------------------------------------------

AWS_KEY = "AKIAIOSFODNN7EXAMPLE"  # fake, well-formed


def _client_dlp(db_url: str, verifier: TokenVerifier, **dlp_kw: str) -> TestClient:
    app = create_app(
        Settings(_env_file=None, env="dev", database_url=db_url, dlp_enabled=True, **dlp_kw)
    )
    app.state.verifier = verifier
    return TestClient(app)


def _mint(client: TestClient, admin: str) -> str:
    auth = {"Authorization": f"Bearer {admin}"}
    client.put("/v1/policy", headers=auth, json={"yaml": AUTO_POLICY})
    return client.post("/v1/gateway-tokens", headers=auth, json={"name": "bot"}).json()["token"]


@pytest.mark.covers("M-10", "egress", ingress="llm_proxy", sens="bloque")
def test_dlp_blocks_secret_before_forwarding(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client_dlp(db.url, test_verifier)  # secrets block by default
    raw = _mint(client, make_token(tenant_id=tid, role="admin"))

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": f"deploy with {AWS_KEY}"}],
        },
    )
    assert resp.status_code == 403
    assert "DLP" in resp.json()["detail"]
    assert fake.captured == {}  # the secret never left for the provider

    import psycopg

    with psycopg.connect(db.url) as check:
        row = check.execute(
            "select decision, action_class, error from audit_log "
            "where tenant_id = %s and tool_name = 'openai.egress'",
            (tid,),
        ).fetchone()
    assert row is not None
    assert row[0] == "deny" and row[1] == "external_send"
    assert "aws_access_key_id" in row[2] and AWS_KEY not in row[2]


@pytest.mark.covers("M-10", "egress", ingress="llm_proxy", sens="laisse_passer")
def test_dlp_flags_pii_but_forwards_unchanged(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client_dlp(db.url, test_verifier)  # pii flags by default
    raw = _mint(client, make_token(tenant_id=tid, role="admin"))

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "mail alice@example.com"}],
        },
    )
    assert resp.status_code == 200
    assert b"alice@example.com" in fake.captured["content"]  # forwarded as-is

    import psycopg

    with psycopg.connect(db.url) as check:
        decision = check.execute(
            "select decision from audit_log where tenant_id = %s and tool_name = 'openai.egress'",
            (tid,),
        ).fetchone()
    assert decision is not None and decision[0] == "flag"


def test_dlp_redacts_pii_when_configured(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client_dlp(db.url, test_verifier, dlp_pii_action="redact")
    raw = _mint(client, make_token(tenant_id=tid, role="admin"))

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "mail alice@example.com"}],
        },
    )
    assert resp.status_code == 200
    sent = fake.captured["content"].decode()
    assert "alice@example.com" not in sent and "[REDACTED:email]" in sent


def test_dlp_disabled_lets_secret_through(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)  # DLP off (default): backward compatible
    raw = _mint(client, make_token(tenant_id=tid, role="admin"))

    fake = _FakeClient(_FakeResp(UPSTREAM_BODY))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": f"deploy with {AWS_KEY}"}],
        },
    )
    assert resp.status_code == 200
    assert fake.captured != {}  # forwarded untouched


def test_the_providers_completion_id_never_becomes_the_audit_entrys_identity(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-161 — the defect this requirement was written for, on the path that had it.

    `audit_log.request_id` is inside the hash-chained payload. It used to be filled
    from `data["id"]` — the response body of whoever answers this connection. An
    upstream (or anything able to answer as one) therefore chose part of what the
    chain attests, and could hand back an id that collides with a real gateway
    request. It is now a server-minted id, with the provider's own kept beside it
    and labelled as declared.
    """
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    assert (
        client.put(
            "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": AUTO_POLICY}
        ).status_code
        == 200
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]

    hostile = json.loads(json.dumps(UPSTREAM_BODY))
    hostile["id"] = "../../../etc/passwd"
    monkeypatch.setattr(llm_proxy, "_http", lambda: _FakeClient(_FakeResp(hostile)))

    assert (
        client.post(
            "/proxy/openai/v1/chat/completions",
            headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agentkey"},
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
        ).status_code
        == 200
    )

    with psycopg.connect(db.url) as check:
        rows = check.execute(
            "select request_id, upstream_request_id, client_request_id from audit_log "
            "where tenant_id = %s",
            (tid,),
        ).fetchall()
    assert len(rows) == 2  # one row per tool call in the completion
    minted = {r[0] for r in rows}
    assert minted != {"../../../etc/passwd"}
    assert all(len(r) == 32 for r in minted)
    # One id per inspected response, so the calls of a single completion still group.
    assert len(minted) == 1
    assert {r[1] for r in rows} == {"../../../etc/passwd"}
    assert {r[2] for r in rows} == {None}
