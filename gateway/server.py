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
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

import mcp.types as types
from mcp.server.lowlevel import Server

from core import approvals, db
from core.notify import Notifier
from core.policy import Approval, Policy, PolicyOutcome, evaluate
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
    ) -> None:
        self._policy = policy
        self._proxy = proxy
        self._approval_ctx = approval_ctx

    async def list_tools(self) -> list[types.Tool]:
        return await self._proxy.list_tools()

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        resolved = await self._proxy.resolve(name)
        canonical = f"{resolved[0]}.{resolved[1]}" if resolved else name
        outcome = evaluate(self._policy, canonical, arguments)

        if outcome.decision is Approval.auto:
            return await self._proxy.call_tool(name, arguments)
        if outcome.decision is Approval.deny:
            logger.info(
                "tool_denied",
                extra={"tool": canonical, "decision": "deny", "reason": outcome.reason},
            )
            return _denied_result(f"'{canonical}' not permitted by policy: deny ({outcome.reason})")
        return await self._handle_hitl(name, arguments, canonical, outcome)

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
                return _requires_approval_result(record.id, summary)

            if record.status == "pending":
                return _requires_approval_result(record.id, record.dry_run.get("summary", ""))
            if record.status == "approved":
                if approvals.consume(conn, record.id):
                    conn.commit()
                    logger.info("hitl_approved_relay", extra={"tool": canonical})
                    return await self._proxy.call_tool(name, arguments)
                conn.commit()
                return _denied_result(f"'{canonical}' approval already consumed")
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
    return PolicyBackend(policy, DownstreamProxy(specs), ctx)


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
