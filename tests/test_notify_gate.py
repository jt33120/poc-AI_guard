"""Notify-and-proceed level (M11): relays like auto but recorded distinctly."""

from __future__ import annotations

from typing import Any

import mcp.types as types

from core import decision
from core.policy import ActionClass, Approval, escalate_for_class, parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle


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


def _decisions(db: DBHandle) -> list[str]:
    return [r[0] for r in db.conn.execute("select decision from audit_log").fetchall()]


_GATEWAY_POLICY = parse_policy(
    """
tools:
  - name: mock.ping
    class: write
    approval: notify
defaults:
  unknown_tool: deny
"""
)


async def test_gateway_notify_relays_and_audits_distinctly(db: DBHandle) -> None:
    proxy = FakeProxy()
    ctx = ApprovalContext(database_url=db.url, tenant_id="t-notify")
    backend = PolicyBackend(_GATEWAY_POLICY, proxy, ctx)  # type: ignore[arg-type]

    result = await backend.call_tool("ping", {})
    assert result.isError is False and proxy.calls == ["ping"]  # relayed, no human gate
    assert "notify" in _decisions(db) and "allow" not in _decisions(db)


def test_decision_authorize_notify_proceeds(db: DBHandle) -> None:
    policy = parse_policy(
        "tools:\n  - name: t.x\n    class: write\n    approval: notify\n"
        "defaults:\n  unknown_tool: deny\n"
    )
    result = decision.authorize(
        database_url=db.url, policy=policy, tenant_id="t1", tool="t.x", arguments={}
    )
    assert result["decision"] == "allow" and result["notified"] is True
    assert "notify" in _decisions(db)


def test_notify_is_floored_for_risky_classes() -> None:
    # A judged external_send/irreversible can never settle below human review.
    assert (
        escalate_for_class(Approval.notify, ActionClass.irreversible) is Approval.human_in_the_loop
    )
    assert (
        escalate_for_class(Approval.notify, ActionClass.external_send) is Approval.human_in_the_loop
    )
    # A benign class keeps notify.
    assert escalate_for_class(Approval.notify, ActionClass.read) is Approval.notify
