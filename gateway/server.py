"""MCP gateway server (SPEC §5).

The gateway is an MCP *server* to the agent and an MCP *client* to downstream
tool servers. Its tool list and call routing are provided by a pluggable
``ToolBackend``; the default exposes zero tools, and ``DownstreamProxy`` (M2)
aggregates/relays the tenant's downstream servers. Policy/HITL/audit wrap the
relay in later milestones (M3+).

The low-level ``Server`` is used on purpose: the tool list is dynamic.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

import mcp.types as types
from mcp.server.lowlevel import Server

from core import approvals, audit, db, integrity, risk, taint_store, tenant_tokens, trust
from core.judge import Judge, resolve_ambiguous
from core.notify import Notifier
from core.policy import (
    ActionClass,
    Approval,
    Policy,
    PolicyOutcome,
    evaluate,
    service_down_verdict,
)
from core.tenant_tokens import authenticate_gateway_session
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.taint import taints_result

logger = logging.getLogger("xsom.gateway")

SERVER_NAME = "xsom-ai-guard"

#: Environment variable carrying the tenant-scoped gateway token (stdio sessions).
TENANT_TOKEN_ENV = "XSOM_TENANT_TOKEN"  # noqa: S105 - env var name, not a secret


class ToolBackend(Protocol):
    """What the gateway needs from whatever provides/relays tools."""

    async def list_tools(self) -> list[types.Tool]: ...

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult: ...


class EmptyBackend:
    """Default backend: no tools (used before any downstream server is wired)."""

    async def list_tools(self) -> list[types.Tool]:
        return []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        raise ValueError(f"no such tool: {name}")


def _denied_result(message: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=message)], isError=True
    )


def _result_text(result: types.CallToolResult) -> str:
    """Concatenate a tool result's text parts (for taint scanning only, never stored)."""
    parts = [item.text for item in result.content if isinstance(item, types.TextContent)]
    return "\n".join(parts)


#: Map a quarantine status to its audit decision string.
_INTEGRITY_DECISION: dict[integrity.ToolStatus, str] = {
    integrity.ToolStatus.drift: "tool_drift",
    integrity.ToolStatus.poison: "poison_suspected",
    integrity.ToolStatus.new: "tool_quarantined",
}


@dataclass
class ApprovalContext:
    """What the gateway needs to run the HITL flow for a tenant."""

    database_url: str
    tenant_id: str
    timeout_seconds: int = 3600
    notifier: Notifier | None = None
    requested_by: str | None = None
    #: The calling agent's client id, for per-tool RBAC (None = no client scope).
    client_id: str | None = None
    #: The calling agent itself, as the control plane names it. The persisted taint
    #: (`FR-154`) is keyed on this rather than on anything the agent declares.
    gateway_token_id: str | None = None


