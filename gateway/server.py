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
from typing import Any, Protocol

import mcp.types as types
from mcp.server.lowlevel import Server

from core import db
from core.policy import Approval, Policy, evaluate
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


class PolicyBackend:
    """Enforces the policy over a downstream proxy (auto/deny; HITL added in M4).

    The agent-facing tool name may be bare; policy is always evaluated against the
    canonical ``server.tool`` name. Anything not explicitly ``auto`` is refused
    here (fail-closed) until the HITL approval flow lands.
    """

    def __init__(self, policy: Policy, proxy: DownstreamProxy) -> None:
        self._policy = policy
        self._proxy = proxy

    async def list_tools(self) -> list[types.Tool]:
        return await self._proxy.list_tools()

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        resolved = await self._proxy.resolve(name)
        canonical = f"{resolved[0]}.{resolved[1]}" if resolved else name
        outcome = evaluate(self._policy, canonical, arguments)
        if outcome.decision is Approval.auto:
            return await self._proxy.call_tool(name, arguments)
        logger.info(
            "tool_denied",
            extra={
                "tool": canonical,
                "decision": outcome.decision.value,
                "reason": outcome.reason,
            },
        )
        return _denied_result(
            f"'{canonical}' not permitted by policy: {outcome.decision.value} ({outcome.reason})"
        )


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

    with db.connection(database_url) as conn:
        rows = servers.enabled_specs(conn, tenant_id)
        policy = policy_store.load_policy(conn, tenant_id)
    specs = [
        ServerSpec(name=name, transport=transport, config=config)
        for name, transport, config in rows
    ]
    return PolicyBackend(policy, DownstreamProxy(specs))


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
