"""Bounded observation windows — the control plane decides who is enforced (G-25).

Enforcement is the default and is never a request-level choice. The LLM proxy used
to read its mode from an ``x-xsom-mode`` request header, which handed the decision
to the agent being controlled: one omitted header dissolved the guard. The same
class of defect as taint keyed on an agent-declared session id.

Inverting the default alone would not do, and that is why this module exists rather
than a one-line change. Enforcing by default breaks every agent whose policy is not
written yet — an unknown tool denies, so every call is refused — and that adoption
cliff is precisely what the header was working around. The answer is not a weaker
default but a *bounded, attributed, control-plane* exception: an admin opens a
window on one agent, for a stated number of hours, and it closes itself.

**Observation never covers the irreversible** (``AD-27.2``). Those classes and
external sends block in every mode; the window relaxes the rest. A mode that could
be opened over a destructive action would be a documented bypass of ``CLAUDE.md``
§4.1, which admits no exception.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from core.policy import ActionClass

#: Classes an observation window never covers. Not configurable: making it so would
#: turn the one hard guarantee of the product into a setting.
NEVER_OBSERVED: frozenset[ActionClass] = frozenset(
    {ActionClass.irreversible, ActionClass.external_send}
)

_COLUMNS = "id, gateway_token_id, opened_at, expires_at, closed_at, opened_by, closed_by"


@dataclass(frozen=True)
class Window:
    id: int
    gateway_token_id: str
    opened_at: datetime
    expires_at: datetime
    closed_at: datetime | None
    opened_by: str | None
    closed_by: str | None

    @property
    def active(self) -> bool:
        return self.closed_at is None and self.expires_at > datetime.now(UTC)


class MonitorError(ValueError):
    """A window could not be opened (API maps this to HTTP 422)."""


def _row(row: tuple[Any, ...]) -> Window:
    return Window(
        id=row[0],
        gateway_token_id=row[1],
        opened_at=row[2],
        expires_at=row[3],
        closed_at=row[4],
        opened_by=row[5],
        closed_by=row[6],
    )


def open_window(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    gateway_token_id: str,
    hours: int,
    max_hours: int,
    opened_by: str | None = None,
) -> tuple[Window, bool]:
    """Open a window, or extend the one already running. Returns (window, extended).

    ``extended`` lets the caller say "prolongée jusqu'au …" rather than "ouverte",
    so an administrator knows what they just did — re-opening on an agent already
    observed is the easy way to silently double an unenforced period.
    """
    if hours < 1:
        raise MonitorError("la durée doit être un nombre d'heures positif")
    if hours > max_hours:
        raise MonitorError(
            f"le plafond configuré est de {max_hours} heures. Une fenêtre sans "
            "échéance courte n'est pas une observation, c'est un contournement."
        )
    expires_at = datetime.now(UTC) + timedelta(hours=hours)
    existing = active_window(conn, tenant_id, gateway_token_id)
    if existing is not None:
        row = conn.execute(
            f"update monitor_windows set expires_at = %s where id = %s returning {_COLUMNS}",
            (expires_at, existing.id),
        ).fetchone()
        if row is None:  # pragma: no cover - the row was just selected for update
            raise MonitorError("la fenêtre a disparu pendant sa prolongation")
        return _row(row), True
    row = conn.execute(
        "insert into monitor_windows (tenant_id, gateway_token_id, expires_at, opened_by) "
        f"values (%s, %s, %s, %s) returning {_COLUMNS}",
        (tenant_id, gateway_token_id, expires_at, opened_by),
    ).fetchone()
    if row is None:  # pragma: no cover - `returning` yields a row on a successful insert
        raise MonitorError("la fenêtre n'a pas pu être ouverte")
    return _row(row), False


def close_window(
    conn: psycopg.Connection, *, tenant_id: str, window_id: int, closed_by: str | None = None
) -> Window | None:
    """Stop a window now; enforcement resumes on the next call. Row kept as history."""
    row = conn.execute(
        "update monitor_windows set closed_at = now(), closed_by = %s "
        f"where id = %s and tenant_id = %s and closed_at is null returning {_COLUMNS}",
        (closed_by, window_id, tenant_id),
    ).fetchone()
    return _row(row) if row is not None else None


def active_window(conn: psycopg.Connection, tenant_id: str, gateway_token_id: str) -> Window | None:
    """The window currently relaxing enforcement for this agent, or None."""
    row = conn.execute(
        f"select {_COLUMNS} from monitor_windows "
        "where tenant_id = %s and gateway_token_id = %s and closed_at is null "
        "and expires_at > now()",
        (tenant_id, gateway_token_id),
    ).fetchone()
    return _row(row) if row is not None else None


def list_windows(conn: psycopg.Connection, tenant_id: str, limit: int = 100) -> list[Window]:
    rows = conn.execute(
        f"select {_COLUMNS} from monitor_windows where tenant_id = %s "
        "order by opened_at desc limit %s",
        (tenant_id, limit),
    ).fetchall()
    return [_row(r) for r in rows]


def observes(action_class: ActionClass | None) -> bool:
    """Whether an observation window may relax this action class at all (AD-27.2).

    An unknown class counts as the worst case: not knowing what an action does is
    not a reason to stop enforcing it.
    """
    return action_class is not None and action_class not in NEVER_OBSERVED
