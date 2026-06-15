"""Row Level Security: a member of tenant A cannot read tenant B (CLAUDE.md §4.3)."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import psycopg

from tests.conftest import DBHandle


def _act_as(conn: psycopg.Connection, user_id: UUID, tenant_id: UUID) -> None:
    """Switch the open transaction to the `authenticated` role with JWT claims."""
    claims = json.dumps(
        {
            "sub": str(user_id),
            "role": "authenticated",
            "app_metadata": {"tenant_id": str(tenant_id), "role": "admin"},
        }
    )
    conn.execute("set local role authenticated")
    # SET doesn't take bind params; set_config(..., is_local=true) is the SET LOCAL equivalent.
    conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def test_tenant_isolation_via_rls(db: DBHandle) -> None:
    conn = db.conn
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

    # As user A: sees only tenant A.
    with conn.transaction():
        _act_as(conn, user_a, tenant_a)
        tenants = {row[0] for row in conn.execute("select id from tenants").fetchall()}
        members = {row[0] for row in conn.execute("select tenant_id from memberships").fetchall()}
    assert tenants == {tenant_a}
    assert members == {tenant_a}
    assert tenant_b not in tenants

    # As user B: sees only tenant B.
    with conn.transaction():
        _act_as(conn, user_b, tenant_b)
        tenants_b = {row[0] for row in conn.execute("select id from tenants").fetchall()}
    assert tenants_b == {tenant_b}


def test_authenticated_without_claims_sees_nothing(db: DBHandle) -> None:
    conn = db.conn
    conn.execute("insert into tenants (id, name) values (%s, 'A')", (uuid4(),))
    conn.commit()
    with conn.transaction():
        conn.execute("set local role authenticated")  # no JWT claims set
        rows = conn.execute("select id from tenants").fetchall()
    assert rows == []
