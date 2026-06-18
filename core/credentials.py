"""Customer provider credentials: store encrypted, read backend-only.

A credential (an OpenAI/Anthropic/Mistral/OpenRouter/cloud key used to pull
authoritative billing) is envelope-encrypted (:mod:`core.secrets`) before it ever
hits the database, and only its **metadata** is ever returned by the API — the
plaintext is recoverable solely by the backend, on demand, for a billing pull.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from core.secrets import SecretRecord, SecretStore

#: Providers we can hold a billing/admin credential for.
SUPPORTED_PROVIDERS = ("openai", "anthropic", "mistral", "openrouter", "azure", "aws", "gcp")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _view(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "provider": row[1],
        "label": row[2],
        "created_at": _iso(row[3]),
        "last_used_at": _iso(row[4]),
        "revoked": row[5] is not None,
    }


_VIEW_COLS = "id, provider, label, created_at, last_used_at, revoked_at"


def store_credential(
    conn: psycopg.Connection,
    store: SecretStore,
    *,
    tenant_id: str,
    provider: str,
    label: str,
    secret: str,
    created_by: str | None = None,
) -> dict[str, Any]:
    """Persist a credential via the configured secret store; return metadata only."""
    rec = store.put(conn, tenant_id=tenant_id, plaintext=secret)
    row = conn.execute(
        "insert into provider_credentials "
        "(tenant_id, provider, label, backend, key_id, wrapped_dek, nonce, ciphertext, "
        " vault_secret_id, created_by) "
        f"values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning {_VIEW_COLS}",
        (
            tenant_id,
            provider,
            label,
            rec.backend,
            rec.key_id,
            rec.wrapped_dek,
            rec.nonce,
            rec.ciphertext,
            rec.vault_secret_id,
            created_by,
        ),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("provider_credentials insert did not return a row")
    return _view(row)


def list_credentials(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """Metadata for a tenant's credentials — never the secret."""
    rows = conn.execute(
        f"select {_VIEW_COLS} from provider_credentials where tenant_id = %s "
        "order by created_at desc",
        (tenant_id,),
    ).fetchall()
    return [_view(r) for r in rows]


def revoke_credential(conn: psycopg.Connection, tenant_id: str, cred_id: str) -> bool:
    """Revoke an active credential scoped to the tenant. True only if one changed."""
    row = conn.execute(
        "update provider_credentials set revoked_at = now() "
        "where id = %s and tenant_id = %s and revoked_at is null returning id",
        (cred_id, tenant_id),
    ).fetchone()
    conn.commit()
    return row is not None


def reveal_secret(
    conn: psycopg.Connection, store: SecretStore, tenant_id: str, provider: str
) -> str | None:
    """Recover the most recent active credential for a provider (backend-only)."""
    row = conn.execute(
        "select id, backend, key_id, wrapped_dek, nonce, ciphertext, vault_secret_id "
        "from provider_credentials "
        "where tenant_id = %s and provider = %s and revoked_at is null "
        "order by created_at desc limit 1",
        (tenant_id, provider),
    ).fetchone()
    if row is None:
        return None
    conn.execute("update provider_credentials set last_used_at = now() where id = %s", (row[0],))
    conn.commit()
    record = SecretRecord(
        backend=row[1],
        key_id=row[2],
        wrapped_dek=row[3],
        nonce=row[4],
        ciphertext=row[5],
        vault_secret_id=str(row[6]) if row[6] else None,
    )
    return store.get(conn, tenant_id=tenant_id, record=record)
