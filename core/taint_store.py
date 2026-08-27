"""Persisted indirect-injection taint, keyed on the agent (G-03, FR-154, AD-10).

The taint used to live on the gateway's per-connection object. An agent that had
just been tainted only had to reconnect to come back clean: the guard was defeated
by a reconnect, not by an attack. That is the same defect family as reading the
enforcement mode from a request header — a control-plane fact taken from something
the controlled party governs.

Two consequences follow, and neither is a free choice:

* **The key is the gateway token**, not a session id the agent declares. An agent
  cannot mint itself a clean identity (`FR-154`).
* **The window is time**, not a count of calls. A call counter restarts at zero on
  every connection, so it cannot express "recently" across the reconnect this
  module exists to survive.

``AD-10``: a taint that cannot be read is not a clean one. Every failure path here
answers *tainted*, and the caller gates the irreversible on that.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

logger = logging.getLogger("xsom.taint")

_COLUMNS = "tainted_at, expires_at, source_tool, reason"


@dataclass(frozen=True)
class Taint:
    tainted_at: datetime
    expires_at: datetime
    source_tool: str | None
    reason: str | None


def _row(row: tuple[Any, ...]) -> Taint:
    return Taint(tainted_at=row[0], expires_at=row[1], source_tool=row[2], reason=row[3])


def mark(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    gateway_token_id: str,
    window_seconds: int,
    source_tool: str,
    reason: str,
) -> None:
    """Taint this agent for ``window_seconds``, extending any taint already running."""
    expires_at = datetime.now(UTC) + timedelta(seconds=window_seconds)
    conn.execute(
        "insert into session_taint "
        "(tenant_id, gateway_token_id, expires_at, source_tool, reason) "
        "values (%s, %s, %s, %s, %s) "
        "on conflict (tenant_id, gateway_token_id) do update set "
        "  tainted_at = now(), "
        "  expires_at = greatest(session_taint.expires_at, excluded.expires_at), "
        "  source_tool = excluded.source_tool, "
        "  reason = excluded.reason",
        (tenant_id, gateway_token_id, expires_at, source_tool, reason),
    )


def active(conn: psycopg.Connection, tenant_id: str, gateway_token_id: str) -> Taint | None:
    """The taint still covering this agent, or None. Raises if the store is down."""
    row = conn.execute(
        f"select {_COLUMNS} from session_taint "
        "where tenant_id = %s and gateway_token_id = %s and expires_at > now()",
        (tenant_id, gateway_token_id),
    ).fetchone()
    return _row(row) if row is not None else None


def clear(conn: psycopg.Connection, *, tenant_id: str, gateway_token_id: str) -> None:
    """Drop an agent's taint. Used by operators, never by the agent itself."""
    conn.execute(
        "delete from session_taint where tenant_id = %s and gateway_token_id = %s",
        (tenant_id, gateway_token_id),
    )
