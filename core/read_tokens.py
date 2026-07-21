"""Read tokens: opaque, tenant-scoped, read-only credentials for the /ai read API.

Server-to-server callers (e.g. the mip-rum facade) present a read token instead
of a console JWT. Only the SHA-256 hash is stored (CLAUDE.md §4.7); resolution is
a hash lookup against active tokens. Unlike a gateway token, a read token cannot
ingest — it only authorizes reads. Fail-closed: unknown/revoked resolves to None.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Any

import psycopg

#: Recognizable prefix for raw read tokens (distinct from ingest tokens `xsg_`).
TOKEN_PREFIX = "xsr_"  # noqa: S105 - public token prefix, not a secret

_VIEW_COLS = "id, name, created_at, last_used_at, revoked_at"


def generate_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _view(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "name": row[1],
        "created_at": _iso(row[2]),
        "last_used_at": _iso(row[3]),
        "revoked_at": _iso(row[4]),
    }


def mint(conn: psycopg.Connection, *, tenant_id: str, name: str) -> tuple[str, dict[str, Any]]:
    """Create a read token: store only its hash, return the raw secret once."""
    raw = generate_token()
    row = conn.execute(
        f"insert into read_tokens (tenant_id, name, token_hash) values (%s, %s, %s) "
        f"returning {_VIEW_COLS}",
        (tenant_id, name, hash_token(raw)),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("read_token insert did not return a row")
    return raw, _view(row)


def list_tokens(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"select {_VIEW_COLS} from read_tokens where tenant_id = %s order by created_at desc",
        (tenant_id,),
    ).fetchall()
    return [_view(r) for r in rows]


def revoke(conn: psycopg.Connection, tenant_id: str, token_id: str) -> bool:
    row = conn.execute(
        "update read_tokens set revoked_at = now() "
        "where id = %s and tenant_id = %s and revoked_at is null returning id",
        (token_id, tenant_id),
    ).fetchone()
    conn.commit()
    return row is not None


def resolve_tenant(conn: psycopg.Connection, raw_token: str) -> str | None:
    """Return the tenant id for an active read token, or None if it is not valid."""
    if not raw_token:
        return None
    row = conn.execute(
        "select tenant_id from read_tokens where token_hash = %s and revoked_at is null",
        (hash_token(raw_token),),
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "update read_tokens set last_used_at = now() where token_hash = %s",
        (hash_token(raw_token),),
    )
    conn.commit()
    return str(row[0])
