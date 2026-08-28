"""Risk-scored autonomy at the gateway (M11): tighten auto, honour earned trust."""

from __future__ import annotations

from typing import Any

import mcp.types as types

from core import audit
from core.policy import parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()

_AWS_KEY = "AKIAIOSFODNN7EXAMPLE"

_POLICY = parse_policy(
    """
tools:
  - name: mock.get
    class: read
    approval: auto
  - name: mock.set
    class: write
    approval: auto
defaults:
  unknown_tool: deny
  risk_bands:
    auto: 30
    notify: 60
    hitl: 85
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


def _backend(db: DBHandle, proxy: FakeProxy) -> PolicyBackend:
    ctx = ApprovalContext(database_url=db.url, tenant_id="t-risk")
    return PolicyBackend(_POLICY, proxy, ctx)  # type: ignore[arg-type]


def _last_decision(db: DBHandle, tool: str) -> str | None:
    row = db.conn.execute(
        "select decision from audit_log where tool_name = %s order by id desc limit 1", (tool,)
    ).fetchone()
    return row[0] if row else None


async def test_low_risk_stays_auto(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy).call_tool("get", {})  # read, fresh → 15 → auto
    assert result.isError is False and proxy.calls == ["get"]
    assert _last_decision(db, "mock.get") == "allow"


async def test_medium_risk_is_tightened_to_notify(db: DBHandle) -> None:
    proxy = FakeProxy()
    result = await _backend(db, proxy).call_tool("set", {})  # write, fresh → 35 → notify
    assert result.isError is False and proxy.calls == ["set"]  # relayed, no human gate
    assert _last_decision(db, "mock.set") == "notify"


async def test_earned_trust_relaxes_back_to_auto(db: DBHandle) -> None:
    # Five clean approvals earn trust for (tenant, mock.set).
    for _ in range(5):
        audit.log_event(
            db.conn, tenant_id="t-risk", decision="allow", tool_name="mock.set", origin=_ORIGIN
        )
    proxy = FakeProxy()
    # write + secret = 50 (would be notify), minus the 30-pt trust discount → 20 → auto.
    result = await _backend(db, proxy).call_tool("set", {"key": _AWS_KEY})
    assert result.isError is False and proxy.calls == ["set"]
    assert _last_decision(db, "mock.set") == "allow"
