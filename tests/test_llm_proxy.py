"""LLM monitoring proxy: tool-call extraction + audit of a forwarded response."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
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
        return self._payload


class _FakeClient:
    is_closed = False

    def __init__(self, resp: _FakeResp) -> None:
        self._resp = resp
        self.captured: dict[str, Any] = {}

    async def post(self, url: str, content: bytes, headers: dict[str, str]) -> _FakeResp:
        self.captured = {"url": url, "headers": headers}
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
    # Response is passed through unchanged (monitoring mode).
    assert resp.status_code == 200
    assert resp.json()["id"] == "chatcmpl-test"
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
