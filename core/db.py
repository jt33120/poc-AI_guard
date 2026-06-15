"""PostgreSQL access helpers (Supabase is Postgres under the hood).

The backend connects with a role that bypasses RLS (service_role) for writes
and cross-tenant lookups (e.g. resolving a gateway token before the tenant is
known). Per-request, tenant-scoped reads set the role/JWT claims so RLS applies.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg


def connect(dsn: str) -> psycopg.Connection:
    """Open a new connection to ``dsn`` (caller owns its lifecycle)."""
    return psycopg.connect(dsn)


@contextmanager
def connection(dsn: str) -> Iterator[psycopg.Connection]:
    """Context-managed connection that always closes."""
    conn = connect(dsn)
    try:
        yield conn
    finally:
        conn.close()
