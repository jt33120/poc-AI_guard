"""Build the AI-observability summary from usage_events (ADR-0001, Phase 1).

Reproduces the shape of mip-rum's ``RumSummary`` AI sub-object so a facade can
etaler the result unchanged. Computed over the extended ``usage_events`` (both the
inline-proxy and OTLP-pushed rows), tenant-scoped by RLS. Quality signals
(regen/thumbs/CSAT) require front events not yet ingested → returned as ``null``.
Anomaly flags land in Phase 2 (the z-score view). Rates are rounded to 4 dp.
"""

from __future__ import annotations

from typing import Any

import psycopg

# Allowlisted windows → a fixed interval literal (never interpolated from input).
_WINDOWS: dict[str, str] = {"24h": "24 hours", "7d": "7 days", "30d": "30 days"}
_REFUSAL_SQL = "error_type ~* 'refus|guardrail|safety|moderation|content_filter|policy'"


def normalize_window(window: str | None) -> str:
    w = (window or "30d").lower().replace("j", "d")
    return w if w in _WINDOWS else "30d"


def _round(value: Any) -> float | None:
    return round(float(value), 4) if value is not None else None


def _where(window: str, agent_id: str | None, client_id: str | None) -> tuple[str, list[Any]]:
    clauses = [f"ts >= now() - interval '{_WINDOWS[window]}'"]
    params: list[Any] = []
    if agent_id:
        clauses.append("gateway_token_id = %s")
        params.append(agent_id)
    if client_id:
        clauses.append("gateway_token_id in (select id from gateway_tokens where client_id = %s)")
        params.append(client_id)
    return " where " + " and ".join(clauses), params


def summary(
    conn: psycopg.Connection,
    *,
    window: str | None = None,
    agent_id: str | None = None,
    client_id: str | None = None,
) -> dict[str, Any]:
    """Aggregate LLM calls for the tenant (RLS) into the AI-summary contract."""
    w = normalize_window(window)
    where, params = _where(w, agent_id, client_id)
    p = tuple(params)

    kpi = conn.execute(
        "select count(*), coalesce(sum(total_tokens), 0), coalesce(sum(cost_usd), 0)::float8, "
        "percentile_cont(0.75) within group (order by latency_ms), "
        "avg((status = 'error')::int)::float8 "
        "from usage_events" + where,
        p,
    ).fetchone() or (0, 0, 0.0, None, None)

    by_model = [
        {
            "provider": r[0],
            "model": r[1],
            "calls": int(r[2]),
            "tokens": int(r[3]),
            "cost_usd": float(r[4]),
        }
        for r in conn.execute(
            "select provider, model, count(*), coalesce(sum(total_tokens), 0), "
            "coalesce(sum(cost_usd), 0)::float8 "
            "from usage_events" + where + " group by provider, model order by 5 desc",
            p,
        ).fetchall()
    ]

    top_users = [
        {"user_hash": r[0], "calls": int(r[1]), "cost_usd": float(r[2])}
        for r in conn.execute(
            "select user_hash, count(*), coalesce(sum(cost_usd), 0)::float8 "
            "from usage_events" + where + " and user_hash is not null "
            "group by user_hash order by 3 desc limit 20",
            p,
        ).fetchall()
    ]

    by_operation = [
        {
            "operation": r[0],
            "route": r[1],
            "calls": int(r[2]),
            "cost_usd": float(r[3]),
            "tokens": int(r[4]),
            "p75_latency_ms": _round(r[5]),
            "ttft_p75_ms": _round(r[6]),
            "error_rate": _round(r[7]),
            "refusal_rate": _round(r[8]),
            # Phase 2 (z-score view) / Phase 3 (front quality events):
            "anomaly": False,
            "anomaly_score": None,
            "regen_rate": None,
            "thumbs_down_rate": None,
            "csat": None,
        }
        for r in conn.execute(
            "select operation, route, count(*), coalesce(sum(cost_usd), 0)::float8, "
            "coalesce(sum(total_tokens), 0), "
            "percentile_cont(0.75) within group (order by latency_ms), "
            "percentile_cont(0.75) within group (order by ttft_ms), "
            "avg((status = 'error')::int)::float8, "
            f"avg((status = 'error' and {_REFUSAL_SQL})::int)::float8 "
            "from usage_events" + where + " group by operation, route order by 3 desc",
            p,
        ).fetchall()
    ]

    series = [
        {
            "date": r[0],
            "calls": int(r[1]),
            "cost_usd": float(r[2]),
            "p75_latency_ms": _round(r[3]),
            "error_rate": _round(r[4]),
        }
        for r in conn.execute(
            "select to_char(date_trunc('day', ts), 'YYYY-MM-DD'), count(*), "
            "coalesce(sum(cost_usd), 0)::float8, "
            "percentile_cont(0.75) within group (order by latency_ms), "
            "avg((status = 'error')::int)::float8 "
            "from usage_events" + where + " group by 1 order by 1",
            p,
        ).fetchall()
    ]

    return {
        "window": w,
        "ai_calls": int(kpi[0]),
        "ai_tokens": int(kpi[1]),
        "ai_cost_usd": float(kpi[2]),
        "ai_p75_latency_ms": _round(kpi[3]),
        "ai_error_rate": _round(kpi[4]),
        "ai_by_model": by_model,
        "ai_top_users": top_users,
        "ai_by_operation": by_operation,
        "ai_series": series,
    }
