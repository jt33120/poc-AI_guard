"""Acceptance: the MCP gateway server boots and exposes zero tools (M0)."""

from __future__ import annotations

import mcp.types as types

from gateway.server import SERVER_NAME, build_server, list_available_tools


async def test_exposes_zero_tools() -> None:
    assert await list_available_tools() == []


def test_server_builds_with_name() -> None:
    server = build_server()
    assert server.name == SERVER_NAME


def test_list_tools_handler_is_registered() -> None:
    server = build_server()
    assert types.ListToolsRequest in server.request_handlers
