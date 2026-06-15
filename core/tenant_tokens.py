"""Gateway tenant tokens (machine-to-machine auth for the MCP session).

The agent presents an opaque token when establishing the MCP session. Only the
SHA-256 hash is ever stored (CLAUDE.md §4.7); resolution is a constant-set
lookup by hash against active (non-revoked) tokens. A missing/unknown/revoked
token resolves to nothing and the session is refused — fail-closed (CLAUDE.md §4.4).
"""

from __future__ import annotations

import hashlib
import secrets

import psycopg


def generate_token() -> str:
    """Generate a new opaque tenant token (raw secret, shown once to the admin)."""
    return secrets.token_urlsafe(32)


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


def authenticate_gateway_session(conn: psycopg.Connection, raw_token: str) -> str:
    """Resolve the tenant for an MCP session or raise — fail-closed.

    Raises:
        PermissionError: if the token is missing, unknown, or revoked.
    """
    tenant_id = resolve_tenant(conn, raw_token)
    if tenant_id is None:
        raise PermissionError("invalid or missing tenant token")
    conn.execute(
        "update gateway_tokens set last_used_at = now() where token_hash = %s",
        (hash_token(raw_token),),
    )
    return tenant_id
