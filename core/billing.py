"""Authoritative, provider-reported cost — the source of truth.

Distinct from ``usage_events`` (token counts x our price table = an *estimate*),
``billed_cost`` holds amounts the provider itself reports. OpenRouter returns the
real per-call cost inline; other providers will be filled by billing-API
connectors. Reads are RLS-scoped; only amounts/ids are stored, never content.
"""

from __future__ import annotations

from typing import Any

import psycopg


def record_billed(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    gateway_token_id: str | None,
    provider: str,
    source: str,
    model: str | None,
    amount_usd: float,
    currency: str = "USD",
    external_id: str | None = None,
) -> None:
    """Insert an authoritative cost line; dedupe on (provider, source, external_id)."""
    conn.execute(
        "insert into billed_cost "
        "(tenant_id, gateway_token_id, provider, source, model, amount_usd, currency, external_id) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s) "
        "on conflict (tenant_id, provider, source, external_id) "
        "where external_id is not null do nothing",
        (tenant_id, gateway_token_id, provider, source, model, amount_usd, currency, external_id),
    )


def total_billed(
    conn: psycopg.Connection,
    *,
    agent_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    client_id: str | None = None,
) -> float:
    """Sum of authoritative billed cost for the tenant (RLS-scoped), per agent/client."""
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
    row = conn.execute(
        "select coalesce(sum(amount_usd), 0)::float8 from billed_cost" + where, tuple(params)
    ).fetchone()
    return float(row[0]) if row else 0.0
