"""End-to-end HITL at the gateway: hold, approve-once, deny, expire, fail-closed (M4)."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from uuid import uuid4

import pytest

from core import approvals
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


def _text(result: object) -> str:
    return result.content[0].text  # type: ignore[attr-defined]


def _approval_id(result: object) -> str:
    match = re.search(r"approval_id=([0-9a-f-]+)", _text(result))
    assert match is not None
    return match.group(1)


def _backend(
    db: DBHandle, tenant_id: str, *, database_url: str | None = None, seconds: int = 3600
) -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    ctx = ApprovalContext(
        database_url=database_url or db.url, tenant_id=tenant_id, timeout_seconds=seconds
    )
    return PolicyBackend(_POLICY, proxy, ctx)


def _seed_tenant(db: DBHandle) -> str:
    tenant_id = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return str(tenant_id)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_irreversible_held_then_approved_relays_once(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    backend = _backend(db, tenant_id)

    # First call: held, downstream never invoked.
    held = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert held.isError is True
    assert "requires_approval" in _text(held)
    assert "deleted" not in _text(held)
    approval_id = _approval_id(held)

    # An operator approves out of band.
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")

    # Re-invocation now relays exactly once.
    done = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert done.isError is False
    assert "deleted c1" in _text(done)

    # A further re-invocation requires a fresh approval (previous was consumed).
    again = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert "requires_approval" in _text(again)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_denied_is_never_relayed(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    backend = _backend(db, tenant_id)
    held = await backend.call_tool("delete_contact", {"contact_id": "c2"})
    approvals.decide(db.conn, tenant_id, _approval_id(held), "deny", "op-1")
    result = await backend.call_tool("delete_contact", {"contact_id": "c2"})
    assert result.isError is True
    assert "denied" in _text(result)
    assert "deleted" not in _text(result)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_expired_is_never_relayed(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    backend = _backend(db, tenant_id, seconds=-10)  # created already past its deadline
    await backend.call_tool("delete_contact", {"contact_id": "c3"})
    result = await backend.call_tool("delete_contact", {"contact_id": "c3"})
    assert result.isError is True
    assert "expired" in _text(result)
    assert "deleted" not in _text(result)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_approval_service_down_fails_closed(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    # Point the approval store at an unreachable database.
    backend = _backend(db, tenant_id, database_url="postgresql://postgres@127.0.0.1:1/none")
    result = await backend.call_tool("delete_contact", {"contact_id": "c4"})
    assert result.isError is True
    assert "approval service unavailable" in _text(result)
    assert "deleted" not in _text(result)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="laisse_passer")
async def test_auto_tool_still_relays(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    result = await _backend(db, tenant_id).call_tool("echo", {"text": "hi"})
    assert result.isError is False
    assert "hi" in _text(result)
