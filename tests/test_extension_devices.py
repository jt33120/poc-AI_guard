"""Real PostgreSQL: registration, RLS, append-only evidence and provider boundary."""

from collections.abc import AsyncIterator, Callable
from uuid import uuid4

import httpx
import psycopg
import pytest

from api import llm_proxy
from api.security import TokenVerifier
from core import extension_devices as devices
from core import tenant_tokens
from tests.conftest import DBHandle
from tests.test_llm_proxy import _client, _FakeClient, _FakeResp, _tenant


def enrollment(db: DBHandle, verifier: TokenVerifier):
    tenant = _tenant(db)
    raw, token = tenant_tokens.mint(db.conn, tenant_id=tenant, name="PC-TEST")
    db.conn.commit()
    client = _client(db.url, verifier)
    device = str(uuid4())
    headers = {"X-Gateway-Token": raw}
    registration = {
        "installation_id": device,
        "platform": "win32",
        "extension_version": "0.3.0",
        "mode": "redact",
    }
    assert (
        client.post("/v1/extension/register", headers=headers, json=registration).status_code == 200
    )
    return tenant, token, client, headers, registration


def test_registration_deduplication_revocation_and_rls(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant, token, client, headers, registration = enrollment(db, test_verifier)
    assert (
        client.post("/v1/extension/register", headers=headers, json=registration).status_code == 200
    )
    assert (
        client.post(
            "/v1/extension/register",
            headers=headers,
            json={**registration, "installation_id": str(uuid4())},
        ).status_code
        == 409
    )
    event = {
        "event_id": str(uuid4()),
        "at": "2026-09-16T10:00:00Z",
        "kind": "scan",
        "assistant": "claude",
        "mode": "redact",
        "outcome": "redacted",
        "findings": 1,
    }
    batch = {"events": [event]}
    for _ in range(2):
        result = client.post("/v1/extension/events", headers=headers, json=batch)
        assert result.status_code == 200, result.text
        assert result.json()["accepted"] == [event["event_id"]]
    assert (
        client.post(
            "/v1/extension/events", headers=headers, json={"events": [{**event, "findings": 2}]}
        ).status_code
        == 409
    )
    own = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    other = {"Authorization": f"Bearer {make_token(tenant_id=_tenant(db), role='admin')}"}
    assert len(client.get("/v1/extensions/devices", headers=own).json()) == 1
    assert client.get("/v1/extensions/devices", headers=other).json() == []
    assert (
        client.get(
            "/v1/extensions/events",
            headers=other,
            params={"device_id": registration["installation_id"]},
        ).json()["events"]
        == []
    )
    journal = client.get("/v1/extensions/events", headers=own).json()["events"]
    assert len(journal) == 1
    assert journal[0]["source"] == "extension"
    assert client.get("/v1/extensions/verify", headers=own).json() == {"valid": True}
    db.conn.execute("update gateway_tokens set revoked_at=now() where id=%s", (token["id"],))
    db.conn.commit()
    assert client.post("/v1/extension/events", headers=headers, json=batch).status_code == 401
    assert len(client.get("/v1/extensions/events", headers=own).json()["events"]) == 1
    with pytest.raises(psycopg.Error), db.conn.transaction():
        db.conn.execute("delete from extension_events")


def test_provider_only_receives_cleaned_body_with_subscription_headers(
    db: DBHandle, test_verifier: TokenVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, _, client, headers, registration = enrollment(db, test_verifier)
    fake = _FakeClient(_FakeResp({"input_tokens": 7}))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    response = client.post(
        "/proxy/extension/anthropic/v1/messages/count_tokens",
        headers={
            **headers,
            "Authorization": "Bearer synthetic-oauth-only",
            "anthropic-beta": "oauth-test",
        },
        json={
            "model": "claude-test",
            "messages": [{"role": "user", "content": "PASSWORD=synthetic-only"}],
        },
    )
    assert response.status_code == 200, response.text
    assert b"synthetic-only" not in fake.captured["content"]
    assert b"PASSWORD=XXX" in fake.captured["content"]
    assert fake.captured["headers"]["authorization"] == "Bearer synthetic-oauth-only"
    assert fake.captured["headers"]["anthropic-beta"] == "oauth-test"
    assert "x-api-key" not in fake.captured["headers"]
    assert "X-Gateway-Token" not in fake.captured["headers"]
    with psycopg.connect(db.url) as conn:
        rows = conn.execute(
            "select source,payload from extension_events where device_id=%s order by id",
            (registration["installation_id"],),
        ).fetchall()
        assert [row[1]["outcome"] for row in rows] == ["redacted", "upstream_accepted"]
        assert all(row[0] == "gateway" for row in rows)
        assert "synthetic" not in str(rows)
        assert devices.verify(conn, tenant)


def test_bad_prompt_audited_without_forwarding(
    db: DBHandle, test_verifier: TokenVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, client, headers, _ = enrollment(db, test_verifier)
    fake = _FakeClient(_FakeResp({}))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    response = client.post(
        "/proxy/extension/anthropic/v1/messages", headers=headers, content=b"{invalid"
    )
    assert response.status_code == 422
    assert fake.captured == {}
    with psycopg.connect(db.url) as conn:
        payload = conn.execute("select payload from extension_events").fetchone()[0]
        assert payload["outcome"] == "blocked"
        assert payload["analysis_complete"] is False


def test_streamed_messages_are_cleaned_before_provider_and_audited(
    db: DBHandle, test_verifier: TokenVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, _, client, headers, _ = enrollment(db, test_verifier)
    captured: list[bytes] = []

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            yield b"event: message_stop\ndata: {}\n\n"

    def upstream(request: httpx.Request) -> httpx.Response:
        captured.append(request.content)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=Stream(),
        )

    transport = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    monkeypatch.setattr(llm_proxy, "_http", lambda: transport)
    result = client.post(
        "/proxy/extension/anthropic/v1/messages",
        headers=headers,
        json={
            "model": "claude-test",
            "stream": True,
            "messages": [{"role": "user", "content": "pwd=synthetic-only"}],
        },
    )
    assert result.status_code == 200
    assert "message_stop" in result.text
    assert len(captured) == 1 and b"synthetic-only" not in captured[0]
    assert b"pwd=XXX" in captured[0]
    with psycopg.connect(db.url) as conn:
        assert devices.verify(conn, tenant)
        assert (
            conn.execute("select count(*) from extension_events where source='gateway'").fetchone()[
                0
            ]
            == 2
        )
