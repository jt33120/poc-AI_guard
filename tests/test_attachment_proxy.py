"""Real HTTP routing/extraction; only auth, persistence and provider are fakes.

PostgreSQL/RLS qualification remains in test_extension_devices.py.
"""

import gzip
import json
from contextlib import nullcontext
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import llm_proxy
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from core import attachments
from core.config import Settings
from core.entitlements import Meter
from tests.test_attachments import block, pdf, png
from tests.test_llm_proxy import _FakeClient, _FakeResp


@pytest.fixture
def relay(monkeypatch):
    app = FastAPI()
    app.state.settings = Settings(_env_file=None, env="dev", dlp_enabled=False)
    app.state.database_url = "synthetic-db-no-network"
    app.include_router(llm_proxy.router)
    app.dependency_overrides[get_gateway_principal] = lambda: GatewayPrincipal("tenant", "device")
    monkeypatch.setattr(llm_proxy.limiter, "enabled", False)
    monkeypatch.setattr(
        llm_proxy,
        "_debiter_un_appel",
        lambda *args: (
            SimpleNamespace(allows=lambda capability: True),
            Meter.ok,
        ),
    )
    monkeypatch.setattr(
        llm_proxy.db,
        "connection",
        lambda *args: nullcontext(
            SimpleNamespace(transaction=lambda: nullcontext()),
        ),
    )
    monkeypatch.setattr(llm_proxy.extension_devices, "device_for", lambda *args: "device")
    events = []
    monkeypatch.setattr(
        llm_proxy.extension_devices, "record", lambda *args: events.append(args[-1])
    )
    monkeypatch.setattr(llm_proxy, "_observing", lambda *args: False)
    monkeypatch.setattr(llm_proxy, "_inspect", lambda *args: None)
    provider = _FakeClient(_FakeResp({"input_tokens": 7, "content": []}))
    monkeypatch.setattr(llm_proxy, "_http", lambda: provider)
    with TestClient(app) as client:
        yield client, provider, events


@pytest.mark.parametrize("endpoint", ["messages", "messages/count_tokens"])
@pytest.mark.parametrize("kind", ["md", "png", "pdf"])
def test_provider_gets_only_cleaned_attachment_text(relay, endpoint, kind) -> None:
    client, provider, events = relay
    if kind == "png":
        item = block(png(), "image/png")
    elif kind == "pdf":
        item = block(pdf(raster=True), "application/pdf")
    else:
        item = block(b"# Notes\nPASSWORD=synthetic-only", "text/markdown")
    response = client.post(
        f"/proxy/extension/anthropic/v1/{endpoint}",
        headers={"Authorization": "Bearer assistant-owned-synthetic", "anthropic-beta": "test"},
        json={"model": "claude-test", "messages": [{"role": "user", "content": [item]}]},
    )
    assert response.status_code == 200, response.text
    forwarded = provider.captured["content"]
    assert b"XXX" in forwarded and b"synthetic-only" not in forwarded
    assert b'"source"' not in forwarded and item["source"]["data"].encode() not in forwarded
    assert provider.captured["headers"]["authorization"] == "Bearer assistant-owned-synthetic"
    assert [event["outcome"] for event in events] == ["redacted", "upstream_accepted"]
    assert all(event["attachments"] == 1 for event in events)
    assert all(event["attachment_delivery"] == "text_only" for event in events)
    assert "synthetic-only" not in json.dumps(events)
    assert "PASSWORD" not in json.dumps(events)


def test_failed_extraction_is_422_content_free_and_never_calls_provider(relay) -> None:
    client, provider, events = relay
    response = client.post(
        "/proxy/extension/anthropic/v1/messages",
        json={"messages": [{"role": "user", "content": [block(b"invalid", "image/png")]}]},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "attachment_mime_mismatch"
    assert provider.captured == {}
    assert events[0]["outcome"] == "blocked"
    assert events[0]["analysis_complete"] is False
    assert events[0]["attachment_error"] == "attachment_mime_mismatch"


def test_streamed_upload_stops_at_envelope_limit(relay, monkeypatch) -> None:
    client, provider, _ = relay
    monkeypatch.setattr(attachments, "MAX_REQUEST_BYTES", 32)
    response = client.post(
        "/proxy/extension/anthropic/v1/messages",
        content=(b"x" * 20 for _ in range(3)),
    )
    assert response.status_code == 413
    assert provider.captured == {}


SSE = b'event: message_start\ndata: {"type":"message_start"}\n\n'


def test_a_compressed_stream_reaches_the_assistant_readable(relay, monkeypatch) -> None:
    """Relayer les octets bruts d'un flux gzip, sans son Content-Encoding, livrait un
    flux illisible : Claude Code n'y trouvait aucun événement et basculait en
    non-streaming à chaque requête."""
    client, _, _ = relay
    asked: dict[str, str | None] = {}

    def provider(request: httpx.Request) -> httpx.Response:
        asked["accept-encoding"] = request.headers.get("accept-encoding")
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream", "content-encoding": "gzip"},
            stream=httpx.ByteStream(gzip.compress(SSE)),
        )

    monkeypatch.setattr(
        llm_proxy, "_http", lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider))
    )
    monkeypatch.setattr(llm_proxy, "_audit_streamed", lambda *args, **kwargs: None)
    response = client.post(
        "/proxy/extension/anthropic/v1/messages",
        json={
            "model": "claude-test",
            "stream": True,
            "messages": [{"role": "user", "content": "ok"}],
        },
    )
    assert response.status_code == 200
    assert response.content == SSE
    assert asked["accept-encoding"] == "identity"


def test_the_extension_relay_cleans_but_never_rewrites_tool_calls(relay, monkeypatch) -> None:
    """Le relais Secret Guard nettoie (GATEWAY_AUDIT.md) ; la policy d'actions d'AI Guard
    n'a pas à retirer les outils de l'assistant. Elle ne s'appliquait qu'au repli
    non-streaming, et ce repli cassait la session."""
    client, provider, _ = relay
    reply = {
        "id": "msg_synthetic",
        "type": "message",
        "role": "assistant",
        "stop_reason": "tool_use",
        "content": [
            {"type": "tool_use", "id": "toolu_1", "name": "Read", "input": {"file_path": "a"}}
        ],
    }
    provider._resp = _FakeResp(reply)
    inspected: list[object] = []
    monkeypatch.setattr(llm_proxy, "_inspect", lambda *args: inspected.append(args))
    response = client.post(
        "/proxy/extension/anthropic/v1/messages",
        json={"model": "claude-test", "messages": [{"role": "user", "content": "lis a"}]},
    )
    assert response.status_code == 200
    assert response.json() == reply
    assert inspected == []
