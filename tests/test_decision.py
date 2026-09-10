"""Cooperative authorization engine: allow / deny / hold + poll (core.decision)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from core import approvals, decision
from core.judge import Judge
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


AMBIGUOUS = parse_policy(
    "tools:\n"
    "  - {name: mock.exec, classify: ambiguous, approval: auto}\n"
    "defaults: {unknown_tool: deny}\n"
)


def _judge_used(db: DBHandle, tenant_id: str) -> list[bool]:
    rows = db.conn.execute(
        "select judge_used from audit_log where tenant_id = %s order by id", (tenant_id,)
    ).fetchall()
    return [r[0] for r in rows]


def test_ambiguous_without_a_judge_holds_on_the_http_path_too(db: DBHandle) -> None:
    # The cooperative HTTP path must give the same answer as the MCP gateway; a
    # guarantee that holds on one ingress and not the other is not a guarantee.
    tid = _tenant(db)
    res = decision.authorize(
        database_url=db.url,
        policy=AMBIGUOUS,
        tenant_id=tid,
        tool="mock.exec",
        arguments={"cmd": "rm -rf /"},
        judge=None,
    )
    assert res["decision"] == "hold"
    assert res["action_class"] == "irreversible"
    assert _decisions(db, tid) == ["hitl_pending"]
    assert _judge_used(db, tid) == [False]  # AD-21.4: no model call was made


def test_ambiguous_with_a_judge_follows_its_class_on_the_http_path(db: DBHandle) -> None:
    tid = _tenant(db)
    judge = Judge(lambda _s, _u: '{"action_class": "read"}')
    res = decision.authorize(
        database_url=db.url,
        policy=AMBIGUOUS,
        tenant_id=tid,
        tool="mock.exec",
        arguments={"cmd": "ls"},
        judge=judge,
    )
    assert res["decision"] == "allow"
    assert res["action_class"] == "read"
    assert _judge_used(db, tid) == [True]


def test_service_down_answers_deny_not_an_error(db: DBHandle) -> None:
    # The cooperative contract is that the agent honours the verdict, so it must get
    # one. A raised exception surfaced as an HTTP 500 -- an error, not a decision --
    # and left the agent to guess. The MCP gateway already denied here.
    tid = _tenant(db)
    res = decision.authorize(
        database_url="postgresql://nobody@127.0.0.1:1/nothing",
        policy=POLICY,
        tenant_id=tid,
        tool="mock.delete",  # irreversible, human_dual
        arguments={"id": "1"},
    )
    assert res["decision"] == "deny"
    assert res["reason"] == "approval_service_unavailable"


def test_service_down_honours_the_tenant_setting_on_a_light_class(db: DBHandle) -> None:
    # CLAUDE.md 4.4 pins the *irreversible* case. On a `write` an operator may
    # reasonably prefer availability, and `on_approval_service_down` finally means
    # something -- until now nothing in the codebase read it.
    tid = _tenant(db)
    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.edit, class: write, approval: human_in_the_loop}\n"
        "defaults: {unknown_tool: deny, on_approval_service_down: auto}\n"
    )
    res = decision.authorize(
        database_url="postgresql://nobody@127.0.0.1:1/nothing",
        policy=policy,
        tenant_id=tid,
        tool="mock.edit",
        arguments={"id": "1"},
    )
    assert res["decision"] == "allow"
    assert res["reason"] == "approval_service_unavailable"


def test_service_down_still_denies_the_irreversible_whatever_the_setting(db: DBHandle) -> None:
    tid = _tenant(db)
    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.wipe, class: irreversible, approval: human_dual}\n"
        "defaults: {unknown_tool: deny, on_approval_service_down: auto}\n"
    )
    res = decision.authorize(
        database_url="postgresql://nobody@127.0.0.1:1/nothing",
        policy=policy,
        tenant_id=tid,
        tool="mock.wipe",
        arguments={"id": "1"},
    )
    assert res["decision"] == "deny"


_GRADUEE = (
    "tools:\n"
    "  - {name: mock.fetch, class: read, approval: auto}\n"
    "defaults:\n"
    "  unknown_tool: deny\n"
    "  risk_bands: {auto: 30, notify: 50, hitl: 80}\n"
)


def test_a_failed_trust_lookup_is_a_verdict_not_an_error(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """L'autonomie graduée ouvrait une connexion hors de tout `try`.

    `test_service_down_answers_deny_not_an_error` énonce la garantie du fichier :
    « a raised exception surfaced as an HTTP 500, which is an error, not a decision ».
    Elle était **conditionnelle à une option de policy** que ce test, comme les deux
    autres tests de panne, n'active pas : avec `risk_bands`, la lecture de confiance
    précédait le `try` et une base absente remontait en 500. Un tenant en autonomie
    graduée retrouvait donc exactement le défaut que ces tests gardent.

    Et le repli doit être le plus strict que `escalate_by_risk` accepte — ne pas
    savoir si un agent a mérité la confiance se lit comme « il ne l'a pas méritée »
    (`AD-10`). C'est ce que l'égalité ci-dessous vérifie : la panne rend le même
    verdict qu'un agent que la base connaît et n'a jamais vu.
    """
    policy = parse_policy(_GRADUEE)
    args = {"path": "/etc/shadow"}

    inconnu = decision.authorize(
        database_url=db.url,
        policy=policy,
        tenant_id=_tenant(db),
        tool="mock.fetch",
        arguments=args,
    )

    def boum(*_a: object, **_k: object) -> object:
        raise RuntimeError("trust store unreachable")

    monkeypatch.setattr(decision.trust, "observed", boum)
    en_panne = decision.authorize(
        database_url=db.url,
        policy=policy,
        tenant_id=_tenant(db),
        tool="mock.fetch",
        arguments=args,
    )

    assert en_panne["decision"] == inconnu["decision"], (
        "une lecture de confiance en panne ne rend pas le même verdict qu'un agent "
        "jamais vu — elle relâche ou elle durcit, et les deux sont faux"
    )
