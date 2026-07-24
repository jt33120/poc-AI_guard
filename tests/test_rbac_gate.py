"""Per-tool RBAC / confused-deputy guard at the gateway (M10)."""

from __future__ import annotations

from typing import Any

import mcp.types as types

from core.policy import parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

_POLICY = parse_policy(
    """
tools:
  - name: mock.secret
    class: read
    approval: auto
    constraints:
      allowed_clients: ["c1"]
  - name: mock.open
    class: read
    approval: auto
defaults:
  unknown_tool: deny
"""
)


class FakeProxy:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def list_tools(self) -> list[types.Tool]:
        return []

    async def resolve(self, name: str) -> tuple[str, str]:
        return ("mock", name)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        self.calls.append(name)
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"ran {name}")], isError=False
        )


def _backend(db: DBHandle, proxy: FakeProxy, *, client_id: str | None) -> PolicyBackend:
    ctx = ApprovalContext(database_url=db.url, tenant_id="t-rbac", client_id=client_id)
    return PolicyBackend(_POLICY, proxy, ctx)  # type: ignore[arg-type]


def _text(result: types.CallToolResult) -> str:
    return result.content[0].text  # type: ignore[union-attr]


def _decisions(db: DBHandle) -> list[str]:
    return [r[0] for r in db.conn.execute("select decision from audit_log").fetchall()]


async def test_allowed_client_may_call(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id="c1").call_tool("secret", {})
    assert result.isError is False and proxy.calls == ["secret"]


async def test_foreign_client_is_denied_and_audited(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id="c2").call_tool("secret", {})
    assert result.isError is True and "not authorized" in _text(result)
    assert proxy.calls == []  # downstream tool never invoked
    assert "rbac_denied" in _decisions(db)


async def test_missing_client_is_denied(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id=None).call_tool("secret", {})
    assert result.isError is True and proxy.calls == []


async def test_tool_without_allowlist_is_unaffected(db: DBHandle) -> None:
    proxy = FakeProxy()
    # 'mock.open' has no allowed_clients -> RBAC does not apply, even with no client.
    result = await _backend(db, proxy, client_id=None).call_tool("open", {})
    assert result.isError is False and proxy.calls == ["open"]
