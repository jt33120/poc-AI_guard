"""Unit tests for approval data access + dry-run/redaction (SPEC §7, M4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from core import approvals
from tests.conftest import DBHandle


def _seed_tenant(db: DBHandle) -> str:
    tenant_id = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return str(tenant_id)


def _create(db: DBHandle, tenant_id: str, *, required: int = 1, seconds: int = 3600) -> str:
    record = approvals.create(
        db.conn,
        tenant_id=tenant_id,
        request_id=uuid4().hex,
        tool_name="crm.delete_contact",
        action_class="irreversible",
        ah=approvals.args_hash({"contact_id": "c1"}),
        arguments_summary={"contact_id": "c1"},
        dry_run={"summary": "Execute crm.delete_contact"},
        required_count=required,
        expires_at=datetime.now(UTC) + timedelta(seconds=seconds),
        requested_by=None,
    )
    db.conn.commit()
    return record.id


def test_args_hash_is_order_independent() -> None:
    assert approvals.args_hash({"a": 1, "b": 2}) == approvals.args_hash({"b": 2, "a": 1})


def test_redact_masks_secrets_and_truncates() -> None:
    red = approvals.redact({"password": "hunter2", "to": "x" * 500, "n": 3})
    assert red["password"] == "***"
    assert len(red["to"]) == 200
    assert red["n"] == 3


def test_build_dry_run_is_human_readable_without_secrets() -> None:
    dry = approvals.build_dry_run(
        "mail.send", "external_send", {"to": "a@client.fr", "token": "s3cr3t"}
    )
    assert "mail.send" in dry["summary"]
    assert "s3cr3t" not in dry["summary"]


def test_create_find_and_get(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id)
    found = approvals.find_active(
        db.conn, tenant_id, "crm.delete_contact", approvals.args_hash({"contact_id": "c1"})
    )
    assert found is not None and found.id == approval_id and found.status == "pending"
    assert approvals.get(db.conn, tenant_id, approval_id) is not None


def test_consume_is_idempotent(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id)
    assert approvals.consume(db.conn, approval_id) is True
    assert approvals.consume(db.conn, approval_id) is False


def test_expire_if_needed_marks_expired(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id, seconds=-10)
    record = approvals.get(db.conn, tenant_id, approval_id)
    assert record is not None
    expired = approvals.expire_if_needed(db.conn, record)
    assert expired.status == "expired"


def test_decide_approve_single(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id, required=1)
    record = approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    assert record is not None and record.status == "approved"


def test_decide_deny(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id)
    record = approvals.decide(db.conn, tenant_id, approval_id, "deny", "op-1")
    assert record is not None and record.status == "denied"


def test_decide_human_dual_needs_two_distinct_approvers(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    approval_id = _create(db, tenant_id, required=2)
    first = approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    assert first is not None and first.status == "pending"
    again = approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")  # same approver
    assert again is not None and again.status == "pending"
    second = approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-2")
    assert second is not None and second.status == "approved"


def test_decide_unknown_returns_none(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    assert approvals.decide(db.conn, tenant_id, str(uuid4()), "approve", "op-1") is None
