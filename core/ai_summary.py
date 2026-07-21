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


def anomalies(
    conn: psycopg.Connection, app: str | None = None
) -> dict[tuple[str | None, str | None], float]:
    """Cost anomalies by operation x route: z-score of 24h cost vs the prior 8 days.

    Runs on the caller's (RLS-scoped) connection, so it only sees the tenant's rows
    — no cross-tenant leak, unlike a service-owned view. Returns {(op, route): z}
    for z > 3 only. Ported from mip-rum's v_ai_op_anomaly (ADR-0001, brief §3.3).
    """
    app_clause = " and app_id = %s" if app else ""
    params: tuple[Any, ...] = (app, app) if app else ()
    rows = conn.execute(
        "with daily as ("
        "  select coalesce(operation, '') op, coalesce(route, '') rt, "
        "         date_trunc('day', ts)::date d, sum(cost_usd) cost "
        "  from usage_events "
        "  where ts >= current_date - interval '8 days' and ts < current_date" + app_clause + " "
        "  group by 1, 2, 3), "
        "stats as ("
        "  select op, rt, avg(cost) mean, stddev_samp(cost) sd "
        "  from daily group by 1, 2 having count(*) >= 3 and stddev_samp(cost) > 0), "
        "recent as ("
        "  select coalesce(operation, '') op, coalesce(route, '') rt, "
        "         coalesce(sum(cost_usd), 0) cost "
        "  from usage_events where ts >= now() - interval '24 hours'" + app_clause + " "
        "  group by 1, 2) "
        "select nullif(r.op, ''), nullif(r.rt, ''), "
        "       round(((r.cost - s.mean) / s.sd)::numeric, 1) "
        "from recent r join stats s using (op, rt) where (r.cost - s.mean) / s.sd > 3",
        params,
    ).fetchall()
    return {(r[0], r[1]): float(r[2]) for r in rows}


def _where(
    window: str, agent_id: str | None, client_id: str | None, app: str | None = None
) -> tuple[str, list[Any]]:
    clauses = [f"ts >= now() - interval '{_WINDOWS[window]}'"]
    params: list[Any] = []
    if app:
        clauses.append("app_id = %s")
        params.append(app)
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
    app: str | None = None,
) -> dict[str, Any]:
    """Aggregate LLM calls for the tenant (RLS) into the AI-summary contract."""
    w = normalize_window(window)
    where, params = _where(w, agent_id, client_id, app)
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

    anom = anomalies(conn, app)
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
            "anomaly": (r[0], r[1]) in anom,
            "anomaly_score": anom.get((r[0], r[1])),
            # Phase 3 (front quality events):
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


# --- Fine-grained read endpoints (GET /ai, /ai/costs) --------------------------

_COST_GROUPS: dict[str, str] = {
    "user": "coalesce(user_hash, 'unattributed')",
    "model": "coalesce(model, 'unknown')",
    "route": "coalesce(route, 'unknown')",
}


def overview(
    conn: psycopg.Connection,
    *,
    window: str | None = None,
    agent_id: str | None = None,
    client_id: str | None = None,
    app: str | None = None,
    recent_limit: int = 50,
) -> dict[str, Any]:
    """Detail view: KPIs + by model/route + daily trend + the most recent calls."""
    w = normalize_window(window)
    where, params = _where(w, agent_id, client_id, app)
    p = tuple(params)
    kpi = conn.execute(
        "select count(*), coalesce(sum(total_tokens), 0), coalesce(sum(cost_usd), 0)::float8, "
        "percentile_cont(0.75) within group (order by latency_ms), "
        "avg((status = 'error')::int)::float8 from usage_events" + where,
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
    by_route = [
        {
            "route": r[0],
            "calls": int(r[1]),
            "cost_usd": float(r[2]),
            "tokens": int(r[3]),
            "p75_latency_ms": _round(r[4]),
            "error_rate": _round(r[5]),
        }
        for r in conn.execute(
            "select route, count(*), coalesce(sum(cost_usd), 0)::float8, "
            "coalesce(sum(total_tokens), 0), "
            "percentile_cont(0.75) within group (order by latency_ms), "
            "avg((status = 'error')::int)::float8 "
            "from usage_events" + where + " group by route order by 3 desc",
            p,
        ).fetchall()
    ]
    daily = [
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
    limit = max(1, min(recent_limit, 200))
    recent = [
        {
            "ts": r[0].isoformat() if r[0] else None,
            "provider": r[1],
            "model": r[2],
            "operation": r[3],
            "route": r[4],
            "total_tokens": r[5],
            "cost_usd": float(r[6]) if r[6] is not None else None,
            "latency_ms": r[7],
            "status": r[8],
        }
        for r in conn.execute(
            "select ts, provider, model, operation, route, total_tokens, cost_usd::float8, "
            "latency_ms, status from usage_events" + where + " order by ts desc limit %s",
            (*p, limit),
        ).fetchall()
    ]
    return {
        "window": w,
        "overview": {
            "calls": int(kpi[0]),
            "tokens": int(kpi[1]),
            "cost_usd": float(kpi[2]),
            "p75_latency_ms": _round(kpi[3]),
            "error_rate": _round(kpi[4]),
        },
        "by_model": by_model,
        "by_route": by_route,
        "daily": daily,
        "recent": recent,
    }


def costs(
    conn: psycopg.Connection,
    *,
    window: str | None = None,
    group_by: str = "model",
    agent_id: str | None = None,
    client_id: str | None = None,
    app: str | None = None,
) -> dict[str, Any]:
    """Spend grouped by one allowlisted dimension (user | model | route)."""
    gb = group_by if group_by in _COST_GROUPS else "model"
    col = _COST_GROUPS[gb]  # allowlisted expression, never raw input
    w = normalize_window(window)
    where, params = _where(w, agent_id, client_id, app)
    rows = conn.execute(
        f"select {col} k, count(*), coalesce(sum(cost_usd), 0)::float8, "
        "coalesce(sum(total_tokens), 0) "
        "from usage_events" + where + f" group by {col} order by 3 desc",
        tuple(params),
    ).fetchall()
    return {
        "group_by": gb,
        "rows": [
            {"key": str(r[0]), "calls": int(r[1]), "cost_usd": float(r[2]), "tokens": int(r[3])}
            for r in rows
        ],
    }
