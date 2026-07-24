"""MCP tool supply-chain integrity (M10, BUILD_PLAN_V1.1 axis B).

The gateway is the one component in the action path that sees every downstream
tool *definition*, so it is where tool poisoning / rug-pulls are caught. On each
``list_tools`` we fingerprint every tool (sha256 of its name + description +
input schema) and compare it to the tenant's approved fingerprint:

* first sighting  → ``new``    (pending review; quarantined unless auto-approved)
* approved + same → ``ok``     (exposed / relayed)
* approved + diff → ``drift``  (rug-pull; quarantined, never silently re-approved)
* injection text  → ``poison`` (quarantined regardless of fingerprint)

Quarantine is fail-closed: a quarantined tool is neither listed to the agent nor
relayed (CLAUDE.md §4.4). Only metadata + hashes are stored (§4.10).

Lives in ``core`` (not ``gateway``) so both the gateway and the read API depend
on it without an ``api → gateway`` layering edge.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import psycopg


class ToolStatus(StrEnum):
    ok = "ok"  # approved and unchanged → safe to expose/relay
    new = "new"  # never approved yet → pending review (quarantined)
    drift = "drift"  # approved fingerprint changed under us → rug-pull
    poison = "poison"  # description carries an injection payload


#: Prompt-injection / exfiltration phrases smuggled into a *tool description*
#: (not a user prompt — xSOM is not a prompt firewall). Case-insensitive.
_INJECTION = re.compile(
    r"ignore\s+(?:all\s+)?(?:previous|prior|above)"
    r"|disregard\s+(?:the\s+)?(?:previous|prior|above|instruction)"
    r"|system\s+prompt"
    r"|you\s+are\s+now"
    r"|exfiltrat"
    r"|<\s*important\s*>"
    r"|do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user",
    re.I | re.S,
)
#: Invisible / bidi control chars used to hide instructions in a description
#: (zero-width, bidi embeddings/overrides, word-joiner range, BOM).
_INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")


def detect_poison(description: str | None) -> str | None:
    """Return a short reason if a tool description looks poisoned, else None."""
    if not description:
        return None
    if _INVISIBLE.search(description):
        return "invisible_characters"
    if _INJECTION.search(description):
        return "injection_phrase"
    return None


def fingerprint(name: str, description: str | None, input_schema: Any) -> str:
    """Stable content hash of a tool definition (name + description + schema)."""
    canonical = json.dumps(
        {"name": name, "description": description or "", "schema": input_schema or {}},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Fingerprint:
    """A stored tool fingerprint for a tenant (approved baseline or pending)."""

    server: str
    tool_name: str
    fingerprint: str
    approved: bool


def evaluate_tool(
    current_fp: str, poison_reason: str | None, stored: Fingerprint | None
) -> ToolStatus:
    """Classify a freshly fingerprinted tool against its stored record."""
    if poison_reason is not None:
        return ToolStatus.poison
    if stored is None or not stored.approved:
        return ToolStatus.new
    if stored.fingerprint != current_fp:
        return ToolStatus.drift
    return ToolStatus.ok


# --- persistence -------------------------------------------------------------
def get_fingerprints(
    conn: psycopg.Connection, tenant_id: str
) -> dict[tuple[str, str], Fingerprint]:
    """All stored fingerprints for a tenant, keyed by (server, tool_name)."""
    rows = conn.execute(
        "select server, tool_name, fingerprint, approved from tool_fingerprints "
        "where tenant_id = %s",
        (tenant_id,),
    ).fetchall()
    return {(r[0], r[1]): Fingerprint(r[0], r[1], r[2], r[3]) for r in rows}


def record_sighting(
    conn: psycopg.Connection, *, tenant_id: str, server: str, tool_name: str, fp: str
) -> None:
    """Upsert a sighting: track the live hash in ``last_fingerprint``, bump last_seen.

    Never overwrites the *approved* ``fingerprint`` baseline or the approved flag —
    drift is detected against that baseline and re-approved explicitly.
    """
    conn.execute(
        "insert into tool_fingerprints "
        "(tenant_id, server, tool_name, fingerprint, last_fingerprint) "
        "values (%s, %s, %s, %s, %s) "
        "on conflict (tenant_id, server, tool_name) "
        "do update set last_fingerprint = excluded.last_fingerprint, last_seen = now()",
        (tenant_id, server, tool_name, fp, fp),
    )


def approve(conn: psycopg.Connection, *, tenant_id: str, server: str, tool_name: str) -> bool:
    """Approve a tool at its last-seen fingerprint (promotes it to the baseline).

    Idempotent for an unchanged tool; clears a prior drift by re-baselining to the
    version an operator just reviewed. Returns False if the tool is unknown.
    """
    row = conn.execute(
        "update tool_fingerprints "
        "set approved = true, fingerprint = last_fingerprint, last_seen = now() "
        "where tenant_id = %s and server = %s and tool_name = %s returning id",
        (tenant_id, server, tool_name),
    ).fetchone()
    return row is not None


def list_status(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """Tenant-scoped view of stored tool fingerprints + derived status (read API)."""
    rows = conn.execute(
        "select server, tool_name, approved, fingerprint, last_fingerprint, first_seen, last_seen "
        "from tool_fingerprints where tenant_id = %s order by server, tool_name",
        (tenant_id,),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        approved, fp, last_fp = r[2], r[3], r[4]
        if not approved:
            derived = ToolStatus.new.value
        elif fp != last_fp:
            derived = ToolStatus.drift.value
        else:
            derived = ToolStatus.ok.value
        out.append(
            {
                "server": r[0],
                "tool_name": r[1],
                "approved": approved,
                "status": derived,
                "first_seen": r[5].isoformat() if r[5] else None,
                "last_seen": r[6].isoformat() if r[6] else None,
            }
        )
    return out
