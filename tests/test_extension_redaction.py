"""Synthetic prompt corpus: decoded JSON, tool history, and fail-closed limits."""

import json

import pytest
from pydantic import ValidationError

from core.extension_devices import Event, event_hash
from core.extension_redaction import MAX_BYTES, clean


def request(content: object, **extra: object) -> bytes:
    return json.dumps({"messages": [{"role": "user", "content": content}], **extra}).encode()


@pytest.mark.parametrize("value", ["not-a-real-password-123", "abc", "a", "xyz-123-éà"])
def test_password_is_replaced_without_losing_assignment(value: str) -> None:
    result = clean(request(f"Analyse : PASSWORD={value}"))
    assert json.loads(result.body)["messages"][0]["content"] == "Analyse : PASSWORD=XXX"
    assert result.count == 1
    assert clean(result.body).count == 0


def test_json_escape_and_structured_tool_input() -> None:
    result = clean(
        request(
            [
                {"type": "text", "text": "PASSWORD=synthetic-only"},
                {
                    "type": "tool_use",
                    "id": "toolu_01AbCdEf0123456789XyZa",
                    "name": "example",
                    "input": {"password": "test-only", "safe": "hello"},
                },
            ],
            system="Explain environment variables",
            tools=[{"name": "example", "description": "pwd=synthetic"}],
        )
    )
    body = json.loads(result.body)
    assert body["messages"][0]["content"][1]["id"] == "toolu_01AbCdEf0123456789XyZa"
    assert body["messages"][0]["content"][1]["input"]["password"] == "XXX"
    assert body["tools"][0]["description"] == "pwd=XXX"
    assert result.count == 3


def test_full_private_key_block_not_just_header() -> None:
    value = "-----BEGIN PRIVATE KEY-----\nsynthetic-not-a-key\n-----END PRIVATE KEY-----"
    assert json.loads(clean(request(value)).body)["messages"][0]["content"] == "XXX"
    with pytest.raises(ValueError, match="incomplete_private_key"):
        clean(request("-----BEGIN PRIVATE KEY-----\ntruncated"))


def test_quoted_password_spaces_and_prefixed_keys() -> None:
    result = clean(request('DB_PASSWORD="synthetic words only"\ntoken=unit-test-only'))
    assert json.loads(result.body)["messages"][0]["content"] == 'DB_PASSWORD="XXX"\ntoken=XXX'
    assert result.count == 2


@pytest.mark.parametrize(
    "content",
    [
        [{"type": "image", "source": {"type": "base64", "data": "fake"}}],
        [{"type": "document", "source": {"url": "https://example.invalid"}}],
        [{"type": "thinking", "thinking": "pwd=synthetic", "signature": "fake"}],
    ],
)
def test_uninspectable_content_never_forwarded(content: object) -> None:
    with pytest.raises(ValueError):
        clean(request(content))


@pytest.mark.parametrize(
    "body",
    [b"{", b"[]", b"{}", b"x" * (MAX_BYTES + 1)],
    ids=["json", "array", "empty", "oversized"],
)
def test_invalid_and_oversized(body: bytes) -> None:
    with pytest.raises(ValueError):
        clean(body)


def test_safe_payload_preserves_protocol() -> None:
    body = request("Explain what environment variables are", model="claude-test", stream=True)
    assert json.loads(clean(body).body) == json.loads(body)


def test_audit_contract_cannot_smuggle_prompt_or_claim_gateway_source() -> None:
    event = {
        "event_id": "00000000-0000-4000-8000-000000000001",
        "at": "2026-09-16T10:00:00Z",
        "kind": "scan",
        "assistant": "claude",
        "mode": "redact",
        "outcome": "redacted",
    }
    assert Event.model_validate(event).findings == 0
    for field in ("prompt", "value", "source", "device_id", "tenant_id", "rules"):
        with pytest.raises(ValidationError):
            Event.model_validate({**event, field: "forbidden"})
    with pytest.raises(ValidationError):
        Event.model_validate({**event, "findings": -1})


def test_hash_binds_identity_source_and_payload() -> None:
    original = event_hash("tenant", "device", "event", "extension", {"findings": 1}, "prev")
    assert original != event_hash("tenant", "device", "event", "gateway", {"findings": 1}, "prev")
    assert original != event_hash("tenant", "device", "event", "extension", {"findings": 2}, "prev")
