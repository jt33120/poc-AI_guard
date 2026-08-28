"""Earned-trust signals read from the audit history (M11)."""

from __future__ import annotations

from core import audit, trust
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def _log(db: DBHandle, decision: str, *, tool: str = "t.x") -> None:
    audit.log_event(db.conn, tenant_id="t1", decision=decision, tool_name=tool, origin=_ORIGIN)


def test_no_history_means_unseen_and_zero_streak(db: DBHandle) -> None:
    assert trust.observed(db.conn, tenant_id="t1", tool="t.x") == (False, 0)


def test_clean_history_builds_a_streak(db: DBHandle) -> None:
    _log(db, "allow")
    _log(db, "notify")
    _log(db, "hitl_approved")
    seen, streak = trust.observed(db.conn, tenant_id="t1", tool="t.x")
    assert seen is True and streak == 3


def test_a_refusal_breaks_the_streak(db: DBHandle) -> None:
    _log(db, "allow")
    _log(db, "deny")  # older refusal
    _log(db, "allow")  # most recent
    seen, streak = trust.observed(db.conn, tenant_id="t1", tool="t.x")
    # Only the most-recent run of clean approvals counts.
    assert seen is True and streak == 1


def test_trust_is_scoped_per_tool(db: DBHandle) -> None:
    _log(db, "allow", tool="t.x")
    seen, streak = trust.observed(db.conn, tenant_id="t1", tool="t.other")
    assert seen is False and streak == 0


def test_summary_lists_each_tool(db: DBHandle) -> None:
    for _ in range(5):
        _log(db, "allow", tool="t.hot")
    _log(db, "allow", tool="t.cold")
    rows = {r["tool"]: r for r in trust.summary(db.conn, "t1")}
    assert rows["t.hot"]["trusted"] is True and rows["t.hot"]["clean_streak"] == 5
    assert rows["t.cold"]["trusted"] is False and rows["t.cold"]["clean_streak"] == 1
