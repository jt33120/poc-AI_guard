"""Transparent proxy: union of tools, relay, and anti-collision prefixing (M2)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from gateway.downstream import DownstreamProxy, ServerSpec, UnknownToolError

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"


def _spec(name: str) -> ServerSpec:
    return ServerSpec(
        name=name,
        transport="stdio",
        config={"command": sys.executable, "args": [str(_MOCK)]},
    )


async def test_lists_union_of_downstream_tools() -> None:
    proxy = DownstreamProxy([_spec("mock")])
    names = {tool.name for tool in await proxy.list_tools()}
    assert names == {"echo", "delete_contact", "mail_send"}


async def test_relays_call_and_returns_result() -> None:
    proxy = DownstreamProxy([_spec("mock")])
    result = await proxy.call_tool("echo", {"text": "hello"})
    assert result.isError is False
    assert "hello" in result.content[0].text  # type: ignore[union-attr]


async def test_call_without_prior_list_builds_routing() -> None:
    proxy = DownstreamProxy([_spec("mock")])
    # No list_tools() first: call_tool must build its own routing table.
    result = await proxy.call_tool("delete_contact", {"contact_id": "c-1"})
    assert "deleted c-1" in result.content[0].text  # type: ignore[union-attr]


async def test_unknown_tool_raises() -> None:
    proxy = DownstreamProxy([_spec("mock")])
    with pytest.raises(UnknownToolError):
        await proxy.call_tool("nope", {})


async def test_name_collisions_are_prefixed() -> None:
    proxy = DownstreamProxy([_spec("alpha"), _spec("beta")])
    names = {tool.name for tool in await proxy.list_tools()}
    # Both servers expose the same tools -> all colliding names get namespaced.
    assert names == {
        "alpha.echo",
        "alpha.delete_contact",
        "alpha.mail_send",
        "beta.echo",
        "beta.delete_contact",
        "beta.mail_send",
    }
    result = await proxy.call_tool("beta.echo", {"text": "x"})
    assert "x" in result.content[0].text  # type: ignore[union-attr]
