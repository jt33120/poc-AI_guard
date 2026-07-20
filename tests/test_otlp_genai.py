"""OTLP gen_ai span extraction → AiCall (ADR-0001, no DB)."""

from __future__ import annotations

import time
from typing import Any

from core import otlp_genai

NOW = otlp_genai.datetime.now(otlp_genai.UTC)


def _span(
    attrs: list[tuple[str, dict[str, Any]]],
    *,
    name: str = "gen_ai.chat",
    span_id: str = "sp1",
    latency_ms: float = 250.0,
    trace_state: str | None = None,
) -> dict[str, Any]:
    start = int(time.time() * 1e9)
    span: dict[str, Any] = {
        "name": name,
        "spanId": span_id,
        "traceId": "tr1",
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(start + int(latency_ms * 1e6)),
        "attributes": [{"key": k, "value": v} for k, v in attrs],
    }
    if trace_state is not None:
        span["traceState"] = trace_state
    return span


def _payload(
    *spans: dict[str, Any], resource: list[tuple[str, dict[str, Any]]] | None = None
) -> dict[str, Any]:
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [{"key": k, "value": v} for k, v in (resource or [])]},
                "scopeSpans": [{"spans": list(spans)}],
            }
        ]
    }


_S = lambda s: {"stringValue": s}  # noqa: E731
_I = lambda n: {"intValue": str(n)}  # noqa: E731 - OTLP encodes int64 as string
_D = lambda f: {"doubleValue": f}  # noqa: E731


def test_parses_basic_gen_ai_call() -> None:
    payload = _payload(
        _span(
            [
                ("gen_ai.system", _S("openai")),
                ("gen_ai.request.model", _S("gpt-4o")),
                ("gen_ai.usage.input_tokens", _I(1000)),
                ("gen_ai.usage.output_tokens", _I(500)),
                ("gen_ai.operation.name", _S("chat")),
                ("gen_ai.route", _S("/v1/chat")),
            ]
        )
    )
    calls, rejected = otlp_genai.parse_gen_ai(payload, now=NOW)
    assert rejected == 0 and len(calls) == 1
    c = calls[0]
    assert c.provider == "openai" and c.model == "gpt-4o" and c.operation == "chat"
    assert (c.prompt_tokens, c.completion_tokens, c.total_tokens) == (1000, 500, 1500)
    assert c.cost_usd > 0  # gpt-4o is priced via core.pricing
    assert c.latency_ms == 250.0
    assert c.status == "ok" and c.error_type is None


def test_real_cost_overrides_estimate() -> None:
    (c,), _ = otlp_genai.parse_gen_ai(
        _payload(
            _span(
                [
                    ("gen_ai.system", _S("openrouter")),
                    ("gen_ai.request.model", _S("openai/gpt-4o-mini")),
                    ("gen_ai.usage.input_tokens", _I(1000)),
                    ("gen_ai.usage.output_tokens", _I(500)),
                    ("gen_ai.usage.cost", _D(0.00042)),
                ]
            )
        ),
        now=NOW,
    )
    assert c.cost_usd == 0.00042


def test_error_and_refusal() -> None:
    (c,), _ = otlp_genai.parse_gen_ai(
        _payload(
            _span(
                [
                    ("gen_ai.system", _S("openai")),
                    ("gen_ai.request.model", _S("gpt-4o")),
                    ("error.type", _S("content_moderation")),
                ]
            )
        ),
        now=NOW,
    )
    assert c.status == "error" and c.error_type == "content_moderation"
    assert otlp_genai.is_refusal(c.error_type) is True
    assert otlp_genai.is_refusal("timeout") is False


def test_session_from_tracestate_and_route_templating() -> None:
    (c,), _ = otlp_genai.parse_gen_ai(
        _payload(
            _span(
                [
                    ("gen_ai.system", _S("mistral")),
                    ("gen_ai.request.model", _S("mistral-large")),
                    ("gen_ai.route", _S("/users/42/threads/1a2b")),
                ],
                trace_state="mip=s:sess-9,other=x",
            )
        ),
        now=NOW,
    )
    assert c.session_id == "sess-9"
    assert c.route == "/users/:id/threads/1a2b"  # numeric segment templated


def test_total_tokens_derived_when_absent() -> None:
    (c,), _ = otlp_genai.parse_gen_ai(
        _payload(
            _span(
                [
                    ("gen_ai.request.model", _S("gpt-4o")),
                    ("gen_ai.usage.input_tokens", _I(30)),
                    ("gen_ai.usage.output_tokens", _I(12)),
                ]
            )
        ),
        now=NOW,
    )
    assert c.total_tokens == 42


def test_rejects_span_without_model_or_provider() -> None:
    calls, rejected = otlp_genai.parse_gen_ai(
        _payload(_span([("gen_ai.usage.input_tokens", _I(5))], name="gen_ai")),
        now=NOW,
    )
    assert calls == [] and rejected == 1


def test_ignores_non_gen_ai_spans() -> None:
    calls, rejected = otlp_genai.parse_gen_ai(
        _payload(_span([("http.method", _S("GET"))], name="http.server")),
        now=NOW,
    )
    assert calls == [] and rejected == 0  # not an LLM span → neither kept nor rejected


def test_empty_payload_is_safe() -> None:
    assert otlp_genai.parse_gen_ai({}, now=NOW) == ([], 0)
