"""Bounded observation windows: the control plane decides who is enforced (G-25).

The defect these close: `api/llm_proxy.py` read its enforcement mode from an
`x-xsom-mode` request header, so the agent being controlled decided whether it was
controlled. One omitted header -- by compromise or by plain misconfiguration --
dissolved the guard.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from core import monitor
from core.policy import ActionClass
from tests.conftest import DBHandle


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def test_no_window_means_enforced(db: DBHandle) -> None:
    # The default, and the whole point: absence of a window is enforcement.
    assert monitor.active_window(db.conn, _tenant(db), "tok-1") is None


def test_opening_a_window_relaxes_that_agent_only(db: DBHandle) -> None:
    tid = _tenant(db)
    monitor.open_window(db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=2, max_hours=24)
    db.conn.commit()

    assert monitor.active_window(db.conn, tid, "tok-1") is not None
    assert monitor.active_window(db.conn, tid, "tok-2") is None  # scoped to one agent


def test_a_window_does_not_leak_across_tenants(db: DBHandle) -> None:
    a, b = _tenant(db), _tenant(db)
    monitor.open_window(db.conn, tenant_id=a, gateway_token_id="tok-1", hours=2, max_hours=24)
    db.conn.commit()
    assert monitor.active_window(db.conn, b, "tok-1") is None


def test_reopening_extends_rather_than_stacking(db: DBHandle) -> None:
    # Stacking would make "how long has this agent been unenforced" ambiguous, and
    # would let an admin silently double an unenforced period by clicking twice.
    tid = _tenant(db)
    first, extended = monitor.open_window(
        db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=1, max_hours=24
    )
    assert extended is False
    second, extended = monitor.open_window(
        db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=5, max_hours=24
    )
    db.conn.commit()

    assert extended is True
    assert second.id == first.id
    assert second.expires_at > first.expires_at
    assert len(monitor.list_windows(db.conn, tid)) == 1


def test_an_expired_window_stops_relaxing_on_its_own(db: DBHandle) -> None:
    tid = _tenant(db)
    monitor.open_window(db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=1, max_hours=24)
    db.conn.execute(
        "update monitor_windows set expires_at = %s", (datetime.now(UTC) - timedelta(minutes=1),)
    )
    db.conn.commit()

    # Nobody had to act. That is what "bounded" has to mean to be worth anything.
    assert monitor.active_window(db.conn, tid, "tok-1") is None


def test_closing_restores_enforcement_and_keeps_the_row(db: DBHandle) -> None:
    tid = _tenant(db)
    window, _ = monitor.open_window(
        db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=4, max_hours=24
    )
    closed = monitor.close_window(db.conn, tenant_id=tid, window_id=window.id, closed_by="admin")
    db.conn.commit()

    assert closed is not None and closed.closed_at is not None
    assert monitor.active_window(db.conn, tid, "tok-1") is None
    # A period during which enforcement was relaxed is evidence; it stays.
    assert len(monitor.list_windows(db.conn, tid)) == 1


def test_closing_another_tenants_window_does_nothing(db: DBHandle) -> None:
    a, b = _tenant(db), _tenant(db)
    window, _ = monitor.open_window(
        db.conn, tenant_id=a, gateway_token_id="tok-1", hours=4, max_hours=24
    )
    assert monitor.close_window(db.conn, tenant_id=b, window_id=window.id) is None
    db.conn.commit()
    assert monitor.active_window(db.conn, a, "tok-1") is not None


def test_a_window_beyond_the_ceiling_is_refused(db: DBHandle) -> None:
    tid = _tenant(db)
    with pytest.raises(monitor.MonitorError) as exc:
        monitor.open_window(
            db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=99, max_hours=24
        )
    # The message names the ceiling: a generic refusal teaches an admin nothing.
    assert "24" in str(exc.value)


@pytest.mark.parametrize("hours", [0, -3])
def test_a_non_positive_duration_is_refused(db: DBHandle, hours: int) -> None:
    with pytest.raises(monitor.MonitorError):
        monitor.open_window(
            db.conn, tenant_id=_tenant(db), gateway_token_id="tok-1", hours=hours, max_hours=24
        )


def test_lowering_the_ceiling_does_not_shorten_a_running_window(db: DBHandle) -> None:
    # One does not retroactively shorten a decision that is already on the record.
    tid = _tenant(db)
    window, _ = monitor.open_window(
        db.conn, tenant_id=tid, gateway_token_id="tok-1", hours=20, max_hours=24
    )
    db.conn.commit()
    still = monitor.active_window(db.conn, tid, "tok-1")
    assert still is not None and still.expires_at == window.expires_at


# --- AD-27.2, the guarantee that must not bend --------------------------------


def test_observation_never_covers_the_irreversible() -> None:
    # A mode that could be opened over a destructive action would be a documented
    # bypass of CLAUDE.md 4.1, which admits no exception.
    assert monitor.observes(ActionClass.irreversible) is False
    assert monitor.observes(ActionClass.external_send) is False


def test_observation_covers_the_lighter_classes() -> None:
    assert monitor.observes(ActionClass.read) is True
    assert monitor.observes(ActionClass.write) is True


def test_an_unknown_class_is_never_observed() -> None:
    # Not knowing what an action does is not a reason to stop enforcing it.
    assert monitor.observes(None) is False
