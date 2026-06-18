"""Self-serve account provisioning (SaaS signup).

A new customer signs up and we provision, atomically as far as possible: a
Supabase auth user, a tenant, an admin membership, and the user's
``app_metadata`` (tenant_id + role) that both the API and Postgres RLS read.

The Supabase Auth Admin calls go through an injectable :class:`AuthAdmin` so the
flow is testable without a live Supabase. Everything uses the service-role key,
which lives only on the backend (CLAUDE.md §4.6).
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

import httpx
import psycopg

from core.config import Settings

logger = logging.getLogger("xsom.signup")


class AccountExists(Exception):
    """The email already has an account."""


class SignupError(Exception):
    """Provisioning failed; the partial account has been rolled back."""


class AuthAdmin(Protocol):
    """Minimal Supabase Auth Admin surface needed for signup (injectable)."""

    def create_user(self, email: str, password: str) -> str:
        """Create a confirmed user, return its id. Raises AccountExists on dupes."""
        ...

    def set_app_metadata(self, user_id: str, metadata: dict[str, Any]) -> None: ...

    def delete_user(self, user_id: str) -> None: ...


class SupabaseAuthAdmin:
    """AuthAdmin backed by the Supabase Auth Admin REST API."""

    def __init__(self, base_url: str, service_role_key: str) -> None:
        self._url = base_url.rstrip("/") + "/auth/v1/admin/users"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    def create_user(self, email: str, password: str) -> str:  # pragma: no cover - network I/O
        resp = httpx.post(
            self._url,
            headers=self._headers,
            json={"email": email, "password": password, "email_confirm": True},
            timeout=15.0,
        )
        if resp.status_code in (409, 422):
            raise AccountExists(email)
        resp.raise_for_status()
        return str(resp.json()["id"])

    def set_app_metadata(
        self, user_id: str, metadata: dict[str, Any]
    ) -> None:  # pragma: no cover - network I/O
        resp = httpx.put(
            f"{self._url}/{user_id}",
            headers=self._headers,
            json={"app_metadata": metadata},
            timeout=15.0,
        )
        resp.raise_for_status()

    def delete_user(self, user_id: str) -> None:  # pragma: no cover - network I/O
        httpx.delete(f"{self._url}/{user_id}", headers=self._headers, timeout=15.0)


def build_auth_admin(settings: Settings) -> AuthAdmin | None:
    """Construct the Supabase auth admin, or None if signup is not configured."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    return SupabaseAuthAdmin(settings.supabase_url, settings.supabase_service_role_key)


def provision_account(
    conn: psycopg.Connection, admin: AuthAdmin, *, org: str, email: str, password: str
) -> dict[str, str]:
    """Create user + tenant + admin membership + app_metadata. Rolls back on failure."""
    user_id = admin.create_user(email, password)  # raises AccountExists
    try:
        row = conn.execute("insert into tenants (name) values (%s) returning id", (org,)).fetchone()
        if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
            raise SignupError("tenant insert returned no row")
        tenant_id = str(row[0])
        conn.execute(
            "insert into memberships (user_id, tenant_id, role) values (%s, %s, 'admin')",
            (user_id, tenant_id),
        )
        conn.commit()
        admin.set_app_metadata(user_id, {"tenant_id": tenant_id, "role": "admin"})
    except Exception as exc:
        conn.rollback()
        try:  # best-effort: don't leave an orphaned auth user
            admin.delete_user(user_id)
        except Exception:  # pragma: no cover - cleanup is best-effort
            logger.warning("signup_cleanup_failed", extra={"user_id": user_id})
        raise SignupError("could not provision account") from exc
    return {"user_id": user_id, "tenant_id": tenant_id}