class PolicyBackend:
    """Enforces the policy over a downstream proxy: auto / deny / HITL.

    The agent-facing tool name may be bare; policy is always evaluated against the
    canonical ``server.tool`` name. ``auto`` relays; ``deny`` refuses; ``human_*``
    enters the approval flow (or, with no approval context, fails closed).
    """

    def __init__(
        self,
        policy: Policy,
        proxy: DownstreamProxy,
        approval_ctx: ApprovalContext | None = None,
        judge: Judge | None = None,
    ) -> None:
        self._policy = policy
        self._proxy = proxy
        self._approval_ctx = approval_ctx
        self._judge = judge
        # Tools quarantined by the integrity guard during the last list_tools.
        self._quarantined: set[str] = set()
        #: Reason from the last taint read, for the audit line that follows it.
        self._taint_reason: str | None = None
        # Indirect-injection taint is persisted, keyed on the agent (FR-154). It is
        # deliberately NOT held here: an object on this instance dies with the
        # connection, and a guard a reconnect defeats is not a guard.

    @property
    def _integrity_on(self) -> bool:
        return self._approval_ctx is not None and self._policy.defaults.integrity_enabled

    async def list_tools(self) -> list[types.Tool]:
        tools = await self._proxy.list_tools()
        if not self._integrity_on:
            return tools
        return await self._screen_tools(tools)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        if self._integrity_on:
            blocked = await self._integrity_blocks(name)
            if blocked is not None:
                logger.info("tool_quarantined", extra={"tool": name, "reason": blocked})
                return _denied_result(f"'{name}' quarantined by integrity guard: {blocked}")
        resolved = await self._proxy.resolve(name)
        canonical = f"{resolved[0]}.{resolved[1]}" if resolved else name

        # Per-tool RBAC / confused-deputy guard: an agent outside a tool's client
        # allowlist can never invoke it, regardless of the action class (fail-closed).
        rbac = self._rbac_blocks(canonical)
        if rbac is not None:
            logger.info("tool_rbac_denied", extra={"tool": canonical, "reason": rbac})
            self._audit_gate(canonical, "rbac_denied", rbac)
            return _denied_result(f"'{canonical}' denied: agent not authorized ({rbac})")

        outcome = evaluate(self._policy, canonical, arguments)

        # Ambiguous tools: classify, then floor for that class. The judge only
        # classifies — never authorizes — and an absent judge floors to
        # irreversible rather than letting the rule's approval stand (AD-34).
        outcome = resolve_ambiguous(outcome, self._judge, canonical, arguments)

        # Graduated autonomy (M11): risk-score an `auto` outcome and tighten it.
        outcome = self._apply_risk(canonical, outcome, arguments)

        # Indirect-injection guard (M12): a risky action in a tainted session is
        # escalated to a human or denied, before anything runs.
        if self._taint_blocks(outcome):
            self._audit_gate(canonical, "tainted_action", self._taint_reason)
            if self._policy.defaults.taint_policy == "deny":
                logger.info("tainted_action_denied", extra={"tool": canonical})
                return _denied_result(
                    f"'{canonical}' denied: session tainted by a prior tool result"
                )
            outcome = replace(outcome, decision=Approval.human_in_the_loop, reason="taint")

        if outcome.decision in (Approval.auto, Approval.notify):
            # notify-and-proceed (M11) relays like auto but is recorded distinctly.
            decision = "allow" if outcome.decision is Approval.auto else "notify"
            start = time.monotonic()
            result = await self._proxy.call_tool(name, arguments)
            latency_ms = int((time.monotonic() - start) * 1000)
            self._audit(
                decision,
                canonical,
                outcome,
                arguments,
                latency_ms=latency_ms,
                request_id=uuid4().hex,
                error="downstream_error" if result.isError else None,
            )
            self._mark_taint(canonical, result)
            return result
        if outcome.decision is Approval.deny:
            logger.info(
                "tool_denied",
                extra={"tool": canonical, "decision": "deny", "reason": outcome.reason},
            )
            self._audit("deny", canonical, outcome, arguments, request_id=uuid4().hex)
            return _denied_result(f"'{canonical}' not permitted by policy: deny ({outcome.reason})")
        return await self._handle_hitl(name, arguments, canonical, outcome)

    async def _screen_tools(self, tools: list[types.Tool]) -> list[types.Tool]:
        """Fingerprint each tool; expose only approved/unchanged ones, quarantine the rest."""
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - guaranteed non-None by _integrity_on
            return list(tools)
        exposed: list[types.Tool] = []
        quarantined: dict[str, tuple[integrity.ToolStatus, str | None]] = {}
        with db.connection(ctx.database_url) as conn:
            stored = integrity.get_fingerprints(conn, ctx.tenant_id)
            for tool in tools:
                resolved = await self._proxy.resolve(tool.name)
                server = resolved[0] if resolved else "?"
                fp = integrity.fingerprint(tool.name, tool.description, tool.inputSchema)
                poison = integrity.detect_poison(tool.description)
                status = integrity.evaluate_tool(fp, poison, stored.get((server, tool.name)))
                integrity.record_sighting(
                    conn, tenant_id=ctx.tenant_id, server=server, tool_name=tool.name, fp=fp
                )
                if status is integrity.ToolStatus.new and self._policy.defaults.auto_approve_tools:
                    integrity.approve(
                        conn, tenant_id=ctx.tenant_id, server=server, tool_name=tool.name
                    )
                    status = integrity.ToolStatus.ok
                if status is integrity.ToolStatus.ok:
                    exposed.append(tool)
                else:
                    quarantined[tool.name] = (status, poison)
            conn.commit()
        self._quarantined = set(quarantined)
        for tool_name, (status, reason) in quarantined.items():
            self._audit_gate(tool_name, _INTEGRITY_DECISION[status], reason)
        return exposed

    def _rbac_blocks(self, canonical: str) -> str | None:
        """Reason a call must be refused by per-tool RBAC, or None if allowed.

        A tool may pin ``constraints.allowed_clients`` to a set of client ids; only
        agents belonging to one of them may call it (confused-deputy guard).
        """
        rule = self._policy.rule_for(canonical)
        if rule is None:
            return None
        allowed = rule.constraints.get("allowed_clients")
        if isinstance(allowed, list) and allowed:
            client_id = self._approval_ctx.client_id if self._approval_ctx else None
            if client_id not in allowed:
                return "client_not_allowed"
        return None

    async def _integrity_blocks(self, name: str) -> str | None:
        """Reason a call must be refused by the integrity guard, or None if clear."""
        if name in self._quarantined:
            return "quarantined"
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - guaranteed non-None by _integrity_on
            return None
        resolved = await self._proxy.resolve(name)
        server = resolved[0] if resolved else "?"
        with db.connection(ctx.database_url) as conn:
            stored = integrity.get_fingerprints(conn, ctx.tenant_id).get((server, name))
        # Fail-closed: only an approved, unchanged baseline is callable.
        if stored is None or not stored.approved:
            return "unapproved"
        return None

    def _apply_risk(
        self, canonical: str, outcome: PolicyOutcome, arguments: dict[str, Any]
    ) -> PolicyOutcome:
        """Tighten an `auto` outcome by its deterministic risk score (opt-in)."""
        bands = self._policy.defaults.risk_bands
        ctx = self._approval_ctx
        if bands is None or ctx is None or outcome.decision is not Approval.auto:
            return outcome
        with db.connection(ctx.database_url) as conn:
            seen, streak = trust.observed(conn, tenant_id=ctx.tenant_id, tool=canonical)
        tier = risk.escalate_by_risk(
            outcome.decision,
            outcome.action_class,
            arguments,
            bands,
            seen_before=seen,
            clean_streak=streak,
        )
        if tier is outcome.decision:
            return outcome
        return replace(outcome, decision=tier, reason="risk")

    def _taint_blocks(self, outcome: PolicyOutcome) -> bool:
        """Whether a risky action is gated because this agent is tainted (M12).

        `AD-10`: a taint that cannot be read is not a clean one. Every failure path
        answers *tainted*, so an unreachable store gates the irreversible instead of
        waving it through.
        """
        defaults = self._policy.defaults
        if defaults.taint_policy == "off":
            return False
        if outcome.action_class not in (ActionClass.irreversible, ActionClass.external_send):
            return False
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:
            logger.warning("taint_unresolvable", extra={"reason": "no_agent_identity"})
            self._taint_reason = "taint_unresolvable"
            return True
        try:
            with db.connection(ctx.database_url) as conn:
                taint = taint_store.active(conn, ctx.tenant_id, ctx.gateway_token_id)
        except Exception:
            logger.warning("taint_store_unreadable", extra={"tenant_id": ctx.tenant_id})
            self._taint_reason = "taint_store_unreadable"
            return True
        self._taint_reason = taint.reason if taint else None
        return taint is not None

    def _mark_taint(self, canonical: str, result: types.CallToolResult) -> None:
        """Taint this agent if a relayed tool result looks like an injection (M12)."""
        if self._policy.defaults.taint_policy == "off":
            return
        reason = taints_result(_result_text(result))
        if reason is None:
            return
        ctx = self._approval_ctx
        if ctx is None or ctx.gateway_token_id is None:  # pragma: no cover - guarded above
            logger.warning("taint_not_recorded", extra={"tool": canonical})
            return
        try:
            with db.connection(ctx.database_url) as conn:
                taint_store.mark(
                    conn,
                    tenant_id=ctx.tenant_id,
                    gateway_token_id=ctx.gateway_token_id,
                    window_seconds=self._policy.defaults.taint_window_seconds,
                    source_tool=canonical,
                    reason=reason,
                )
                conn.commit()
        except Exception:
            # The write failed, so the next call reads no taint. Say so loudly: this
            # is the one path where a store failure loses a guard rather than
            # tightening one.
            logger.warning("taint_write_failed", extra={"tool": canonical, "reason": reason})
        self._audit_gate(canonical, "taint_marked", reason)

    def _audit_gate(self, tool_name: str, decision: str, reason: str | None) -> None:
        """Best-effort audit of a pre-policy gate decision (integrity / rbac)."""
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - gate audits only fire with a context
            return
        try:
            with db.connection(ctx.database_url) as conn:
                audit.log_event(
                    conn,
                    tenant_id=ctx.tenant_id,
                    decision=decision,
                    tool_name=tool_name,
                    error=reason,
                    origin=audit.Origin.mcp_gateway(),
                )
        except Exception:  # audit is best-effort; never break the call path
            logger.warning("gate_audit_failed", extra={"tool": tool_name})

    def _audit(
        self,
        decision: str,
        canonical: str,
        outcome: PolicyOutcome,
        arguments: dict[str, Any],
        *,
        latency_ms: int | None = None,
        request_id: str | None = None,
        error: str | None = None,
    ) -> None:
        ctx = self._approval_ctx
        if ctx is None:
            return
        try:
            with db.connection(ctx.database_url) as conn:
                audit.log_event(
                    conn,
                    tenant_id=ctx.tenant_id,
                    decision=decision,
                    user_id=ctx.requested_by,
                    request_id=request_id,
                    tool_name=canonical,
                    action_class=outcome.action_class.value if outcome.action_class else None,
                    policy_rule_id=outcome.rule_name,
                    judge_used=outcome.judge_used,
                    args_hash=approvals.args_hash(arguments),
                    latency_ms=latency_ms,
                    error=error,
                    # The mandatory door: an agent speaking MCP cannot route around it.
                    origin=audit.Origin.mcp_gateway(),
                )
        except Exception:  # audit is best-effort; never break the call path
            logger.warning("audit_write_failed", extra={"tool": canonical, "decision": decision})

    async def _handle_hitl(
        self, name: str, arguments: dict[str, Any], canonical: str, outcome: PolicyOutcome
    ) -> types.CallToolResult:
        ctx = self._approval_ctx
        if ctx is None:
            return _denied_result(
                f"'{canonical}' requires approval ({outcome.decision.value}); HITL not configured"
            )
        required = 2 if outcome.decision is Approval.human_dual else 1
        try:
            return await self._run_approval_flow(ctx, name, arguments, canonical, outcome, required)
        except Exception:
            # Approval service unavailable. Same shared verdict as the cooperative
            # path (AD-37): deny on irreversible / external_send / unknown class,
            # otherwise the tenant's declared `on_approval_service_down`, which until
            # now nothing read (CLAUDE.md §4.4).
            logger.exception("approval_service_error", extra={"tool": canonical})
            verdict = service_down_verdict(self._policy, outcome.action_class)
            if verdict is Approval.deny:
                return _denied_result(f"'{canonical}' held: approval service unavailable")
            return await self._proxy.call_tool(name, arguments)

    async def _run_approval_flow(
        self,
        ctx: ApprovalContext,
        name: str,
        arguments: dict[str, Any],
        canonical: str,
        outcome: PolicyOutcome,
        required: int,
    ) -> types.CallToolResult:
        with db.connection(ctx.database_url) as conn:
            ah = approvals.args_hash(arguments)
            record = approvals.find_active(conn, ctx.tenant_id, canonical, ah)
            if record is not None:
                record = approvals.expire_if_needed(conn, record)
                conn.commit()

            if record is None:
                record = self._create_approval(
                    conn, ctx, canonical, outcome, arguments, ah, required
                )
                summary = record.dry_run.get("summary", "")
                _notify(ctx.notifier, record.id, summary, record.expires_at.isoformat())
                self._audit("hitl_pending", canonical, outcome, arguments, request_id=record.id)
                return _requires_approval_result(record.id, summary)

            if record.status == "pending":
                # Repeated poll while awaiting humans: no new audit entry.
                return _requires_approval_result(record.id, record.dry_run.get("summary", ""))
            if record.status == "approved":
                if approvals.consume(conn, record.id):
                    conn.commit()
                    self._audit(
                        "hitl_approved", canonical, outcome, arguments, request_id=record.id
                    )
                    return await self._proxy.call_tool(name, arguments)
                conn.commit()
                return _denied_result(f"'{canonical}' approval already consumed")

            # Terminal (denied/expired): record once, then consume so a later
            # re-invocation asks afresh instead of re-logging.
            approvals.consume(conn, record.id)
            conn.commit()
            decision = "hitl_denied" if record.status == "denied" else "expired"
            self._audit(decision, canonical, outcome, arguments, request_id=record.id)
            return _denied_result(f"'{canonical}' approval {record.status}")

    def _create_approval(
        self,
        conn: Any,
        ctx: ApprovalContext,
        canonical: str,
        outcome: PolicyOutcome,
        arguments: dict[str, Any],
        ah: str,
        required: int,
    ) -> approvals.ApprovalRecord:
        action_class = outcome.action_class.value if outcome.action_class else None
        dry_run = approvals.build_dry_run(canonical, action_class, arguments)
        expires_at = datetime.now(UTC) + timedelta(seconds=ctx.timeout_seconds)
        record = approvals.create(
            conn,
            tenant_id=ctx.tenant_id,
            request_id=uuid4().hex,
            tool_name=canonical,
            action_class=action_class,
            ah=ah,
            arguments_summary=approvals.redact(arguments),
            dry_run=dry_run,
            required_count=required,
            expires_at=expires_at,
            requested_by=ctx.requested_by,
        )
        conn.commit()
        logger.info("approval_created", extra={"tool": canonical, "approval_id": record.id})
        return record


