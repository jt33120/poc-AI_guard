"""EU AI Act compliance plane (M9): retention guard, chain integrity, oversight."""

from __future__ import annotations

import pytest

from core import audit, compliance
from tests.conftest import DBHandle

_TENANT = "00000000-0000-0000-0000-000000000001"  # usage_events.tenant_id is uuid


def _old_usage(db: DBHandle, *, days: int, n: int = 1) -> None:
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A') on conflict do nothing", (_TENANT,)
    )
    for _ in range(n):
        db.conn.execute(
            "insert into usage_events "
            "(tenant_id, provider, model, prompt_tokens, completion_tokens, total_tokens, "
            " cost_usd, ts) "
            "values (%s, 'openai', 'gpt', 1, 1, 2, 0.0, now() - make_interval(days => %s))",
            (_TENANT, days),
        )
    db.conn.commit()


# --- retention guard (pure) --------------------------------------------------
def test_guard_retention_refuses_below_floor() -> None:
    with pytest.raises(compliance.RetentionError):
        compliance.guard_retention(100, floor=183)


def test_guard_retention_allows_at_or_above_floor() -> None:
    compliance.guard_retention(183, floor=183)  # no raise
    compliance.guard_retention(365, floor=183)


# --- enforced retention purge (operational data only) ------------------------
def test_enforce_retention_purge_deletes_above_floor(db: DBHandle) -> None:
    _old_usage(db, days=400)
    removed = compliance.enforce_retention_purge(db.conn, days=365, floor=183)
    db.conn.commit()
    assert removed == 1


def test_enforce_retention_purge_refuses_below_floor(db: DBHandle) -> None:
    _old_usage(db, days=400)
    with pytest.raises(compliance.RetentionError):
        compliance.enforce_retention_purge(db.conn, days=100, floor=183)
    remaining = db.conn.execute("select count(*) from usage_events").fetchone()
    assert remaining is not None and remaining[0] == 1  # nothing deleted


# --- article 12: chain integrity --------------------------------------------
def test_chain_integrity_reports_ok(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b")
    audit.log_event(db.conn, tenant_id="t1", decision="deny", tool_name="a.c")
    result = compliance.chain_integrity(db.conn, "t1")
    assert result["ok"] is True and result["entries"] == 2 and result["first_broken_id"] is None


def test_chain_integrity_reports_tampering(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.b")
    audit.log_event(db.conn, tenant_id="t1", decision="allow", tool_name="a.c")
    with db.conn.transaction():
        db.conn.execute("set local session_replication_role = replica")
        db.conn.execute(
            "update audit_log set decision = 'deny' where id = (select min(id) from audit_log)"
        )
    result = compliance.chain_integrity(db.conn, "t1")
    assert result["ok"] is False and result["first_broken_id"] is not None


# --- article 14: human oversight coverage -----------------------------------
def test_oversight_flags_auto_allowed_irreversible(db: DBHandle) -> None:
    # An irreversible action that was auto-allowed = an oversight gap.
    audit.log_event(db.conn, tenant_id="t1", decision="allow", action_class="irreversible")
    coverage = compliance.oversight_coverage(db.conn)
    assert coverage["gated"] == 1 and coverage["auto_allowed"] == 1
    assert coverage["coverage_ok"] is False


def test_oversight_ok_when_gated_by_human(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="hitl_approved", action_class="irreversible")
    audit.log_event(db.conn, tenant_id="t1", decision="allow", action_class="read")
    coverage = compliance.oversight_coverage(db.conn)
    assert coverage["auto_allowed"] == 0 and coverage["coverage_ok"] is True


# --- readiness status --------------------------------------------------------
def test_status_ready_when_clean(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="hitl_approved", action_class="irreversible")
    st = compliance.status(db.conn, "t1", retention_floor_days=183)
    assert st["chain_ok"] is True and st["oversight_coverage_ok"] is True
    assert st["retention_ok"] is True and st["ready"] is True
    assert st["oldest_entry_age_days"] is not None and st["oldest_entry_age_days"] >= 0


def test_status_not_ready_when_retention_floor_too_low(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="allow", action_class="read")
    st = compliance.status(db.conn, "t1", retention_floor_days=90)
    assert st["retention_ok"] is False and st["ready"] is False


# --- article 26 / evidence pack ---------------------------------------------
def test_evidence_pack_carries_article_mapping(db: DBHandle) -> None:
    audit.log_event(db.conn, tenant_id="t1", decision="hitl_approved", action_class="irreversible")
    events = audit.list_events(db.conn)
    pack = compliance.build_evidence_pack(
        db.conn, tenant_id="t1", events=events, approvals=[], retention_floor_days=183
    )
    assert pack["standard"].startswith("EU AI Act")
    articles = pack["articles"]
    assert articles["article_12_record_keeping"]["tamper_evident"] is True
    assert "coverage_ok" in articles["article_14_human_oversight"]
    assert "fria" in articles["article_26_deployer"]
    assert pack["compliant"] is True
