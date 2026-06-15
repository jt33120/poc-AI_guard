"""Ambiguous tools at the gateway: the judge classifies, the matrix escalates (M6)."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

from core.judge import Judge
from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"


def _proxy() -> DownstreamProxy:
    return DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )


def _seed_tenant(db: DBHandle) -> str:
    tenant_id = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return str(tenant_id)


def _decisions(db: DBHandle, tenant_id: str) -> list[tuple[str, bool]]:
    rows = db.conn.execute(
        "select decision, judge_used from audit_log where tenant_id = %s order by id", (tenant_id,)
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


async def test_ambiguous_dangerous_is_escalated_to_hitl(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.delete_contact, classify: ambiguous, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    judge = Judge(lambda _s, _u: '{"action_class": "irreversible"}')
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    backend = PolicyBackend(policy, _proxy(), ctx, judge)

    result = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert result.isError is True
    assert "requires_approval" in result.content[0].text  # type: ignore[union-attr]
    assert "deleted" not in result.content[0].text  # type: ignore[union-attr]
    assert _decisions(db, tenant_id) == [("hitl_pending", True)]


async def test_ambiguous_safe_stays_auto(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    policy = parse_policy(
        "tools:\n"
        "  - {name: mock.echo, classify: ambiguous, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    judge = Judge(lambda _s, _u: '{"action_class": "read"}')
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    backend = PolicyBackend(policy, _proxy(), ctx, judge)

    result = await backend.call_tool("echo", {"text": "hi"})
    assert result.isError is False
    assert "hi" in result.content[0].text  # type: ignore[union-attr]
    assert _decisions(db, tenant_id) == [("allow", True)]
