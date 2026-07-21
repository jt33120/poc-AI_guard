"""LLM token-usage + cost ledger (operational metrics, not the audit log).

The monitoring proxy records one ``usage_events`` row per inspected completion:
provider, model, token counts and an estimated cost (``core.pricing``). Reads are
tenant-scoped by RLS; aggregations power the cost dashboard, optionally filtered
to a single agent (gateway token). Only counts + price are stored — never content
or PII (CLAUDE.md §4.10).
"""

from __future__ import annotations

from typing import Any

import psycopg

from core.otlp_genai import AiCall


def record_usage(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
    request_id: str | None = None,
    latency_ms: float | None = None,
) -> None:
    """Append a usage row (caller commits)."""
    conn.execute(
        "insert into usage_events "
        "(tenant_id, gateway_token_id, provider, model, prompt_tokens, completion_tokens, "
        " total_tokens, cost_usd, request_id, latency_ms) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            tenant_id,
            gateway_token_id,
            provider,
            model,
            prompt_tokens,
            completion_tokens,
            prompt_tokens + completion_tokens,
            cost_usd,
            request_id,
            latency_ms,
        ),
    )


def record_ai_calls(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    gateway_token_id: str | None,
    calls: list[AiCall],
) -> int:
    """Insert OTLP-sourced LLM calls, idempotent on span_id. Returns rows inserted."""
    inserted = 0
    for c in calls:
        row = conn.execute(
            "insert into usage_events "
            "(tenant_id, gateway_token_id, source, span_id, trace_id, session_id, app_id, "
            " provider, model, operation, route, prompt_tokens, completion_tokens, total_tokens, "
            " cost_usd, latency_ms, ttft_ms, status, error_type, user_hash, request_id, ts) "
            "values (%s, %s, 'otlp', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            " %s, %s, %s, %s) "
            "on conflict (span_id) where span_id is not null do nothing returning id",
            (
                tenant_id,
                gateway_token_id,
                c.span_id,
                c.trace_id,
                c.session_id,
                c.app_id,
                c.provider,
                c.model,
                c.operation,
                c.route,
                c.prompt_tokens,
                c.completion_tokens,
                c.total_tokens,
                c.cost_usd,
                c.latency_ms,
                c.ttft_ms,
                c.status,
                c.error_type,
                c.user_hash,
                c.trace_id,
                c.ts,
            ),
        ).fetchone()
        if row is not None:
            inserted += 1
    return inserted


def purge_older_than(conn: psycopg.Connection, *, days: int) -> int:
    """Retention: delete usage rows older than ``days``. Returns rows removed."""
    row = conn.execute(
        "with d as (delete from usage_events where ts < now() - make_interval(days => %s) "
        "returning 1) select count(*) from d",
        (days,),
    ).fetchone()
    return int(row[0]) if row else 0


def erase_session(conn: psycopg.Connection, *, session_id: str) -> int:
    """RGPD erasure: delete every usage row for a session id. Returns rows removed."""
    row = conn.execute(
        "with d as (delete from usage_events where session_id = %s returning 1) "
        "select count(*) from d",
        (session_id,),
    ).fetchone()
    return int(row[0]) if row else 0


def _filters(
    agent_id: str | None,
    from_ts: str | None,
    to_ts: str | None,
    client_id: str | None = None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if agent_id:
        clauses.append("gateway_token_id = %s")
        params.append(agent_id)
    if client_id:
        clauses.append("gateway_token_id in (select id from gateway_tokens where client_id = %s)")
        params.append(client_id)
    if from_ts:
        clauses.append("ts >= %s")
        params.append(from_ts)
    if to_ts:
        clauses.append("ts <= %s")
        params.append(to_ts)
    where = (" where " + " and ".join(clauses)) if clauses else ""
    return where, params


def summary(
    conn: psycopg.Connection,
    *,
    agent_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    client_id: str | None = None,
) -> dict[str, Any]:
    """Aggregate spend/tokens for the tenant (RLS-scoped), optionally per agent/client."""
    where, params = _filters(agent_id, from_ts, to_ts, client_id)
    totals = conn.execute(
        "select coalesce(sum(cost_usd), 0)::float8, coalesce(sum(total_tokens), 0), "
        "coalesce(sum(prompt_tokens), 0), coalesce(sum(completion_tokens), 0), count(*) "
        "from usage_events" + where,
        tuple(params),
    ).fetchone()
    if totals is None:  # pragma: no cover - an aggregate with no GROUP BY always returns a row
        totals = (0.0, 0, 0, 0, 0)

    def buckets(column: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            f"select {column}, coalesce(sum(cost_usd), 0)::float8, "
            "coalesce(sum(total_tokens), 0), count(*) "
            "from usage_events" + where + f" group by {column} order by 2 desc",
            tuple(params),
        ).fetchall()
        return [
            {
                "key": str(r[0]) if r[0] is not None else "unknown",
                "cost_usd": float(r[1]),
                "tokens": int(r[2]),
                "calls": int(r[3]),
            }
            for r in rows
        ]

    daily = conn.execute(
        "select to_char(date_trunc('day', ts), 'YYYY-MM-DD'), "
        "coalesce(sum(cost_usd), 0)::float8, coalesce(sum(total_tokens), 0) "
        "from usage_events" + where + " group by 1 order by 1 desc limit 30",
        tuple(params),
    ).fetchall()

    return {
        "total_cost_usd": float(totals[0]),
        "total_tokens": int(totals[1]),
        "prompt_tokens": int(totals[2]),
        "completion_tokens": int(totals[3]),
        "calls": int(totals[4]),
        "by_provider": buckets("provider"),
        "by_model": buckets("model"),
        "by_agent": buckets("gateway_token_id"),
        "daily": [
            {"date": r[0], "cost_usd": float(r[1]), "tokens": int(r[2])} for r in reversed(daily)
        ],
    }
