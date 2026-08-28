"""Per-tool RBAC / confused-deputy guard at the gateway (M10)."""

from __future__ import annotations

from typing import Any

import mcp.types as types
import pytest

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


@pytest.mark.covers("M-12", "rbac", ingress="mcp", sens="laisse_passer")
async def test_allowed_client_may_call(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id="c1").call_tool("secret", {})
    assert result.isError is False and proxy.calls == ["secret"]


@pytest.mark.covers("M-12", "rbac", ingress="mcp", sens="bloque")
async def test_foreign_client_is_denied_and_audited(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id="c2").call_tool("secret", {})
    assert result.isError is True and "not authorized" in _text(result)
    assert proxy.calls == []  # downstream tool never invoked
    assert "rbac_denied" in _decisions(db)


@pytest.mark.covers("M-12", "rbac", ingress="mcp", sens="bloque")
async def test_missing_client_is_denied(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy, client_id=None).call_tool("secret", {})
    assert result.isError is True and proxy.calls == []


async def test_tool_without_allowlist_is_unaffected(db: DBHandle) -> None:
    proxy = FakeProxy()
    # 'mock.open' has no allowed_clients -> RBAC does not apply, even with no client.
    result = await _backend(db, proxy, client_id=None).call_tool("open", {})
    assert result.isError is False and proxy.calls == ["open"]


@pytest.mark.covers("M-12", "rbac", ingress="mcp", sens="controle_negatif")
async def test_without_the_client_allowlist_the_same_tool_is_relayed(db: DBHandle) -> None:
    """`AD-30.3` — the same tool, the same absent client, and the call lands.

    Deliberately not `test_tool_without_allowlist_is_unaffected`: that one calls a
    *different* tool (`open`), so it proves RBAC does not over-apply — a second
    `laisse_passer`, not a counterfactual. If `secret` were misspelt or unknown to
    the proxy, both refusal tests above would pass while proving nothing, and only
    this test would notice.
    """
    proxy = FakeProxy()
    unguarded = parse_policy(
        "tools:\n  - {name: mock.secret, class: read, approval: auto}\ndefaults:\n"
        "  unknown_tool: deny\n"
    )
    ctx = ApprovalContext(database_url=db.url, tenant_id="t-rbac", client_id=None)
    backend = PolicyBackend(unguarded, proxy, ctx)  # type: ignore[arg-type]

    result = await backend.call_tool("secret", {})

    assert result.isError is False
    assert proxy.calls == ["secret"]
