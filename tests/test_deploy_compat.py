"""deploy/auth_compat.sql is a drop-in for Supabase's auth surface.

The claim the compose stack rests on is that the shipped migrations apply, and
their RLS policies still isolate tenants, on a plain PostgreSQL cluster. These
tests assert exactly that — against a real cluster, with the runner in
``core.migrate``, not against the test-only shim.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql

from core import migrate
from tests import pgcluster
from tests.conftest import DBHandle

_COMPAT_SQL = Path(__file__).resolve().parent.parent / "deploy" / "auth_compat.sql"


@pytest.fixture
def compat_db(pg_cluster: pgcluster.EphemeralPostgres) -> Iterator[DBHandle]:
    """A virgin database prepared the way docker-compose.yml prepares one.

    auth_compat.sql first (the bundled Postgres runs it from
    /docker-entrypoint-initdb.d), then the migration runner — no test shim
    anywhere in the path.
    """
    dbname = f"c_{uuid4().hex[:12]}"
    admin = psycopg.connect(pg_cluster.base_url(), autocommit=True)
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    url = pg_cluster.url_for(dbname)
    pg_cluster.psql_apply(url, _COMPAT_SQL)
    conn = psycopg.connect(url)
    try:
        yield DBHandle(url=url, conn=conn)
    finally:
        conn.close()
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dbname)))
        admin.close()


def _act_as(conn: psycopg.Connection, user_id: UUID, tenant_id: UUID) -> None:
    """Switch the open transaction to `authenticated` with JWT claims set."""
    claims = json.dumps(
        {
            "sub": str(user_id),
            "role": "authenticated",
            "app_metadata": {"tenant_id": str(tenant_id), "role": "admin"},
        }
    )
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def test_migrations_apply_on_top_of_the_compat_layer(compat_db: DBHandle) -> None:
    applied = migrate.apply_all(compat_db.conn)
    assert applied == [p.name for p in sorted(migrate.MIGRATIONS_DIR.glob("*.sql"))]
    assert migrate.pending(compat_db.conn) == []


def test_rls_still_isolates_tenants_without_supabase(compat_db: DBHandle) -> None:
    conn = compat_db.conn
    migrate.apply_all(conn)
    tenant_a, tenant_b = uuid4(), uuid4()
    user_a, user_b = uuid4(), uuid4()
    conn.execute("insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b))
    conn.execute("insert into auth.users (id) values (%s), (%s)", (user_a, user_b))
    conn.execute(
        "insert into memberships (user_id, tenant_id, role) "
        "values (%s, %s, 'admin'), (%s, %s, 'admin')",
        (user_a, tenant_a, user_b, tenant_b),
    )
    conn.commit()

    with conn.transaction():
        _act_as(conn, user_a, tenant_a)
        visible = {row[0] for row in conn.execute("select id from tenants").fetchall()}
    assert visible == {tenant_a}


def test_authenticated_without_claims_sees_nothing(compat_db: DBHandle) -> None:
    conn = compat_db.conn
    migrate.apply_all(conn)
    conn.execute("insert into tenants (id, name) values (%s, 'A')", (uuid4(),))
    conn.commit()
    with conn.transaction():
        conn.execute("set local role authenticated")  # no claims on the connection
        assert conn.execute("select id from tenants").fetchall() == []


def test_reapplying_the_compat_layer_is_a_no_op(
    compat_db: DBHandle, pg_cluster: pgcluster.EphemeralPostgres
) -> None:
    """Operators re-run it after an upgrade; it must never fail or drop data."""
    migrate.apply_all(compat_db.conn)
    user_id = uuid4()
    compat_db.conn.execute("insert into auth.users (id) values (%s)", (user_id,))
    compat_db.conn.commit()

    pg_cluster.psql_apply(compat_db.url, _COMPAT_SQL)

    rows = compat_db.conn.execute("select id from auth.users").fetchall()
    assert rows == [(user_id,)]
    assert migrate.pending(compat_db.conn) == []


def test_compat_functions_are_security_invoker(compat_db: DBHandle) -> None:
    """A SECURITY DEFINER function reachable from an RLS policy is an escalation."""
    rows = compat_db.conn.execute(
        "select p.proname, p.prosecdef from pg_proc p "
        "join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth'"
    ).fetchall()
    assert {name for name, _ in rows} == {"jwt", "uid", "role"}
    assert [name for name, secdef in rows if secdef] == []
