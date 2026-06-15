"""Persistence for per-tenant policy documents (SPEC §4/§8, M3).

A tenant with no policy yet gets a safe default: no tools declared, so every
tool is unknown and therefore denied (fail-closed, CLAUDE.md §4.4).
"""

from __future__ import annotations

import psycopg

from core.policy import Policy, parse_policy

DEFAULT_POLICY_YAML = """\
# Default policy — fail-closed until configured.
tools: []
defaults:
  unknown_tool: deny
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
"""


def load_yaml(conn: psycopg.Connection, tenant_id: str) -> tuple[str, int]:
    """Return (yaml, version) for a tenant, or the default policy at version 0."""
    row = conn.execute(
        "select yaml, version from tool_policies where tenant_id = %s",
        (tenant_id,),
    ).fetchone()
    if row is None:
        return DEFAULT_POLICY_YAML, 0
    return row[0], row[1]


def load_policy(conn: psycopg.Connection, tenant_id: str) -> Policy:
    """Load and parse the effective policy for a tenant."""
    yaml_text, _ = load_yaml(conn, tenant_id)
    return parse_policy(yaml_text)


def save_yaml(conn: psycopg.Connection, tenant_id: str, yaml_text: str) -> int:
    """Upsert a tenant's policy, bumping the version. Returns the new version."""
    row = conn.execute(
        "insert into tool_policies (tenant_id, yaml, version) values (%s, %s, 1) "
        "on conflict (tenant_id) do update "
        "set yaml = excluded.yaml, version = tool_policies.version + 1, updated_at = now() "
        "returning version",
        (tenant_id, yaml_text),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - upsert always returns a row
        raise RuntimeError("policy upsert did not return a version")
    return int(row[0])
