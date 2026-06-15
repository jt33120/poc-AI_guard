"""The MCP gateway server boots; the default backend exposes zero tools."""

from __future__ import annotations

import mcp.types as types

from gateway.server import SERVER_NAME, EmptyBackend, build_server


async def test_default_backend_exposes_zero_tools() -> None:
    assert await EmptyBackend().list_tools() == []


def test_server_builds_with_name() -> None:
    server = build_server()
    assert server.name == SERVER_NAME


def test_list_and_call_tool_handlers_are_registered() -> None:
    server = build_server()
    assert types.ListToolsRequest in server.request_handlers
    assert types.CallToolRequest in server.request_handlers
