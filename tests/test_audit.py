"""Immutable hash-chained audit log: chaining, tamper detection, append-only (M5)."""

from __future__ import annotations

import psycopg
import pytest

from core import audit
from tests.conftest import DBHandle


def test_log_event_chains_entries(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b", args_hash="x" * 64)
    audit.log_event(db.conn, tenant_id="t1", decision="deny", tool_name="a.c", args_hash="y" * 64)
    rows = db.conn.execute("select prev_hash, entry_hash from audit_log order by id").fetchall()
    assert rows[0][0] == audit.GENESIS
    assert rows[1][0] == rows[0][1]  # each entry chains to the previous one
    result = audit.verify_chain(db.conn, "t1")
    assert result.ok is True and result.count == 2


def test_verify_chain_detects_tampering(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b")
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.c")
    # Simulate an attacker with elevated access bypassing the append-only triggers.
    with db.conn.transaction():
        db.conn.execute("set local session_replication_role = replica")
        db.conn.execute(
            "update audit_log set decision = 'deny' where id = (select min(id) from audit_log)"
        )
    result = audit.verify_chain(db.conn, "t1")
    assert result.ok is False and result.broken_id is not None


def test_only_args_hash_is_stored(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", args_hash="a" * 64)
    row = db.conn.execute("select args_hash from audit_log limit 1").fetchone()
    assert row is not None and len(row[0]) == 64
    cols = {
        r[0]
        for r in db.conn.execute(
            "select column_name from information_schema.columns where table_name = 'audit_log'"
        ).fetchall()
    }
    assert "arguments" not in cols and "args" not in cols  # no raw-args column exists


def test_append_only_triggers_block_update_and_delete(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow")
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("update audit_log set decision = 'x'")
    db.conn.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        db.conn.execute("delete from audit_log")
    db.conn.rollback()


def test_chain_is_per_tenant(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow")
    audit.log_event(db.conn, tenant_id="t2", decision="allow")
    rows = db.conn.execute("select prev_hash from audit_log order by id").fetchall()
    assert all(r[0] == audit.GENESIS for r in rows)  # each tenant starts from GENESIS
    assert audit.verify_chain(db.conn).ok is True
