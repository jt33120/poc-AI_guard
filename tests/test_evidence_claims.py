"""FR-169 / INV-12 — the evidence pack may not claim more than it proves.

Two claims were standing in a document meant for a regulator.

`article_12.tamper_evident: true` came from recomputing the chain over the same
rows, the same connection and the same process that wrote them. That detects an
edited row; it says nothing about an operator who rewrote the chain forward, and
"how do I know the operator did not rewrite it" is the question being asked.

And the narrative's own arithmetic did not close: four keys were picked out of
the decision tally while the total counted all of them, so `notify`, `hold`, the
guard events and the `monitor_*` family — actions let through under an open
observation window — were counted in the total and reported nowhere.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from core import audit, compliance, export, monitor, tenant_tokens
from tests.conftest import DBHandle

# Every decision string the codebase writes, with where it comes from. A summary
# that silently drops one of these is the defect this file exists to prevent.
_VOCABULARY = {
    "allow": 3,  # core/decision.py, api/llm_proxy.py, gateway/server.py
    "notify": 1,  # core/decision.py -- notify-and-proceed
    "deny": 2,  # policy refusal, and a DLP block
    "hold": 1,  # api/llm_proxy.py -- a would-review action
    "hitl_pending": 1,  # core/decision.py, gateway/server.py
    "hitl_approved": 1,  # core/decision.py::_TERMINAL
    "hitl_denied": 1,  # core/decision.py::_TERMINAL
    "expired": 1,  # core/decision.py::_TERMINAL
    "rbac_denied": 1,  # gateway/server.py::_audit_gate
    "tainted_action": 1,  # gateway/server.py::_audit_gate
    "taint_marked": 1,  # gateway/server.py::_audit_gate
    "tool_drift": 1,  # gateway/server.py::_INTEGRITY_DECISION
    "poison_suspected": 1,  # idem
    "tool_quarantined": 1,  # idem
    "flag": 1,  # core/dlp.py::ScanResult.decision
    "redacted": 1,  # idem
    "monitor_hold": 2,  # api/llm_proxy.py::_process under an open window
    "monitor_deny": 1,  # idem
}


def test_the_summary_accounts_for_every_decision_the_system_writes() -> None:
    buckets = export.summarise(_VOCABULARY)
    assert sum(buckets.values()) == sum(_VOCABULARY.values())
    assert buckets["unclassified"] == 0, (
        f"unmapped decisions: {buckets['unclassified']}. Add them to `_BUCKETS` in "
        "core/export.py — a decision this summary does not know about is a decision "
        "that used to disappear from the compliance narrative."
    )


def test_an_unknown_decision_is_reported_rather_than_dropped() -> None:
    """The protection that outlives this test: a *future* decision cannot vanish."""
    buckets = export.summarise({"allow": 1, "some_decision_invented_later": 2})
    assert buckets["unclassified"] == 2
    narrative = export.default_narrative(export.AI_ACT, {"x_new_kind": 2}, 2)
    assert "does not classify" in narrative


def test_an_observed_action_is_never_reported_as_auto_allowed() -> None:
    """`monitor_*` means the gateway stood down. Folding it into "allowed" is the
    single most misleading thing this summary could do."""
    buckets = export.summarise({"allow": 1, "monitor_hold": 4})
    assert buckets["auto_allowed"] == 1
    assert buckets["observed_not_enforced"] == 4
    narrative = export.default_narrative(export.AI_ACT, {"allow": 1, "monitor_hold": 4}, 5)
    assert "observation window" in narrative
    assert "recorded rather than enforced" in narrative


def test_the_narrative_numbers_add_up_to_the_total() -> None:
    total = sum(_VOCABULARY.values())
    narrative = export.default_narrative(export.AI_ACT, _VOCABULARY, total)
    reported = sum(export.summarise(_VOCABULARY).values())
    assert reported == total
    assert f"{total} agent-action decisions" in narrative


def test_the_pack_does_not_present_its_own_check_as_independent() -> None:
    verification = compliance.verification_independence()
    assert verification["independent"] is False
    assert verification["witness"] is None
    assert verification["checkpoint_signature"] is None
    # FR-169's first half, held forward: there is no signing key, so there is
    # nowhere for one to be — least of all the database this check reads.
    assert verification["signing_key_location"] is None
    assert "not independent verification" in verification["statement"]


def test_the_oversight_guarantee_is_scoped_to_the_door_it_holds_at() -> None:
    """`AD-28`: a coverage claim carries its ingress path. Now the pack does too."""
    scope: dict[str, Any] = compliance._oversight_scope(
        {"mcp_gateway": 7, "authorize_api": 2, "llm_proxy": 1, "unrecorded": 1}
    )
    assert scope["enforced_at_gateway"] == 7
    assert scope["cooperative_or_unrecorded"] == 4
    assert "cannot bypass" in scope["statement"]
    assert "depends on the agent" in scope["statement"]


def test_an_unenforced_period_is_disclosed_with_the_supervision_figures(db: DBHandle) -> None:
    """FR-179 — an observation window is not allowed to sit silently inside a proof.

    A window stands the gateway down on one agent for a bounded time. That is a
    legitimate, attributed, opt-in operation; averaging it into a human-oversight
    figure answers a narrower question than the regulator is asking.
    """
    quiet = compliance.observation_disclosure(db.conn, None)
    assert quiet["windows"] == 0
    assert "no observation window was ever opened" in quiet["statement"]

    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    _, token = tenant_tokens.mint(db.conn, tenant_id=tenant, name="bot")
    monitor.open_window(
        db.conn,
        tenant_id=tenant,
        gateway_token_id=str(token["id"]),
        hours=1,
        max_hours=8,
        opened_by="op-1",
    )
    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision="monitor_hold",
        tool_name="crm.update",
        action_class="write",
        gateway_token_id=str(token["id"]),
        origin=audit.Origin.llm_proxy(observing=True),
    )
    db.conn.commit()

    disclosed = compliance.observation_disclosure(db.conn, None)
    assert disclosed["windows"] == 1 and disclosed["still_running"] == 1
    assert disclosed["calls_decided_under_observation"] == 1
    assert disclosed["calls_let_through"] == 1
    # The bound travels with the disclosure: the exposure was never unlimited.
    assert disclosed["never_relaxed"] == ["external_send", "irreversible"]
    assert "excluded from the oversight figures" in disclosed["statement"]
