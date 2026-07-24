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
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

import mcp.types as types
from mcp.server.lowlevel import Server

from core import approvals, audit, db, integrity
from core.judge import Judge
from core.notify import Notifier
from core.policy import Approval, Policy, PolicyOutcome, escalate_for_class, evaluate
from core.tenant_tokens import authenticate_gateway_session
from gateway.downstream import DownstreamProxy, ServerSpec

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
        outcome = evaluate(self._policy, canonical, arguments)

        # Ambiguous tools: ask the judge for an action class, then escalate the
        # decision to a safe floor. The judge classifies only — never authorizes.
        if outcome.ambiguous and self._judge is not None:
            judged = self._judge.classify(canonical, approvals.redact(arguments))
            outcome = PolicyOutcome(
                action_class=judged,
                decision=escalate_for_class(outcome.decision, judged),
                rule_name=outcome.rule_name,
                reason="judge",
                ambiguous=True,
            )

        if outcome.decision is Approval.auto:
            start = time.monotonic()
            result = await self._proxy.call_tool(name, arguments)
            latency_ms = int((time.monotonic() - start) * 1000)
            self._audit(
                "allow",
                canonical,
                outcome,
                arguments,
                latency_ms=latency_ms,
                request_id=uuid4().hex,
                error="downstream_error" if result.isError else None,
            )
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
            self._audit_integrity(tool_name, _INTEGRITY_DECISION[status], reason)
        return exposed

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

    def _audit_integrity(self, tool_name: str, decision: str, reason: str | None) -> None:
        ctx = self._approval_ctx
        if ctx is None:  # pragma: no cover - only called when integrity is on
            return
        try:
            with db.connection(ctx.database_url) as conn:
                audit.log_event(
                    conn,
                    tenant_id=ctx.tenant_id,
                    decision=decision,
                    tool_name=tool_name,
                    error=reason,
                )
        except Exception:  # audit is best-effort; never break the call path
            logger.warning("integrity_audit_failed", extra={"tool": tool_name})

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
                    judge_used=outcome.ambiguous,
                    args_hash=approvals.args_hash(arguments),
                    latency_ms=latency_ms,
                    error=error,
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
            # Approval service unavailable -> fail-closed (CLAUDE.md §4.4).
            logger.exception("approval_service_error", extra={"tool": canonical})
            return _denied_result(f"'{canonical}' held: approval service unavailable")

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


def authenticate_session(database_url: str, raw_token: str) -> str:
    """Resolve the tenant for an MCP session, or raise PermissionError.

    Fail-closed (CLAUDE.md §4.4): a missing/unknown/revoked token is refused.
    """
    with db.connection(database_url) as conn:
        tenant_id = authenticate_gateway_session(conn, raw_token)
        conn.commit()
    return tenant_id


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
    database_url: str, tenant_id: str
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
    tenant_id = authenticate_session(settings.database_url, raw_token)  # raises if invalid

    server = build_server(_build_backend(settings.database_url, tenant_id))
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:  # pragma: no cover - thin entrypoint
    import anyio

    anyio.run(run_stdio)


if __name__ == "__main__":  # pragma: no cover
    main()
