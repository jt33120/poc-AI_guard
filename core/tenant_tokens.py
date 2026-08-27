"""Gateway tenant tokens (machine-to-machine auth for the MCP session).

The agent presents an opaque token when establishing the MCP session. Only the
SHA-256 hash is ever stored (CLAUDE.md §4.7); resolution is a constant-set
lookup by hash against active (non-revoked) tokens. A missing/unknown/revoked
token resolves to nothing and the session is refused — fail-closed (CLAUDE.md §4.4).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Any

import psycopg

#: Recognizable prefix for raw gateway tokens (the secret the agent presents).
TOKEN_PREFIX = "xsg_"  # noqa: S105 - public token prefix, not a secret


def generate_token() -> str:
    """Generate a new opaque tenant token (raw secret, shown once to the admin)."""
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _token_view(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "name": row[1],
        "created_at": _iso(row[2]),
        "last_used_at": _iso(row[3]),
        "revoked_at": _iso(row[4]),
    }


_VIEW_COLS = "id, name, created_at, last_used_at, revoked_at"


def mint(conn: psycopg.Connection, *, tenant_id: str, name: str) -> tuple[str, dict[str, Any]]:
    """Create a tenant gateway token: store only its hash, return the raw secret once."""
    raw = generate_token()
    row = conn.execute(
        f"insert into gateway_tokens (tenant_id, name, token_hash) values (%s, %s, %s) "
        f"returning {_VIEW_COLS}",
        (tenant_id, name, hash_token(raw)),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("gateway_token insert did not return a row")
    return raw, _token_view(row)


def list_tokens(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """List a tenant's gateway tokens (metadata only — never the raw secret)."""
    rows = conn.execute(
        f"select {_VIEW_COLS} from gateway_tokens where tenant_id = %s order by created_at desc",
        (tenant_id,),
    ).fetchall()
    return [_token_view(r) for r in rows]


def revoke(conn: psycopg.Connection, tenant_id: str, token_id: str) -> bool:
    """Revoke an active token scoped to the tenant. True only if one was revoked."""
    row = conn.execute(
        "update gateway_tokens set revoked_at = now() "
        "where id = %s and tenant_id = %s and revoked_at is null returning id",
        (token_id, tenant_id),
    ).fetchone()
    conn.commit()
    return row is not None


def hash_token(raw: str) -> str:
    """Return the SHA-256 hex digest stored in ``gateway_tokens.token_hash``."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def resolve_tenant(conn: psycopg.Connection, raw_token: str) -> str | None:
    """Return the tenant id for an active token, or None if it is not valid."""
    if not raw_token:
        return None
    row = conn.execute(
        "select tenant_id from gateway_tokens where token_hash = %s and revoked_at is null",
        (hash_token(raw_token),),
    ).fetchone()
    return str(row[0]) if row else None


def resolve_principal(conn: psycopg.Connection, raw_token: str) -> tuple[str, str] | None:
    """Return ``(token_id, tenant_id)`` for an active token, or None if invalid.

    The token id lets the caller attribute audit/usage records to a specific
    agent (the gateway token), not just its tenant.
    """
    if not raw_token:
        return None
    row = conn.execute(
        "select id, tenant_id from gateway_tokens where token_hash = %s and revoked_at is null",
        (hash_token(raw_token),),
    ).fetchone()
    return (str(row[0]), str(row[1])) if row else None


def resolve_client_id(conn: psycopg.Connection, raw_token: str) -> str | None:
    """Return the client id an active token belongs to (for per-tool RBAC), or None."""
    if not raw_token:
        return None
    row = conn.execute(
        "select client_id from gateway_tokens where token_hash = %s and revoked_at is null",
        (hash_token(raw_token),),
    ).fetchone()
    return str(row[0]) if row and row[0] is not None else None


def authenticate_gateway_principal(conn: psycopg.Connection, raw_token: str) -> tuple[str, str]:
    """Resolve ``(token_id, tenant_id)`` for a session or raise — fail-closed.

    Raises:
        PermissionError: if the token is missing, unknown, or revoked.
    """
    principal = resolve_principal(conn, raw_token)
    if principal is None:
        raise PermissionError("invalid or missing tenant token")
    conn.execute(
        "update gateway_tokens set last_used_at = now() where token_hash = %s",
        (hash_token(raw_token),),
    )
    return principal


def authenticate_gateway_session(conn: psycopg.Connection, raw_token: str) -> tuple[str, str]:
    """Resolve ``(tenant_id, token_id)`` for an MCP session or raise — fail-closed.

    The token id is the agent's identity: the persisted taint (`FR-154`) and the
    observation windows (`G-25`) are both keyed on it, so an agent cannot mint
    itself a clean one by reconnecting or by declaring a new session.

    Raises:
        PermissionError: if the token is missing, unknown, or revoked.
    """
    principal = resolve_principal(conn, raw_token)
    if principal is None:
        raise PermissionError("invalid or missing tenant token")
    token_id, tenant_id = principal
    conn.execute(
        "update gateway_tokens set last_used_at = now() where token_hash = %s",
        (hash_token(raw_token),),
    )
    return tenant_id, token_id
