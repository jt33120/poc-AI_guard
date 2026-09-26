"""Approval records for an action intercepted by Developer Guard.

Only a fixed metadata tuple crosses the workstation boundary. The opaque action
binding is calculated locally from the intercepted action and is never a prompt,
command, resource path, or tool argument.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from core import approvals

_TTL = timedelta(minutes=5)


def _record_view(record: approvals.ApprovalRecord) -> dict[str, Any]:
    return {
        "approval_id": record.id,
        "status": record.status,
        "expires_at": record.expires_at.isoformat(),
    }


def _assigned_policy(
    conn: Any, tenant_id: str, device_id: str, policy_id: str, policy_version: int
) -> bool:
    row = conn.execute(
        "select 1 from developer_policy_assignments a "
        "join developer_policies p on p.tenant_id=a.tenant_id and p.policy_id=a.policy_id "
        "where a.tenant_id=%s and a.device_id=%s and a.policy_id=%s and p.version=%s "
        "and p.revoked_at is null and p.expires_at > now()",
        (tenant_id, device_id, policy_id, policy_version),
    ).fetchone()
    return row is not None


def request(
    conn: Any,
    *,
    tenant_id: str,
    device_id: str,
    request_id: str,
    policy_id: str,
    policy_version: int,
    action_binding: str,
    tool_name: str,
    action_class: str,
) -> dict[str, Any]:
    """Create or return an idempotent approval request for the exact local action."""
    if not _assigned_policy(conn, tenant_id, device_id, policy_id, policy_version):
        raise LookupError("policy_not_assigned")
    existing = conn.execute(
        "select id,tool_name,action_class,status,required_count,approved_by,dry_run,"
        "expires_at,decided_by,developer_policy_id,developer_policy_version,"
        "developer_action_binding "
        "from approvals where tenant_id=%s and developer_device_id=%s and request_id=%s",
        (tenant_id, device_id, request_id),
    ).fetchone()
    if existing is not None:
        if (existing[9], existing[10], existing[11]) != (
            policy_id,
            policy_version,
            action_binding,
        ):
            raise ValueError("request_binding_conflict")
        record = approvals.expire_if_needed(conn, approvals._to_record(existing))
        return _record_view(record)
    now = datetime.now(UTC)
    record = approvals.create(
        conn,
        tenant_id=tenant_id,
        request_id=request_id,
        tool_name=f"developer-guard.{tool_name}",
        action_class=action_class,
        ah=action_binding,
        arguments_summary={"source": "developer_guard"},
        dry_run={
            "tool": tool_name,
            "action_class": action_class,
            "summary": f"Developer Guard approval for {tool_name} [{action_class}]",
        },
        required_count=1,
        expires_at=now + _TTL,
        requested_by=device_id,
    )
    conn.execute(
        "update approvals set developer_device_id=%s, developer_policy_id=%s, "
        "developer_policy_version=%s, developer_action_binding=%s where id=%s",
        (device_id, policy_id, policy_version, action_binding, record.id),
    )
    return _record_view(record)


def consume_if_approved(
    conn: Any,
    *,
    tenant_id: str,
    device_id: str,
    approval_id: str,
    policy_id: str,
    policy_version: int,
    action_binding: str,
) -> dict[str, Any] | None:
    """Consume a human decision once, only for the original device/action tuple."""
    row = conn.execute(
        "select id,tool_name,action_class,status,required_count,approved_by,dry_run,"
        "expires_at,decided_by "
        "from approvals where id=%s and tenant_id=%s and developer_device_id=%s "
        "and developer_policy_id=%s and developer_policy_version=%s "
        "and developer_action_binding=%s",
        (approval_id, tenant_id, device_id, policy_id, policy_version, action_binding),
    ).fetchone()
    if row is None:
        return None
    record = approvals.expire_if_needed(conn, approvals._to_record(row))
    consumed = None
    if record.status == "approved":
        consumed = conn.execute(
            "update approvals set consumed_at=now() where id=%s and tenant_id=%s "
            "and developer_device_id=%s and developer_policy_id=%s "
            "and developer_policy_version=%s and developer_action_binding=%s "
            "and status='approved' and expires_at > now() and consumed_at is null returning id",
            (
                record.id,
                tenant_id,
                device_id,
                policy_id,
                policy_version,
                action_binding,
            ),
        ).fetchone()
    if consumed is None:
        return _record_view(record)
    return {
        "approval_id": record.id,
        "status": "consumed",
        "expires_at": record.expires_at.isoformat(),
    }
