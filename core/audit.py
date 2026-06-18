"""Immutable, hash-chained audit log (SPEC §9, M5).

Per event: read the tenant's last entry_hash (or "GENESIS"), build a canonical
JSON payload, and chain entry_hash = sha256(prev_hash + payload). Writes are
serialized per tenant with an advisory lock so the chain has no races. Only
metadata + args_hash is ever stored — never argument values or PII (§4.10).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg

GENESIS = "GENESIS"

_INSERT_COLS = (
    "ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
    "policy_rule_id, judge_used, args_hash, latency_ms, error, prev_hash, entry_hash"
)
_CHAIN_COLS = (
    "id, ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
    "policy_rule_id, judge_used, args_hash, latency_ms, error, prev_hash, entry_hash"
)


@dataclass(frozen=True)
class ChainResult:
    ok: bool
    broken_id: int | None = None
    count: int = 0


def _payload(
    *,
    ts_iso: str,
    tenant_id: str,
    user_id: str | None,
    request_id: str | None,
    tool_name: str | None,
    action_class: str | None,
    decision: str,
    policy_rule_id: str | None,
    judge_used: bool,
    args_hash: str | None,
    latency_ms: int | None,
    error: str | None,
) -> str:
    event = {
        "ts": ts_iso,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "request_id": request_id,
        "tool_name": tool_name,
        "action_class": action_class,
        "decision": decision,
        "policy_rule_id": policy_rule_id,
        "judge_used": judge_used,
        "args_hash": args_hash,
        "latency_ms": latency_ms,
        "error": error,
    }
    return json.dumps(event, sort_keys=True, separators=(",", ":"))


def compute_entry_hash(prev_hash: str, payload: str) -> str:
    return hashlib.sha256((prev_hash + payload).encode("utf-8")).hexdigest()


def log_event(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    decision: str,
    user_id: str | None = None,
    request_id: str | None = None,
    tool_name: str | None = None,
    action_class: str | None = None,
    policy_rule_id: str | None = None,
    judge_used: bool = False,
    args_hash: str | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
    gateway_token_id: str | None = None,
) -> str:
    """Append one hash-chained audit entry for a decision. Returns its entry_hash."""
    ts = datetime.now(UTC)
    with conn.transaction():
        # Serialize chain writes per tenant to avoid two entries sharing a prev_hash.
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (tenant_id,))
        prev_row = conn.execute(
            "select entry_hash from audit_log where tenant_id = %s order by id desc limit 1",
            (tenant_id,),
        ).fetchone()
        prev_hash = prev_row[0] if prev_row else GENESIS
        payload = _payload(
            ts_iso=ts.astimezone(UTC).isoformat(),
            tenant_id=tenant_id,
            user_id=user_id,
            request_id=request_id,
            tool_name=tool_name,
            action_class=action_class,
            decision=decision,
            policy_rule_id=policy_rule_id,
            judge_used=judge_used,
            args_hash=args_hash,
            latency_ms=latency_ms,
            error=error,
        )
        entry_hash = compute_entry_hash(prev_hash, payload)
        # gateway_token_id is an ANNEX column (agent attribution): it is NOT part
        # of `payload`/the hash chain, so existing entries keep verifying (§4.2).
        conn.execute(
            "insert into audit_log "
            "(ts, tenant_id, user_id, request_id, tool_name, action_class, decision, "
            " policy_rule_id, judge_used, args_hash, latency_ms, error, gateway_token_id, "
            " prev_hash, entry_hash) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                ts,
                tenant_id,
                user_id,
                request_id,
                tool_name,
                action_class,
                decision,
                policy_rule_id,
                judge_used,
                args_hash,
                latency_ms,
                error,
                gateway_token_id,
                prev_hash,
                entry_hash,
            ),
        )
    return entry_hash


def verify_chain(conn: psycopg.Connection, tenant_id: str | None = None) -> ChainResult:
    """Recompute the chain; report the first tampered/broken row id, if any."""
    if tenant_id is None:
        rows = conn.execute(f"select {_CHAIN_COLS} from audit_log order by id").fetchall()
    else:
        rows = conn.execute(
            f"select {_CHAIN_COLS} from audit_log where tenant_id = %s order by id",
            (tenant_id,),
        ).fetchall()

    last_hash_by_tenant: dict[str, str] = {}
    for r in rows:
        row_tenant = r[2]
        expected_prev = last_hash_by_tenant.get(row_tenant, GENESIS)
        stored_prev, stored_entry = r[13], r[14]
        if stored_prev != expected_prev:
            return ChainResult(ok=False, broken_id=r[0], count=len(rows))
        payload = _payload(
            ts_iso=r[1].astimezone(UTC).isoformat(),
            tenant_id=row_tenant,
            user_id=r[3],
            request_id=r[4],
            tool_name=r[5],
            action_class=r[6],
            decision=r[7],
            policy_rule_id=r[8],
            judge_used=r[9],
            args_hash=r[10],
            latency_ms=r[11],
            error=r[12],
        )
        if compute_entry_hash(stored_prev, payload) != stored_entry:
            return ChainResult(ok=False, broken_id=r[0], count=len(rows))
        last_hash_by_tenant[row_tenant] = stored_entry
    return ChainResult(ok=True, broken_id=None, count=len(rows))


def distinct_tools(conn: psycopg.Connection, tenant_id: str) -> list[str]:
    """Distinct tool names a tenant's agents have actually invoked (observed catalogue)."""
    rows = conn.execute(
        "select distinct tool_name from audit_log "
        "where tenant_id = %s and tool_name is not null order by tool_name",
        (tenant_id,),
    ).fetchall()
    return [r[0] for r in rows]


def list_events(
    conn: psycopg.Connection,
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    decision: str | None = None,
    tool: str | None = None,
    agent: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Tenant-scoped (RLS) audit events with optional filters; metadata only."""
    clauses: list[str] = []
    params: list[Any] = []
    if from_ts:
        clauses.append("ts >= %s")
        params.append(from_ts)
    if to_ts:
        clauses.append("ts <= %s")
        params.append(to_ts)
    if decision:
        clauses.append("decision = %s")
        params.append(decision)
    if tool:
        clauses.append("tool_name = %s")
        params.append(tool)
    if agent:
        clauses.append("gateway_token_id = %s")
        params.append(agent)
    where = (" where " + " and ".join(clauses)) if clauses else ""
    params.append(limit)
    rows = conn.execute(
        "select id, ts, tool_name, action_class, decision, policy_rule_id, judge_used, "
        "args_hash, latency_ms, error, user_id, request_id, gateway_token_id from audit_log"
        + where
        + " order by id desc limit %s",
        tuple(params),
    ).fetchall()
    return [
        {
            "id": r[0],
            "ts": r[1].astimezone(UTC).isoformat() if r[1] else None,
            "tool_name": r[2],
            "action_class": r[3],
            "decision": r[4],
            "policy_rule_id": r[5],
            "judge_used": r[6],
            "args_hash": r[7],
            "latency_ms": r[8],
            "error": r[9],
            "user_id": r[10],
            "request_id": r[11],
            "gateway_token_id": str(r[12]) if r[12] else None,
        }
        for r in rows
    ]
