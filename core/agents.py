"""Per-agent overview: the customer and each monitored agent (gateway token).

An "agent" is a gateway token a customer minted for one of its AI agents. This
joins each token to what it has actually done — decisions audited and LLM spend —
so the dashboard can show "Customer X · N agents" and offer an all/one selector.
All reads are tenant-scoped by RLS; safe for any tenant member (incl. viewers).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


def tenant_name(conn: psycopg.Connection, tenant_id: str) -> str | None:
    """The customer (tenant) display name, or None if not visible."""
    row = conn.execute("select name from tenants where id = %s", (tenant_id,)).fetchone()
    return row[0] if row else None


def list_agents(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Each gateway token with its audited-action count, last activity and spend."""
    rows = conn.execute(
        "select g.id, g.name, g.created_at, g.last_used_at, g.revoked_at, "
        "coalesce(a.actions, 0), a.last_action, coalesce(u.cost, 0)::float8, "
        "coalesce(u.tokens, 0), g.client_id, cl.name "
        "from gateway_tokens g "
        "left join clients cl on cl.id = g.client_id "
        "left join (select gateway_token_id, count(*) as actions, max(ts) as last_action "
        "  from audit_log group by gateway_token_id) a on a.gateway_token_id = g.id "
        "left join (select gateway_token_id, sum(cost_usd) as cost, sum(total_tokens) as tokens "
        "  from usage_events group by gateway_token_id) u on u.gateway_token_id = g.id "
        "order by (g.revoked_at is not null), coalesce(a.last_action, g.created_at) desc"
    ).fetchall()
    return [
        {
            "id": str(r[0]),
            "name": r[1],
            "created_at": _iso(r[2]),
            "last_active": _iso(r[6]) if r[6] else _iso(r[3]),
            "revoked": r[4] is not None,
            "actions": int(r[5]),
            "spend_usd": float(r[7]),
            "tokens": int(r[8]),
            "client_id": str(r[9]) if r[9] else None,
            "client_name": r[10],
        }
        for r in rows
    ]


def overview(conn: psycopg.Connection, tenant_id: str) -> dict[str, Any]:
    """Customer name + monitored agents (active count excludes revoked tokens)."""
    agents = list_agents(conn)
    return {
        "customer": tenant_name(conn, tenant_id),
        "agent_count": sum(1 for a in agents if not a["revoked"]),
        "agents": agents,
    }
