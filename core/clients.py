"""Client/project entities: the things a tenant monitors, with cost rollups.

A client groups agents (gateway tokens); spend/usage/audit aggregate per client so
a freelance or an org can see "cost per client". Reads are RLS-scoped; writes go
through the backend role and are explicitly scoped to the tenant.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


def _view(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "name": row[1],
        "website": row[2],
        "created_at": _iso(row[3]),
    }


def create_client(
    conn: psycopg.Connection, *, tenant_id: str, name: str, website: str | None = None
) -> dict[str, Any]:
    row = conn.execute(
        "insert into clients (tenant_id, name, website) values (%s, %s, %s) "
        "returning id, name, website, created_at",
        (tenant_id, name, website),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("clients insert did not return a row")
    return _view(row)


def update_client(
    conn: psycopg.Connection,
    tenant_id: str,
    client_id: str,
    *,
    name: str | None = None,
    website: str | None = None,
    set_website: bool = False,
) -> dict[str, Any] | None:
    """Patch a client's name/website (scoped to the tenant)."""
    sets: list[str] = []
    params: list[Any] = []
    if name is not None:
        sets.append("name = %s")
        params.append(name)
    if set_website:
        sets.append("website = %s")
        params.append(website)
    if not sets:
        row = conn.execute(
            "select id, name, website, created_at from clients "
            "where id = %s and tenant_id = %s and archived_at is null",
            (client_id, tenant_id),
        ).fetchone()
        return _view(row) if row else None
    params.extend([client_id, tenant_id])
    row = conn.execute(
        f"update clients set {', '.join(sets)} "
        "where id = %s and tenant_id = %s and archived_at is null "
        "returning id, name, website, created_at",
        tuple(params),
    ).fetchone()
    conn.commit()
    return _view(row) if row else None


def archive_client(conn: psycopg.Connection, tenant_id: str, client_id: str) -> bool:
    """Soft-delete a client; its agents are detached (client_id set null by FK)."""
    row = conn.execute(
        "update clients set archived_at = now() "
        "where id = %s and tenant_id = %s and archived_at is null returning id",
        (client_id, tenant_id),
    ).fetchone()
    conn.commit()
    return row is not None


def assign_agent(
    conn: psycopg.Connection, tenant_id: str, token_id: str, client_id: str | None
) -> bool:
    """Attach an agent to a client (or detach with client_id=None). Both tenant-scoped."""
    row = conn.execute(
        "update gateway_tokens set client_id = %(cid)s::uuid "
        "where id = %(tid)s::uuid and tenant_id = %(ten)s::uuid "
        "and (%(cid)s::uuid is null or "
        "     %(cid)s::uuid in (select id from clients where tenant_id = %(ten)s::uuid)) "
        "returning id",
        {"cid": client_id, "tid": token_id, "ten": tenant_id},
    ).fetchone()
    conn.commit()
    return row is not None


def list_clients(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """Active clients with per-client rollups (agents, actions, estimated/billed spend)."""
    rows = conn.execute(
        "select c.id, c.name, c.website, c.created_at, "
        "count(distinct g.id) filter (where g.revoked_at is null) as agents, "
        "coalesce(sum(u.cost), 0)::float8 as est_cost, "
        "coalesce(sum(u.tokens), 0) as tokens, "
        "coalesce(sum(b.billed), 0)::float8 as billed, "
        "coalesce(sum(a.actions), 0) as actions "
        "from clients c "
        "left join gateway_tokens g on g.client_id = c.id "
        "left join (select gateway_token_id, sum(cost_usd) cost, sum(total_tokens) tokens "
        "  from usage_events group by gateway_token_id) u on u.gateway_token_id = g.id "
        "left join (select gateway_token_id, sum(amount_usd) billed "
        "  from billed_cost group by gateway_token_id) b on b.gateway_token_id = g.id "
        "left join (select gateway_token_id, count(*) actions "
        "  from audit_log group by gateway_token_id) a on a.gateway_token_id = g.id "
        "where c.tenant_id = %s and c.archived_at is null "
        "group by c.id, c.name, c.website, c.created_at "
        "order by c.created_at desc",
        (tenant_id,),
    ).fetchall()
    return [
        {
            "id": str(r[0]),
            "name": r[1],
            "website": r[2],
            "created_at": _iso(r[3]),
            "agents": int(r[4]),
            "est_cost_usd": float(r[5]),
            "tokens": int(r[6]),
            "billed_cost_usd": float(r[7]),
            "actions": int(r[8]),
        }
        for r in rows
    ]
