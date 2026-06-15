"""Every gateway decision writes one hash-chained audit entry (M5)."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from uuid import uuid4

from core import approvals, audit
from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"

_POLICY = parse_policy(
    """
tools:
  - {name: mock.echo, class: read, approval: auto}
  - {name: mock.delete_contact, class: irreversible, approval: human_in_the_loop}
defaults: {unknown_tool: deny}
"""
)


def _backend(db: DBHandle, tenant_id: str) -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    return PolicyBackend(_POLICY, proxy, ctx)


def _decisions(db: DBHandle, tenant_id: str) -> list[str]:
    rows = db.conn.execute(
        "select decision from audit_log where tenant_id = %s order by id", (tenant_id,)
    ).fetchall()
    return [r[0] for r in rows]


async def test_each_decision_is_audited_and_chain_holds(db: DBHandle) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    tenant_id = str(tenant)
    backend = _backend(db, tenant_id)

    # auto -> allow
    await backend.call_tool("echo", {"text": "hi"})
    # irreversible -> hitl_pending
    held = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    approval_id = re.search(r"approval_id=([0-9a-f-]+)", held.content[0].text).group(1)  # type: ignore[union-attr]
    # approve out of band, re-invoke -> hitl_approved (and relayed)
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    await backend.call_tool("delete_contact", {"contact_id": "c1"})

    assert _decisions(db, tenant_id) == ["allow", "hitl_pending", "hitl_approved"]
    assert audit.verify_chain(db.conn, tenant_id).ok is True
