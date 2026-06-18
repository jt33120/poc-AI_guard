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
) -> None:
    """Append a usage row (caller commits)."""
    conn.execute(
        "insert into usage_events "
        "(tenant_id, gateway_token_id, provider, model, prompt_tokens, completion_tokens, "
        " total_tokens, cost_usd, request_id) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
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
        ),
    )


def _filters(agent_id: str | None, from_ts: str | None, to_ts: str | None) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if agent_id:
        clauses.append("gateway_token_id = %s")
        params.append(agent_id)
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
) -> dict[str, Any]:
    """Aggregate spend/tokens for the tenant (RLS-scoped), optionally per agent."""
    where, params = _filters(agent_id, from_ts, to_ts)
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