def _requires_approval_result(approval_id: str, summary: str) -> types.CallToolResult:
    return _denied_result(f"requires_approval approval_id={approval_id} :: {summary}")


def _notify(notifier: Notifier | None, approval_id: str, summary: str, expires_at: str) -> None:
    if notifier is None:
        return
    try:
        notifier.notify_approval(approval_id=approval_id, summary=summary, expires_at=expires_at)
    except Exception:  # best-effort; a missed notification leaves the action pending (safe)
        logger.warning("approval_notify_failed", extra={"approval_id": approval_id})


def authenticate_session(database_url: str, raw_token: str) -> tuple[str, str]:
    """Resolve ``(tenant_id, token_id)`` for an MCP session, or raise PermissionError.

    Fail-closed (CLAUDE.md §4.4): a missing/unknown/revoked token is refused. The
    token id travels with the tenant because it is the agent's identity, and the
    persisted taint is keyed on it (`FR-154`).
    """
    with db.connection(database_url) as conn:
        tenant_id, token_id = authenticate_gateway_session(conn, raw_token)
        conn.commit()
    return tenant_id, token_id


def build_server(backend: ToolBackend | None = None) -> Server:
    """Construct the MCP gateway server with its request handlers registered."""
    active_backend: ToolBackend = backend or EmptyBackend()
    server: Server = Server(SERVER_NAME)

    # The MCP SDK's decorator factories are not return-annotated upstream, so mypy
    # (strict) flags the call/decorator as untyped. warn_unused_ignores=true will
    # tell us to drop these if the SDK ever annotates them.
    @server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
    async def _list_tools() -> list[types.Tool]:
        return await active_backend.list_tools()

    @server.call_tool()  # type: ignore[untyped-decorator]
    async def _call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await active_backend.call_tool(name, arguments)

    return server


