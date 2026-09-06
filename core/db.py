"""PostgreSQL access helpers (Supabase is Postgres under the hood).

The backend connects as the DSN's own role and relies on **table ownership** for
writes and cross-tenant lookups (e.g. resolving a gateway token before the tenant
is known). Per-request, tenant-scoped reads set the role/JWT claims so RLS applies.

This docstring used to say the backend connects with a role that bypasses RLS
(`service_role`). It never did. `deploy/auth_compat.sql` is explicit about it —
"Nothing in xSOM connects or switches to service_role" — and nothing here issues a
`set role`. The distinction is load-bearing for deployment: `BYPASSRLS` needs a real
superuser, which RDS, Cloud SQL and Azure Flexible Server do not hand out, so a
product that genuinely required it could not run on managed Postgres at all
(`DEP-7`). It does not require it. Corrected under `FR-195`.
"""

from __future__ import annotations

import json
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


@contextmanager
def tenant_reader(
    dsn: str, *, user_id: str, tenant_id: str | None, role: str = "viewer"
) -> Iterator[psycopg.Connection]:
    """A read connection scoped to the caller's tenant by RLS (defense in depth).

    Switches to the ``authenticated`` role and sets the JWT claims for the
    transaction, so Postgres RLS — not just application code — enforces tenant
    isolation. A missing tenant_id yields a context that can read nothing.
    """
    claims = json.dumps(
        {
            "sub": user_id,
            "role": "authenticated",
            "app_metadata": {"tenant_id": tenant_id, "role": role},
        }
    )
    with connection(dsn) as conn, conn.transaction():
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
        yield conn
