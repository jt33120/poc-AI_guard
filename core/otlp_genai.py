"""Parse OTLP/HTTP JSON trace payloads into LLM-call records (ADR-0001, Phase 1).

Ports the ``gen_ai`` extraction branch of mip-rum's ``flattenOtlp()`` to Python: a
span is an LLM call when its name is ``gen_ai``/``gen_ai.*`` or it carries a
``gen_ai.request.model`` / ``gen_ai.system`` attribute. We keep only metadata +
token counts (never content, CLAUDE.md §4.10). Cost is the provider-reported value
when present, else estimated via ``core.pricing`` (reused, not re-implemented).

Rejection rule (the only validation): a span is dropped unless it has a span id AND
a provider or a model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from core import pricing

_REFUSAL = re.compile(r"refus|guardrail|safety|moderation|content_filter|policy", re.I)
_TRACESTATE_SESSION = re.compile(r"(?:^|,)\s*mip=s:([^,]+)")
# Route templating: collapse numeric and uuid path segments to ':id'.
# Match only a WHOLE path segment (followed by '/' or end), not a digit prefix.
_UUID_SEG = re.compile(
    r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)"
)
_NUM_SEG = re.compile(r"/\d+(?=/|$)")


@dataclass(frozen=True)
class AiCall:
    span_id: str
    trace_id: str | None
    session_id: str | None
    app_id: str | None
    route: str | None
    provider: str | None
    model: str | None
    operation: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    cost_usd: float
    latency_ms: float | None
    ttft_ms: float | None
    status: str
    error_type: str | None
    user_hash: str | None
    ts: datetime


def is_refusal(error_type: str | None) -> bool:
    """Whether an error_type looks like a guardrail/safety refusal (for refusal_rate)."""
    return bool(error_type) and bool(_REFUSAL.search(error_type or ""))


def _attr_value(v: Any) -> Any:
    """Unwrap an OTLP attribute value ({stringValue|intValue|doubleValue|boolValue})."""
    if not isinstance(v, dict):
        return v
    if "stringValue" in v:
        return v["stringValue"]
    if "intValue" in v:
        try:
            return int(v["intValue"])
        except (TypeError, ValueError):
            return None
    if "doubleValue" in v:
        try:
            return float(v["doubleValue"])
        except (TypeError, ValueError):
            return None
    if "boolValue" in v:
        return bool(v["boolValue"])
    return None


def _attrs(raw: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and "key" in item:
                out[item["key"]] = _attr_value(item.get("value"))
    return out


def _num(value: Any) -> float | None:
    # OTLP/JSON encodes int64 (incl. unixNano) as strings, so accept numeric strings.
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _int(value: Any) -> int | None:
    n = _num(value)
    return int(n) if n is not None else None


def _session_from_tracestate(tracestate: Any) -> str | None:
    if not isinstance(tracestate, str):
        return None
    m = _TRACESTATE_SESSION.search(tracestate)
    return m.group(1).strip() if m else None


def _normalize_route(route: Any) -> str | None:
    if not isinstance(route, str) or not route:
        return None
    r = _UUID_SEG.sub("/:id", route)
    r = _NUM_SEG.sub("/:id", r)
    return r


def _nanos_to_dt(nanos: Any, now: datetime) -> datetime:
    n = _num(nanos)
    if n is None or n <= 0:
        return now
    dt = datetime.fromtimestamp(n / 1e9, tz=UTC)
    # Clock-drift guard: reject absurd timestamps (future / very old) → use now.
    if dt > now + timedelta(days=1) or dt < now - timedelta(days=30):
        return now
    return dt


def _int_nanos(value: Any) -> int | None:
    # Keep nanosecond precision: float64 can't hold ~1.7e18 exactly, so parse int.
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            n = _num(value)
            return int(n) if n is not None else None
    return None


def _duration_ms(start: Any, end: Any) -> float | None:
    s, e = _int_nanos(start), _int_nanos(end)
    if s is None or e is None or e <= s:
        return None
    return (e - s) / 1e6


def _iter_spans(payload: dict[str, Any]) -> Any:
    for rs in payload.get("resourceSpans") or []:
        resource = _attrs((rs.get("resource") or {}).get("attributes"))
        for ss in rs.get("scopeSpans") or rs.get("instrumentationLibrarySpans") or []:
            for span in ss.get("spans") or []:
                if isinstance(span, dict):
                    yield resource, span


def _build_call(span: dict[str, Any], a: dict[str, Any], now: datetime) -> AiCall | None:
    span_id = span.get("spanId") or a.get("mip.span_id")
    provider = a.get("gen_ai.system") or a.get("mip.ai.provider")
    model = a.get("gen_ai.request.model") or a.get("gen_ai.response.model") or a.get("mip.ai.model")
    if not span_id or (not provider and not model):
        return None
    prompt = _int(a.get("gen_ai.usage.input_tokens") or a.get("gen_ai.usage.prompt_tokens"))
    completion = _int(
        a.get("gen_ai.usage.output_tokens") or a.get("gen_ai.usage.completion_tokens")
    )
    total = _int(a.get("gen_ai.usage.total_tokens"))
    if total is None and prompt is not None and completion is not None:
        total = prompt + completion
    billed = _num(a.get("gen_ai.usage.cost"))
    err = a.get("error.type") or a.get("gen_ai.error.type")
    cost = (
        billed
        if billed is not None
        else pricing.cost_usd(provider or "", model, prompt or 0, completion or 0)
    )
    return AiCall(
        span_id=str(span_id),
        trace_id=span.get("traceId") or a.get("mip.trace_id"),
        session_id=_session_from_tracestate(span.get("traceState")) or a.get("mip.session_id"),
        app_id=a.get("mip.app_id") if isinstance(a.get("mip.app_id"), str) else None,
        route=_normalize_route(a.get("gen_ai.route") or a.get("mip.route")),
        provider=provider,
        model=model,
        operation=a.get("gen_ai.operation.name"),
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        cost_usd=round(float(cost), 6),
        latency_ms=_duration_ms(span.get("startTimeUnixNano"), span.get("endTimeUnixNano"))
        or _num(a.get("gen_ai.latency_ms")),
        ttft_ms=_num(a.get("gen_ai.server.time_to_first_token") or a.get("gen_ai.ttft_ms")),
        status="error" if err else "ok",
        error_type=err if isinstance(err, str) else None,
        user_hash=a.get("mip.user_hash") if isinstance(a.get("mip.user_hash"), str) else None,
        ts=_nanos_to_dt(span.get("startTimeUnixNano"), now),
    )


def parse_gen_ai(payload: dict[str, Any], *, now: datetime) -> tuple[list[AiCall], int]:
    """Extract LLM-call records from an OTLP payload; returns (calls, rejected_count)."""
    calls: list[AiCall] = []
    rejected = 0
    for resource, span in _iter_spans(payload):
        a = {**resource, **_attrs(span.get("attributes"))}
        name = span.get("name") or ""
        is_gen_ai = (
            name == "gen_ai"
            or (isinstance(name, str) and name.startswith("gen_ai."))
            or a.get("gen_ai.request.model") is not None
            or a.get("gen_ai.system") is not None
        )
        if not is_gen_ai:
            continue
        call = _build_call(span, a, now)
        if call is None:
            rejected += 1
        else:
            calls.append(call)
    return calls, rejected
