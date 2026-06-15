"""Downstream server records (CRUD data access) — SPEC §4/§8 (M2).

Reads through a control-API connection rely on RLS (tenant_reader); writes use
a service connection and always scope by tenant_id explicitly.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Json


def _row_to_dict(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "name": row[1],
        "transport": row[2],
        "config": row[3],
        "enabled": row[4],
    }


def list_servers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """List servers visible to the connection (tenant-scoped by RLS)."""
    rows = conn.execute(
        "select id, name, transport, config, enabled from downstream_servers order by name"
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


def enabled_specs(
    conn: psycopg.Connection, tenant_id: str
) -> list[tuple[str, str, dict[str, Any]]]:
    """Return (name, transport, config) for a tenant's enabled servers (service read)."""
    rows = conn.execute(
        "select name, transport, config from downstream_servers "
        "where tenant_id = %s and enabled order by name",
        (tenant_id,),
    ).fetchall()
    return [(row[0], row[1], row[2]) for row in rows]


def create_server(
    conn: psycopg.Connection,
    tenant_id: str,
    name: str,
    transport: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Insert a server for a tenant (service write); raises on duplicate name."""
    row = conn.execute(
        "insert into downstream_servers (tenant_id, name, transport, config) "
        "values (%s, %s, %s, %s) "
        "returning id, name, transport, config, enabled",
        (tenant_id, name, transport, Json(config)),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("insert did not return a row")
    return _row_to_dict(row)


def update_server(
    conn: psycopg.Connection,
    tenant_id: str,
    server_id: str,
    *,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    enabled: bool | None = None,
) -> dict[str, Any] | None:
    """Update a tenant's server (service write); None if it does not exist."""
    row = conn.execute(
        "update downstream_servers set "
        "name = coalesce(%s, name), "
        "config = coalesce(%s, config), "
        "enabled = coalesce(%s, enabled) "
        "where id = %s and tenant_id = %s "
        "returning id, name, transport, config, enabled",
        (name, Json(config) if config is not None else None, enabled, server_id, tenant_id),
    ).fetchone()
    conn.commit()
    return _row_to_dict(row) if row else None
