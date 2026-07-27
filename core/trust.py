"""Earned-trust signals from the audit history (M11, axis C).

Graduated autonomy lets a tool's risk score fall as it proves reliable. Trust is
read deterministically from the append-only audit log — no state of its own:

* ``seen_before`` — has this tool ever been cleanly allowed for the tenant
  (removes the novelty penalty);
* ``clean_streak`` — how many of the most-recent decisions were clean approvals
  with no refusal in between (drives the trust discount).

Reads metadata only (CLAUDE.md §4.10). A single refusal breaks the streak, so
trust is conservative — it errs toward *more* review, never less.
"""

from __future__ import annotations

from typing import Any

import psycopg

from core.risk import TRUST_THRESHOLD

#: Decisions that count as a clean, trust-building outcome.
_CLEAN = ("allow", "notify", "hitl_approved")

#: Recent-history window (a streak caps at the trust threshold anyway).
_WINDOW = 100


def observed(conn: psycopg.Connection, *, tenant_id: str, tool: str) -> tuple[bool, int]:
    """Return ``(seen_before, clean_streak)`` for a (tenant, tool) from the audit."""
    rows = conn.execute(
        "select decision from audit_log where tenant_id = %s and tool_name = %s "
        "order by id desc limit %s",
        (tenant_id, tool, _WINDOW),
    ).fetchall()
    seen_before = any(r[0] in _CLEAN for r in rows)
    streak = 0
    for r in rows:
        if r[0] in _CLEAN:
            streak += 1
        else:
            break  # a refusal (deny / hitl_denied / expired / …) resets earned trust
    return seen_before, streak


def summary(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    """Per-tool earned-trust view for a tenant (for the read API)."""
    tools = conn.execute(
        "select distinct tool_name from audit_log "
        "where tenant_id = %s and tool_name is not null order by tool_name",
        (tenant_id,),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for (tool,) in tools:
        seen, streak = observed(conn, tenant_id=tenant_id, tool=tool)
        out.append(
            {
                "tool": tool,
                "seen_before": seen,
                "clean_streak": streak,
                "trusted": streak >= TRUST_THRESHOLD,
            }
        )
    return out
