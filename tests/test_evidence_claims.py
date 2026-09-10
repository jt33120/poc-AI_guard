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

import pytest

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
    "agent_stopped": 1,  # gateway/server.py::_stop_blocks -- jeton révoqué
    "stop_state_unreadable": 1,  # idem -- état d'arrêt illisible
    "taint_marked": 1,  # gateway/server.py::_audit_gate
    "prompt_leak_verbatim": 1,  # api/llm_proxy.py::_audit_prompt_leak (`FR-190`)
    "prompt_guard_flagged": 1,  # api/llm_proxy.py::_audit_prompt_guard (`FR-193`)
    "prompt_guard_clean": 1,  # idem
    "prompt_guard_unavailable": 1,  # idem — un garde muet ne certifie rien
    "tool_drift": 1,  # gateway/server.py::_INTEGRITY_DECISION
    "poison_suspected": 1,  # idem
    "tool_quarantined": 1,  # idem
    "flag": 1,  # core/dlp.py::ScanResult.decision
    "redacted": 1,  # idem
    "monitor_hold": 2,  # api/llm_proxy.py::_process under an open window
    "monitor_deny": 1,  # idem
    # Les deux angles morts déclarés du proxy. `streamed_uninspected` manquait à
    # CETTE liste **et** à `_BUCKETS` depuis son introduction : il était compté dans
    # le total et rapporté nulle part. C'est ce qui a montré qu'un inventaire écrit
    # à la main, comparé à une autre liste écrite à la main, ne garde rien — d'où le
    # garde de `tests/conftest.py`, qui écoute le point d'écriture.
    "streamed_uninspected": 1,  # api/llm_proxy.py::_audit_streamed (`G-26`)
    "relayed_unparsed": 1,  # api/llm_proxy.py::_audit_unparsed
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


def test_a_relayed_but_uninspected_completion_is_never_reported_as_allowed() -> None:
    """Le trafic qu'on n'a pas regardé a sa propre case, et ce n'est pas « autorisé ».

    Même faute que compter `monitor_*` comme un allow, et le fichier la refuse déjà
    pour celui-là. Une complétion streamée, ou un corps que le proxy n'a pas su lire,
    n'est pas une action que nous avons approuvée : c'est une action que nous
    n'avons pas vue.
    """
    buckets = export.summarise({"allow": 1, "streamed_uninspected": 4, "relayed_unparsed": 2})
    assert buckets["auto_allowed"] == 1
    assert buckets["not_inspected"] == 6
    assert buckets["unclassified"] == 0
    assert "without inspection" in export.default_narrative(
        export.AI_ACT, {"streamed_uninspected": 4}, 4
    )


@pytest.mark.vocabulaire_libre
def test_the_write_path_itself_reports_a_decision_the_summary_cannot_place(
    db: DBHandle, caplog: Any
) -> None:
    """Le garde qui remplace l'inventaire écrit à la main.

    Il écoute `log_event`, donc il voit ce que le produit **écrit** — y compris les
    décisions qu'aucun scan du code ne retrouverait, parce qu'elles arrivent par une
    table (`_INTEGRITY_DECISION`) ou calculées (`f"monitor_{...}"`). L'inventaire
    ci-dessus reste utile comme documentation ; il n'est plus ce qui tient.

    L'écriture n'est pas refusée : §4.2 dit que rien d'accessoire ne casse une
    écriture d'audit, et `summarise` la compte honnêtement en `unclassified`.
    """
    import logging

    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'V')", (tenant,))
    db.conn.commit()

    with caplog.at_level(logging.WARNING, logger="xsom.audit"):
        audit.log_event(
            db.conn,
            tenant_id=tenant,
            decision="une_decision_inventee_plus_tard",
            origin=audit.Origin.authorize_api(),
        )
        db.conn.commit()

    alarme = next(r for r in caplog.records if r.getMessage() == "decision_not_summarised")
    assert alarme.decision == "une_decision_inventee_plus_tard"  # type: ignore[attr-defined]

    # Et l'écriture a bien eu lieu : le garde avertit, il ne casse pas la preuve.
    ligne = db.conn.execute(
        "select decision from audit_log where tenant_id = %s", (tenant,)
    ).fetchone()
    assert ligne is not None and ligne[0] == "une_decision_inventee_plus_tard"


def test_a_known_decision_raises_no_alarm(db: DBHandle, caplog: Any) -> None:
    """Non-vacuité : une alarme qui sonne toujours ne dit rien."""
    import logging

    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'W')", (tenant,))
    db.conn.commit()

    with caplog.at_level(logging.WARNING, logger="xsom.audit"):
        audit.log_event(
            db.conn, tenant_id=tenant, decision="monitor_hold", origin=audit.Origin.authorize_api()
        )
        db.conn.commit()

    assert not [r for r in caplog.records if r.getMessage() == "decision_not_summarised"]
