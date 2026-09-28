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

import atexit
import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import pq
from psycopg_pool import ConnectionPool

#: How long a caller waits for a pooled connection before the request fails.
_POOL_WAIT_S = 10.0
#: A connection is replaced after this long, so none outlives a failover.
_POOL_MAX_LIFETIME_S = 30 * 60.0
#: An idle connection beyond the minimum is closed after this long.
_POOL_MAX_IDLE_S = 5 * 60.0

_pool_max = 0
_pools: dict[str, ConnectionPool] = {}
_pools_lock = threading.Lock()


def connect(dsn: str) -> psycopg.Connection:
    """Open a new connection to ``dsn`` (caller owns its lifecycle)."""
    return psycopg.connect(dsn)


def configure_pool(max_size: int) -> None:
    """Reuse up to ``max_size`` connections per DSN in this process; 0 disables it.

    **Why.** Every `connection()` used to open a fresh TLS connection. Against a
    managed database that costs about 1.5 s on Railway, so `/v1/ai-traces`, which
    opens two, answered in 3 s and its callers timed out (HTTP 499).

    **What a reused connection must not carry.** Tenant isolation rides on
    `set local role` and `set_config(..., true)`, both scoped to a transaction.
    A pooled connection is still reset with `DISCARD ALL` before it is lent
    again, so no role, setting or temporary object crosses from one request to
    the next even if a caller forgot the `local`. Server-side prepared
    statements are off (`prepare_threshold=None`): `DISCARD ALL` drops them.
    """
    global _pool_max
    with _pools_lock:
        _pool_max = max_size
        if max_size == 0:
            _close_locked()


def _reset(conn: psycopg.Connection) -> None:
    conn.autocommit = True
    try:
        conn.execute("discard all")
    finally:
        conn.autocommit = False


def _pool_for(dsn: str) -> ConnectionPool | None:
    with _pools_lock:
        if _pool_max == 0:
            return None
        pool = _pools.get(dsn)
        if pool is None:
            pool = ConnectionPool(
                dsn,
                min_size=1,
                max_size=_pool_max,
                kwargs={"prepare_threshold": None},
                reset=_reset,
                check=ConnectionPool.check_connection,
                timeout=_POOL_WAIT_S,
                max_lifetime=_POOL_MAX_LIFETIME_S,
                max_idle=_POOL_MAX_IDLE_S,
                name="xsom",
                open=True,
            )
            _pools[dsn] = pool
        return pool


def _close_locked() -> None:
    for pool in _pools.values():
        pool.close()
    _pools.clear()


def close_pools() -> None:
    """Close every pooled connection (process exit, tests)."""
    with _pools_lock:
        _close_locked()


atexit.register(close_pools)


@contextmanager
def connection(dsn: str) -> Iterator[psycopg.Connection]:
    """A connection for one unit of work; uncommitted work is always discarded.

    Without a pool the connection is opened and closed here. With one it is
    borrowed and returned, after the same rollback closing would have done.
    """
    pool = _pool_for(dsn)
    if pool is None:
        conn = connect(dsn)
        try:
            yield conn
        finally:
            conn.close()
        return
    conn = pool.getconn()
    try:
        yield conn
    finally:
        try:
            if conn.info.transaction_status != pq.TransactionStatus.IDLE:
                conn.rollback()
        except psycopg.Error:
            conn.close()  # A broken connection is replaced, never lent again.
        pool.putconn(conn)


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
