"""Cooperative authorization for non-MCP agents — the gateway's decision cycle
(SPEC §5.2) exposed over HTTP, without execution.

An agent calls :func:`authorize` *before* a risky action and honours the verdict:
``allow`` → proceed, ``deny`` → abort, ``hold`` → poll the returned
``approval_id`` until it resolves. Holds surface in the existing approval queue,
and every decision is written to the same hash-chained audit log. Unlike the MCP
gateway, xSOM does not execute the action here — enforcement is **cooperative**
(the agent must call this and obey it). Fail-closed everywhere.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg

from core import approvals, audit, db
from core.judge import Judge
from core.notify import Notifier
from core.policy import Approval, Policy, PolicyOutcome, escalate_for_class, evaluate

logger = logging.getLogger("xsom.decision")

# Approval terminal status -> (audit decision, verdict returned to the agent).
_TERMINAL: dict[str, tuple[str, str]] = {
    "approved": ("hitl_approved", "allow"),
    "denied": ("hitl_denied", "deny"),
    "expired": ("expired", "deny"),
}


def _class(outcome: PolicyOutcome) -> str | None:
    return outcome.action_class.value if outcome.action_class else None


def _audit(
    database_url: str,
    *,
    tenant_id: str,
    decision: str,
    tool: str,
    request_id: str,
    action_class: str | None,
    policy_rule_id: str | None = None,
    judge_used: bool = False,
    args_hash: str | None = None,
) -> None:
    with db.connection(database_url) as conn:
        audit.log_event(
            conn,
            tenant_id=tenant_id,
            decision=decision,
            request_id=request_id,
            tool_name=tool,
            action_class=action_class,
            policy_rule_id=policy_rule_id,
            judge_used=judge_used,
            args_hash=args_hash,
        )


def _notify(notifier: Notifier | None, approval_id: str, summary: str, expires_at: str) -> None:
    if notifier is None:
        return
    try:
        notifier.notify_approval(approval_id=approval_id, summary=summary, expires_at=expires_at)
    except Exception:  # best-effort; a missed notification leaves the action pending (safe)
        logger.warning("approval_notify_failed", extra={"approval_id": approval_id})


def authorize(
    *,
    database_url: str,
    policy: Policy,
    tenant_id: str,
    tool: str,
    arguments: dict[str, Any],
    judge: Judge | None = None,
    requested_by: str | None = None,
    timeout_seconds: int = 3600,
    notifier: Notifier | None = None,
) -> dict[str, Any]:
    """Decide whether the agent may perform ``tool`` with ``arguments``."""
    outcome = evaluate(policy, tool, arguments)

    # Ambiguous tools: the judge classifies (never authorizes); escalate to a floor.
    if outcome.ambiguous and judge is not None:
        judged = judge.classify(tool, approvals.redact(arguments))
        outcome = PolicyOutcome(
            judged, escalate_for_class(outcome.decision, judged), outcome.rule_name, "judge", True
        )

    ah = approvals.args_hash(arguments)

    if outcome.decision is Approval.auto:
        request_id = uuid4().hex
        _audit(
            database_url,
            tenant_id=tenant_id,
            decision="allow",
            tool=tool,
            request_id=request_id,
            action_class=_class(outcome),
            policy_rule_id=outcome.rule_name,
            judge_used=outcome.ambiguous,
            args_hash=ah,
        )
        return {"decision": "allow", "action_class": _class(outcome), "reason": outcome.reason}

    if outcome.decision is Approval.deny:
        request_id = uuid4().hex
        _audit(
            database_url,
            tenant_id=tenant_id,
            decision="deny",
            tool=tool,
            request_id=request_id,
            action_class=_class(outcome),
            policy_rule_id=outcome.rule_name,
            judge_used=outcome.ambiguous,
            args_hash=ah,
        )
        return {"decision": "deny", "action_class": _class(outcome), "reason": outcome.reason}

    # human_in_the_loop / human_dual
    required = 2 if outcome.decision is Approval.human_dual else 1
    with db.connection(database_url) as conn:
        record = approvals.find_active(conn, tenant_id, tool, ah)
        if record is not None:
            record = approvals.expire_if_needed(conn, record)
            conn.commit()

        if record is None:
            action_class = _class(outcome)
            dry_run = approvals.build_dry_run(tool, action_class, arguments)
            expires_at = datetime.now(UTC) + timedelta(seconds=timeout_seconds)
            record = approvals.create(
                conn,
                tenant_id=tenant_id,
                request_id=uuid4().hex,
                tool_name=tool,
                action_class=action_class,
                ah=ah,
                arguments_summary=approvals.redact(arguments),
                dry_run=dry_run,
                required_count=required,
                expires_at=expires_at,
                requested_by=requested_by,
            )
            conn.commit()
            summary = str(record.dry_run.get("summary", ""))
            _audit(
                database_url,
                tenant_id=tenant_id,
                decision="hitl_pending",
                tool=tool,
                request_id=record.id,
                action_class=action_class,
                policy_rule_id=outcome.rule_name,
                judge_used=outcome.ambiguous,
                args_hash=ah,
            )
            _notify(notifier, record.id, summary, record.expires_at.isoformat())
            return _hold(record.id, record.action_class, summary)

        if record.status == "pending":
            return _hold(record.id, record.action_class, str(record.dry_run.get("summary", "")))

        return _resolve_terminal(database_url, conn, tenant_id, record)


def poll(*, database_url: str, tenant_id: str, approval_id: str) -> dict[str, Any] | None:
    """Current verdict for a held action; None if the approval is unknown to the tenant."""
    with db.connection(database_url) as conn:
        record = approvals.get(conn, tenant_id, approval_id)
        if record is None:
            return None
        record = approvals.expire_if_needed(conn, record)
        conn.commit()
        if record.status == "pending":
            return _hold(record.id, record.action_class, str(record.dry_run.get("summary", "")))
        return _resolve_terminal(database_url, conn, tenant_id, record)


def _hold(approval_id: str, action_class: str | None, summary: str) -> dict[str, Any]:
    return {
        "decision": "hold",
        "status": "pending",
        "approval_id": approval_id,
        "action_class": action_class,
        "reason": "requires_approval",
        "summary": summary,
    }


def _resolve_terminal(
    database_url: str,
    conn: psycopg.Connection,
    tenant_id: str,
    record: approvals.ApprovalRecord,
) -> dict[str, Any]:
    audit_decision, verdict = _TERMINAL[record.status]
    # Record the terminal decision once (the first consumer), then it is spent.
    if approvals.consume(conn, record.id):
        conn.commit()
        _audit(
            database_url,
            tenant_id=tenant_id,
            decision=audit_decision,
            tool=record.tool_name,
            request_id=record.id,
            action_class=record.action_class,
        )
    else:
        conn.commit()
    return {
        "decision": verdict,
        "status": record.status,
        "approval_id": record.id,
        "action_class": record.action_class,
        "reason": record.status,
    }
