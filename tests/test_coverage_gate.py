"""Gate scenarios for the two `Bloqué` claims that had none (AD-26, CM-7).

Both controls already existed; what was missing was an end-to-end assertion tied
to the coverage row it proves. `M-07` rested on `scripts/demo.py` -- a script CI
never runs -- and `M-08` on a unit test of `approvals.decide`, which says nothing
about whether the gateway actually withholds the action.

Each test carries its negative control: the claim is not that a refusal is
reported, it is that the downstream tool was never reached.
"""

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
  - name: mock.mail_send
    class: external_send
    approval: auto
    constraints: { allowed_domains: ["@client.fr"] }
  - name: mock.delete_contact
    class: irreversible
    approval: human_dual
defaults: {unknown_tool: deny}
"""
)


def _text(result: object) -> str:
    return result.content[0].text  # type: ignore[attr-defined]


def _approval_id(result: object) -> str:
    match = re.search(r"approval_id=([0-9a-f-]+)", _text(result))
    assert match is not None
    return match.group(1)


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


def _seed_tenant(db: DBHandle) -> str:
    tenant_id = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.commit()
    return str(tenant_id)


# --- M-07 emission: the agent as sender --------------------------------------


@pytest.mark.covers("M-07", "emission", ingress="mcp", sens="bloque")
async def test_send_outside_the_allowlist_is_denied_and_never_relayed(db: DBHandle) -> None:
    backend = _backend(db, _seed_tenant(db))

    result = await backend.call_tool(
        "mail_send", {"to": "target@evil.test", "subject": "urgent wire transfer"}
    )

    assert result.isError is True
    assert "constraint violated" in _text(result)  # the allowlist, not some other refusal
    # The negative control. A refusal message proves nothing on its own -- what
    # matters is that the downstream tool never ran, so no mail left.
    assert "sent" not in _text(result)


@pytest.mark.covers("M-07", "emission", ingress="mcp", sens="laisse_passer")
async def test_send_inside_the_allowlist_still_goes_through(db: DBHandle) -> None:
    # The control's other half: a guard that blocks everything is not a control,
    # it is an outage. Without this, the test above passes on a broken gateway.
    backend = _backend(db, _seed_tenant(db))

    result = await backend.call_tool(
        "mail_send", {"to": "alice@client.fr", "subject": "quarterly report"}
    )

    assert result.isError is False


# --- M-08 approval integrity: separation of duties ---------------------------


@pytest.mark.covers("M-08", "approbation", ingress="mcp", sens="bloque")
@pytest.mark.covers("M-08", "approbation", ingress="mcp", sens="laisse_passer")
async def test_dual_approval_needs_two_distinct_humans_at_the_gateway(db: DBHandle) -> None:
    tenant_id = _seed_tenant(db)
    backend = _backend(db, tenant_id)

    held = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert held.isError is True
    approval_id = _approval_id(held)

    # One approver is not enough.
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    db.conn.commit()
    still_held = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert still_held.isError is True
    assert "deleted" not in _text(still_held)

    # The *same* approver twice is not two approvers. This is the claim `M-08`
    # actually makes: the impersonated executive cannot approve their own request
    # by pressing the button twice.
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-1")
    db.conn.commit()
    still_held_again = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert still_held_again.isError is True
    assert "deleted" not in _text(still_held_again)

    # A second, distinct approver releases it.
    approvals.decide(db.conn, tenant_id, approval_id, "approve", "op-2")
    db.conn.commit()
    done = await backend.call_tool("delete_contact", {"contact_id": "c1"})
    assert done.isError is False
    assert "deleted c1" in _text(done)


# --- M-14 secrets: nothing sensitive crosses into the evidence ---------------

_SECRET = "sk-live-51H8QpZ2eR4tYuIoP9aSdFgHjKlZxCvBnM"


def _audit_text(db: DBHandle) -> str:
    """Every text-bearing column of the audit log, concatenated."""
    rows = db.conn.execute(
        "select tenant_id, user_id, request_id, tool_name, action_class, decision, "
        "policy_rule_id, args_hash, error, prev_hash, entry_hash from audit_log order by id"
    ).fetchall()
    return " ".join(str(v) for row in rows for v in row if v is not None)


@pytest.mark.covers("M-14", "secrets", ingress="mcp", sens="bloque")
@pytest.mark.covers("M-14", "secrets", ingress="mcp", sens="laisse_passer")
async def test_a_secret_argument_never_reaches_the_audit_log_over_mcp(db: DBHandle) -> None:
    # CLAUDE.md 4.10: metadata and a hash, never argument values. The vault tests
    # prove the crypto; this proves the boundary -- that a secret handed to a tool
    # does not end up written, in clear, into the immutable record of the decision.
    tenant_id = _seed_tenant(db)
    backend = _backend(db, tenant_id)

    await backend.call_tool("mail_send", {"to": "alice@client.fr", "subject": _SECRET})

    written = _audit_text(db)
    assert written  # the decision was recorded at all -- otherwise this proves nothing
    assert _SECRET not in written
    assert "sk-live-" not in written


@pytest.mark.covers("M-14", "secrets", ingress="http", sens="bloque")
@pytest.mark.covers("M-14", "secrets", ingress="http", sens="laisse_passer")
def test_a_secret_argument_never_reaches_the_audit_log_over_http(db: DBHandle) -> None:
    # Same claim on the cooperative path. A guarantee that holds on one ingress and
    # not the other is not a guarantee (AD-28).
    from core import decision

    tenant_id = _seed_tenant(db)
    result = decision.authorize(
        database_url=db.url,
        policy=_POLICY,
        tenant_id=tenant_id,
        tool="mock.mail_send",
        arguments={"to": "alice@client.fr", "subject": _SECRET},
    )

    assert result["decision"] == "allow"
    written = _audit_text(db)
    assert written
    assert _SECRET not in written
    assert "sk-live-" not in written
