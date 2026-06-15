"""Human-in-the-loop approvals: data access + dry-run construction (SPEC §7, M4).

The dry-run and arguments_summary are *redacted* (secrets masked, values
truncated) — enough for a human to judge the effect, never raw secrets/PII
(CLAUDE.md §4.10). Matching a re-invocation to an approval uses args_hash only.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Json

_SENSITIVE = ("password", "secret", "token", "key", "authorization", "credential", "api_key")
_MAX_PREVIEW = 200

_RECORD_COLS = (
    "id, tool_name, action_class, status, required_count, approved_by, dry_run, expires_at"
)


@dataclass(frozen=True)
class ApprovalRecord:
    id: str
    tool_name: str
    action_class: str | None
    status: str
    required_count: int
    approved_by: list[str]
    dry_run: dict[str, Any]
    expires_at: datetime


def args_hash(arguments: dict[str, Any]) -> str:
    """Stable hash of arguments (order-independent), used for matching + audit."""
    canonical = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def redact(arguments: dict[str, Any]) -> dict[str, Any]:
    """Mask secret-looking keys and truncate values for safe human display."""
    out: dict[str, Any] = {}
    for key, value in arguments.items():
        if any(token in key.lower() for token in _SENSITIVE):
            out[key] = "***"
        elif isinstance(value, str):
            out[key] = value[:_MAX_PREVIEW]
        elif isinstance(value, bool | int | float) or value is None:
            out[key] = value
        else:
            out[key] = f"<{type(value).__name__}>"
    return out


def build_dry_run(
    tool_name: str, action_class: str | None, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Human-readable description of the effect, without triggering it."""
    redacted = redact(arguments)
    rendered = ", ".join(f"{k}={v!r}" for k, v in redacted.items())
    klass = action_class or "unknown"
    summary = f"Execute {tool_name} [{klass}]"
    if rendered:
        summary += f" with {rendered}"
    return {
        "tool": tool_name,
        "action_class": action_class,
        "arguments": redacted,
        "summary": summary,
    }


def _to_record(row: tuple[Any, ...]) -> ApprovalRecord:
    return ApprovalRecord(
        id=str(row[0]),
        tool_name=row[1],
        action_class=row[2],
        status=row[3],
        required_count=row[4],
        approved_by=list(row[5]),
        dry_run=row[6],
        expires_at=row[7],
    )


def find_active(
    conn: psycopg.Connection, tenant_id: str, tool_name: str, ah: str
) -> ApprovalRecord | None:
    """Most recent unconsumed approval for (tenant, tool, args), if any."""
    row = conn.execute(
        f"select {_RECORD_COLS} from approvals "
        "where tenant_id = %s and tool_name = %s and args_hash = %s and consumed_at is null "
        "order by created_at desc limit 1",
        (tenant_id, tool_name, ah),
    ).fetchone()
    return _to_record(row) if row else None


def get(conn: psycopg.Connection, tenant_id: str, approval_id: str) -> ApprovalRecord | None:
    row = conn.execute(
        f"select {_RECORD_COLS} from approvals where id = %s and tenant_id = %s",
        (approval_id, tenant_id),
    ).fetchone()
    return _to_record(row) if row else None


def create(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    request_id: str,
    tool_name: str,
    action_class: str | None,
    ah: str,
    arguments_summary: dict[str, Any],
    dry_run: dict[str, Any],
    required_count: int,
    expires_at: datetime,
    requested_by: str | None,
) -> ApprovalRecord:
    row = conn.execute(
        "insert into approvals "
        "(tenant_id, request_id, tool_name, action_class, args_hash, arguments_summary, "
        " dry_run, required_count, expires_at, requested_by) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        f"returning {_RECORD_COLS}",
        (
            tenant_id,
            request_id,
            tool_name,
            action_class,
            ah,
            Json(arguments_summary),
            Json(dry_run),
            required_count,
            expires_at,
            requested_by,
        ),
    ).fetchone()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("approval insert did not return a row")
    return _to_record(row)


def expire_if_needed(conn: psycopg.Connection, record: ApprovalRecord) -> ApprovalRecord:
    """Lazily move a pending-but-past-deadline approval to 'expired' (= deny)."""
    if record.status == "pending" and record.expires_at <= datetime.now(UTC):
        conn.execute(
            "update approvals set status = 'expired', decided_at = now() "
            "where id = %s and status = 'pending'",
            (record.id,),
        )
        row = conn.execute(
            f"select {_RECORD_COLS} from approvals where id = %s", (record.id,)
        ).fetchone()
        if row is not None:
            return _to_record(row)
    return record


def consume(conn: psycopg.Connection, approval_id: str) -> bool:
    """Atomically mark an approval consumed; True only on the first call."""
    row = conn.execute(
        "update approvals set consumed_at = now() "
        "where id = %s and consumed_at is null returning id",
        (approval_id,),
    ).fetchone()
    return row is not None


def decide(
    conn: psycopg.Connection,
    tenant_id: str,
    approval_id: str,
    decision: str,
    decided_by: str,
) -> ApprovalRecord | None:
    """Record an approve/deny decision (handles human_dual quorum). None if absent."""
    record = get(conn, tenant_id, approval_id)
    if record is None:
        return None
    record = expire_if_needed(conn, record)
    if record.status != "pending":
        return record  # already decided/expired: caller treats as conflict

    if decision == "deny":
        conn.execute(
            "update approvals set status = 'denied', decided_by = %s, decided_at = now() "
            "where id = %s",
            (decided_by, approval_id),
        )
    else:  # approve
        approvers = sorted(set(record.approved_by) | {decided_by})
        new_status = "approved" if len(approvers) >= record.required_count else "pending"
        decided_at = "now()" if new_status == "approved" else "null"
        conn.execute(
            f"update approvals set approved_by = %s, status = %s, "
            f"decided_by = %s, decided_at = {decided_at} where id = %s",
            (approvers, new_status, decided_by, approval_id),
        )
    conn.commit()
    updated = get(conn, tenant_id, approval_id)
    return updated


_VIEW_COLS = (
    "id, request_id, tool_name, action_class, status, dry_run, required_count, "
    "approved_by, created_at, expires_at, decided_at, decided_by"
)


def _row_to_view(r: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(r[0]),
        "request_id": r[1],
        "tool_name": r[2],
        "action_class": r[3],
        "status": r[4],
        "dry_run": r[5],
        "required_count": r[6],
        "approved_by": list(r[7]),
        "created_at": r[8].isoformat() if r[8] else None,
        "expires_at": r[9].isoformat() if r[9] else None,
        "decided_at": r[10].isoformat() if r[10] else None,
        "decided_by": r[11],
    }


def get_view(conn: psycopg.Connection, tenant_id: str, approval_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        f"select {_VIEW_COLS} from approvals where id = %s and tenant_id = %s",
        (approval_id, tenant_id),
    ).fetchone()
    return _row_to_view(row) if row else None


def list_for_tenant(conn: psycopg.Connection, status: str | None = None) -> list[dict[str, Any]]:
    """RLS-scoped list of the tenant's approvals (optionally filtered by status)."""
    if status is None:
        rows = conn.execute(
            f"select {_VIEW_COLS} from approvals order by created_at desc"
        ).fetchall()
    else:
        rows = conn.execute(
            f"select {_VIEW_COLS} from approvals where status = %s order by created_at desc",
            (status,),
        ).fetchall()
    return [_row_to_view(r) for r in rows]