def _build_backend(
    database_url: str,
    tenant_id: str,
    client_id: str | None = None,
    gateway_token_id: str | None = None,
) -> PolicyBackend:  # pragma: no cover - I/O glue
    from core import policy_store, servers
    from core.config import get_settings
    from core.judge import build_judge
    from core.notify import build_notifier

    settings = get_settings()
    with db.connection(database_url) as conn:
        rows = servers.enabled_specs(conn, tenant_id)
        policy = policy_store.load_policy(conn, tenant_id)
    specs = [
        ServerSpec(name=name, transport=transport, config=config)
        for name, transport, config in rows
    ]
    ctx = ApprovalContext(
        database_url=database_url,
        tenant_id=tenant_id,
        timeout_seconds=policy.defaults.hitl_timeout_seconds,
        notifier=build_notifier(settings),
        client_id=client_id,
        gateway_token_id=gateway_token_id,
    )
    return PolicyBackend(policy, DownstreamProxy(specs), ctx, build_judge(settings))


async def run_stdio() -> None:  # pragma: no cover - exercised via real MCP transport
    """Run the gateway over stdio (how an agent launches it).

    Refuses to start without a valid tenant token (fail-closed).
    """
    from mcp.server.stdio import stdio_server

    from core.config import get_settings

    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required to authenticate the gateway session")
    raw_token = os.environ.get(TENANT_TOKEN_ENV, "")
    tenant_id, token_id = authenticate_session(settings.database_url, raw_token)  # raises
    with db.connection(settings.database_url) as conn:
        client_id = tenant_tokens.resolve_client_id(conn, raw_token)

    server = build_server(_build_backend(settings.database_url, tenant_id, client_id, token_id))
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:  # pragma: no cover - thin entrypoint
    import anyio

    anyio.run(run_stdio)


if __name__ == "__main__":  # pragma: no cover
    main()
