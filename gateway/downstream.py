"""Downstream MCP proxy: aggregate tools and relay calls (SPEC §5.1/§5.2, M2).

The gateway is an MCP *client* to each declared downstream server. Tool names
are exposed verbatim unless two servers expose the same name, in which case all
colliding names are namespaced as ``server.tool``. Relayed calls are logged with
metadata only — never argument values or PII (CLAUDE.md §4.10).
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import mcp.types as types
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger("xsom.gateway")


@dataclass(frozen=True)
class ServerSpec:
    """A downstream MCP server to proxy."""

    name: str
    transport: str  # "stdio" | "http"
    config: dict[str, Any]


class UnknownToolError(Exception):
    """Raised when a relayed tool name maps to no downstream server."""


@asynccontextmanager
async def open_session(spec: ServerSpec) -> AsyncIterator[ClientSession]:
    """Open an initialized MCP client session to a downstream server."""
    if spec.transport == "stdio":
        params = StdioServerParameters(
            command=spec.config["command"],
            args=list(spec.config.get("args", [])),
            env=spec.config.get("env"),
        )
        async with (
            stdio_client(params) as (read, write),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            yield session
    elif spec.transport == "http":  # pragma: no cover - not exercised by the hermetic suite
        from mcp.client.streamable_http import streamablehttp_client

        async with (
            streamablehttp_client(spec.config["url"], headers=spec.config.get("headers")) as (
                read,
                write,
                _,
            ),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            yield session
    else:
        raise ValueError(f"unsupported transport: {spec.transport}")


async def fetch_tools(spec: ServerSpec) -> list[types.Tool]:
    async with open_session(spec) as session:
        return (await session.list_tools()).tools


async def invoke(
    spec: ServerSpec, tool_name: str, arguments: dict[str, Any]
) -> types.CallToolResult:
    async with open_session(spec) as session:
        return await session.call_tool(tool_name, arguments)


class DownstreamProxy:
    """Aggregates and relays tools across a tenant's downstream servers."""

    def __init__(self, specs: list[ServerSpec]) -> None:
        self._specs = {spec.name: spec for spec in specs}
        self._routing: dict[str, tuple[str, str]] = {}

    async def list_tools(self) -> list[types.Tool]:
        per_server: dict[str, list[types.Tool]] = {}
        for name, spec in self._specs.items():
            per_server[name] = await fetch_tools(spec)

        counts = Counter(tool.name for tools in per_server.values() for tool in tools)
        public: list[types.Tool] = []
        routing: dict[str, tuple[str, str]] = {}
        for server_name, tools in per_server.items():
            for tool in tools:
                public_name = tool.name if counts[tool.name] == 1 else f"{server_name}.{tool.name}"
                routing[public_name] = (server_name, tool.name)
                public.append(tool.model_copy(update={"name": public_name}))
        self._routing = routing
        return public

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        if name not in self._routing:
            await self.list_tools()  # (re)build the routing table
        if name not in self._routing:
            raise UnknownToolError(name)

        server_name, original = self._routing[name]
        start = time.monotonic()
        result = await invoke(self._specs[server_name], original, arguments or {})
        logger.info(
            "tool_relayed",
            extra={
                "server": server_name,
                "tool": original,
                "public_tool": name,
                "latency_ms": int((time.monotonic() - start) * 1000),
                "is_error": bool(result.isError),
            },
        )
        return result
