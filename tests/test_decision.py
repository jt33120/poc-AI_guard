"""Cooperative authorization engine: allow / deny / hold + poll (core.decision)."""

from __future__ import annotations

from uuid import uuid4

from core import approvals, decision
from core.policy import parse_policy
from tests.conftest import DBHandle

POLICY = parse_policy(
    """
tools:
  - {name: mock.echo, class: read, approval: auto}
  - name: mock.mail
    class: external_send
    approval: human_in_the_loop
  - name: mock.delete
    class: irreversible
    approval: human_dual
defaults:
  unknown_tool: deny
"""
)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return tid


def _decisions(db: DBHandle, tenant_id: str) -> list[str]:
    rows = db.conn.execute(
        "select decision from audit_log where tenant_id = %s order by id", (tenant_id,)
    ).fetchall()
    return [r[0] for r in rows]


def test_auto_allows_and_audits(db: DBHandle) -> None:
    tid = _tenant(db)
    res = decision.authorize(
        database_url=db.url, policy=POLICY, tenant_id=tid, tool="mock.echo", arguments={"t": "hi"}
    )
    assert res["decision"] == "allow"
    assert "allow" in _decisions(db, tid)


def test_unknown_tool_denies_fail_closed(db: DBHandle) -> None:
    tid = _tenant(db)
    res = decision.authorize(
        database_url=db.url, policy=POLICY, tenant_id=tid, tool="mock.nope", arguments={}
    )
    assert res["decision"] == "deny"
    assert "deny" in _decisions(db, tid)


def test_hold_then_approve(db: DBHandle) -> None:
    tid = _tenant(db)
    held = decision.authorize(
        database_url=db.url,
        policy=POLICY,
        tenant_id=tid,
        tool="mock.mail",
        arguments={"to": "x@client.fr"},
    )
    assert held["decision"] == "hold" and held["approval_id"]
    aid = held["approval_id"]
    assert decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)["decision"] == "hold"

    approvals.decide(db.conn, tid, aid, "approve", "operator-1")
    resolved = decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)
    assert resolved["decision"] == "allow" and resolved["status"] == "approved"
    # Spent: a second poll still reports approved (no double audit).
    assert (
        decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)["status"] == "approved"
    )

    decisions = _decisions(db, tid)
    assert "hitl_pending" in decisions and "hitl_approved" in decisions
    assert decisions.count("hitl_approved") == 1


def test_hold_then_deny(db: DBHandle) -> None:
    tid = _tenant(db)
    held = decision.authorize(
        database_url=db.url,
        policy=POLICY,
        tenant_id=tid,
        tool="mock.mail",
        arguments={"to": "y@client.fr"},
    )
    aid = held["approval_id"]
    approvals.decide(db.conn, tid, aid, "deny", "operator-1")
    resolved = decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)
    assert resolved["decision"] == "deny" and resolved["status"] == "denied"


def test_human_dual_requires_two_approvers(db: DBHandle) -> None:
    tid = _tenant(db)
    held = decision.authorize(
        database_url=db.url,
        policy=POLICY,
        tenant_id=tid,
        tool="mock.delete",
        arguments={"id": "1"},
    )
    aid = held["approval_id"]
    approvals.decide(db.conn, tid, aid, "approve", "op-1")
    assert decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)["decision"] == "hold"
    approvals.decide(db.conn, tid, aid, "approve", "op-2")
    assert decision.poll(database_url=db.url, tenant_id=tid, approval_id=aid)["decision"] == "allow"


def test_poll_unknown_returns_none(db: DBHandle) -> None:
    tid = _tenant(db)
    assert decision.poll(database_url=db.url, tenant_id=tid, approval_id=str(uuid4())) is None
