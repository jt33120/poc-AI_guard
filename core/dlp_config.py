"""Per-tenant egress DLP configuration (front-configurable).

The scanner lives in ``core.dlp``; this module is only its *config* source. The
platform master switch stays ``settings.dlp_enabled`` (zero overhead when off).
When the platform enables DLP, a tenant's row here decides its verdicts; absent a
row, the env defaults apply. Only action names are stored — never scanned content.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg

from core.dlp import Action, DlpPolicy


@dataclass(frozen=True)
class DlpState:
    """A tenant's effective DLP config: the on/off switch + per-category actions."""

    enabled: bool
    policy: DlpPolicy

    def as_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "secret_action": self.policy.secret.value,
            "pii_action": self.policy.pii.value,
            "entropy_action": self.policy.entropy.value,
        }


def _env_policy(settings: Any) -> DlpPolicy:
    """The platform default actions from settings (shown even when disabled)."""
    return DlpPolicy(
        secret=Action(settings.dlp_secret_action),
        pii=Action(settings.dlp_pii_action),
        entropy=Action(settings.dlp_entropy_action),
    )


def load(conn: psycopg.Connection, tenant_id: str, settings: Any) -> DlpState:
    """The tenant's DLP config: its row if any, else the platform env defaults."""
    row = conn.execute(
        "select enabled, secret_action, pii_action, entropy_action "
        "from dlp_config where tenant_id = %s",
        (tenant_id,),
    ).fetchone()
    if row is None:
        return DlpState(enabled=bool(settings.dlp_enabled), policy=_env_policy(settings))
    enabled, secret, pii, entropy = row
    return DlpState(
        enabled=bool(enabled),
        policy=DlpPolicy(secret=Action(secret), pii=Action(pii), entropy=Action(entropy)),
    )


def save(
    conn: psycopg.Connection,
    tenant_id: str,
    *,
    enabled: bool,
    secret_action: str,
    pii_action: str,
    entropy_action: str,
    updated_by: str | None,
) -> None:
    """Upsert the tenant's DLP config (caller commits)."""
    conn.execute(
        "insert into dlp_config "
        "(tenant_id, enabled, secret_action, pii_action, entropy_action, updated_by) "
        "values (%s, %s, %s, %s, %s, %s) "
        "on conflict (tenant_id) do update set "
        "enabled = excluded.enabled, secret_action = excluded.secret_action, "
        "pii_action = excluded.pii_action, entropy_action = excluded.entropy_action, "
        "updated_by = excluded.updated_by, updated_at = now()",
        (tenant_id, enabled, secret_action, pii_action, entropy_action, updated_by),
    )
