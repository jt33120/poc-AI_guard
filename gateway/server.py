"""MCP gateway server skeleton (CLAUDE.md §3, SPEC §5).

M0: the server boots and exposes **zero** tools. Downstream aggregation
(SPEC §5.1) and the policy → HITL → audit call_tool pipeline (SPEC §5.2) are
wired in later milestones (M2+).

The low-level ``Server`` is used on purpose: the gateway is a *proxy* whose tool
list is computed dynamically from downstream servers, which the decorator-based
high-level API does not fit as cleanly.
"""

from __future__ import annotations

import os

import mcp.types as types
from mcp.server.lowlevel import Server

from core import db
from core.tenant_tokens import authenticate_gateway_session

SERVER_NAME = "xsom-ai-guard"

#: Environment variable carrying the tenant-scoped gateway token (stdio sessions).
TENANT_TOKEN_ENV = "XSOM_TENANT_TOKEN"  # noqa: S105 - env var name, not a secret


def authenticate_session(database_url: str, raw_token: str) -> str:
    """Resolve the tenant for an MCP session, or raise PermissionError.

    Fail-closed (CLAUDE.md §4.4): a missing/unknown/revoked token is refused.
    """
    with db.connection(database_url) as conn:
        tenant_id = authenticate_gateway_session(conn, raw_token)
        conn.commit()
    return tenant_id


async def list_available_tools() -> list[types.Tool]:
    """Tools exposed to the agent.

    M0: empty — no downstream servers are proxied yet (added in M2).
    """
    return []


def build_server() -> Server:
    """Construct the MCP gateway server with its request handlers registered."""
    server: Server = Server(SERVER_NAME)

    # The MCP SDK's decorator factory is not return-annotated upstream, so mypy
    # (strict) flags the call/decorator as untyped. warn_unused_ignores=true will
    # tell us to drop this if the SDK ever annotates it.
    @server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
    async def _list_tools() -> list[types.Tool]:
        return await list_available_tools()

    return server


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
    authenticate_session(settings.database_url, raw_token)  # raises if invalid

    server = build_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:  # pragma: no cover - thin entrypoint
    import anyio

    anyio.run(run_stdio)


if __name__ == "__main__":  # pragma: no cover
    main()
