"""Gateway tenant tokens: hashing + fail-closed resolution (CLAUDE.md §4.4/§4.7)."""

from __future__ import annotations

from uuid import uuid4

import psycopg
import pytest

from core.tenant_tokens import (
    authenticate_gateway_session,
    generate_token,
    hash_token,
    resolve_tenant,
)
from tests.conftest import DBHandle


def _seed_token(conn: psycopg.Connection, *, revoked: bool = False) -> tuple[str, str]:
    tenant_id = uuid4()
    raw = generate_token()
    conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    conn.execute(
        "insert into gateway_tokens (tenant_id, name, token_hash) values (%s, 'cli', %s)",
        (tenant_id, hash_token(raw)),
    )
    if revoked:
        conn.execute(
            "update gateway_tokens set revoked_at = now() where token_hash = %s",
            (hash_token(raw),),
        )
    conn.commit()
    return str(tenant_id), raw


def test_hash_token_is_stable_sha256_hex() -> None:
    digest = hash_token("abc")
    assert len(digest) == 64
    assert digest == hash_token("abc")


def test_generate_token_is_unique() -> None:
    assert generate_token() != generate_token()


def test_resolve_valid_token(db: DBHandle) -> None:
    tenant_id, raw = _seed_token(db.conn)
    assert resolve_tenant(db.conn, raw) == tenant_id


def test_resolve_unknown_token_returns_none(db: DBHandle) -> None:
    assert resolve_tenant(db.conn, "does-not-exist") is None


def test_resolve_revoked_token_returns_none(db: DBHandle) -> None:
    _, raw = _seed_token(db.conn, revoked=True)
    assert resolve_tenant(db.conn, raw) is None


def test_authenticate_valid_token_marks_last_used(db: DBHandle) -> None:
    tenant_id, raw = _seed_token(db.conn)
    assert authenticate_gateway_session(db.conn, raw)[0] == tenant_id
    row = db.conn.execute(
        "select last_used_at from gateway_tokens where token_hash = %s", (hash_token(raw),)
    ).fetchone()
    assert row is not None and row[0] is not None


def test_authenticate_missing_token_is_refused(db: DBHandle) -> None:
    with pytest.raises(PermissionError):
        authenticate_gateway_session(db.conn, "")


def test_authenticate_revoked_token_is_refused(db: DBHandle) -> None:
    _, raw = _seed_token(db.conn, revoked=True)
    with pytest.raises(PermissionError):
        authenticate_gateway_session(db.conn, raw)
