"""Gate scenarios for the two `Bloqué` claims that had none (AD-26, CM-7).

Both controls already existed; what was missing was an end-to-end assertion tied
to the coverage row it proves. `M-07` rested on `scripts/demo.py` -- a script CI
never runs -- and `M-08` on a unit test of `approvals.decide`, which says nothing
about whether the gateway actually withholds the action.

Each claim carries three parts (`AD-30.3`): the dangerous action is refused, a
legitimate one still goes through, and — with that guard *disabled* — the same
dangerous action reaches the downstream. The third is the one that is easy to
argue away and hardest to do without: a passing refusal proves only that nothing
happened, and a crash, an unreachable downstream or a misspelt tool name all
satisfy "the defence held".
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


def _unguarded(db: DBHandle, tenant_id: str, policy_yaml: str) -> PolicyBackend:
    """The same gateway with one guard removed from the policy — nothing else.

    A negative control is only worth what it isolates: the downstream, the tool
    name, the arguments and the transport are identical to the blocking scenario,
    so the single difference is the guard under test.
    """
    ctx = ApprovalContext(database_url=db.url, tenant_id=tenant_id, timeout_seconds=3600)
    return PolicyBackend(parse_policy(policy_yaml), _proxy(), ctx)


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


@pytest.mark.covers("M-07", "emission", ingress="mcp", sens="controle_negatif")
async def test_without_the_allowlist_the_same_mail_leaves(db: DBHandle) -> None:
    """`AD-30.3` — the mail was going to leave; the allowlist is what stopped it.

    Same tool, same recipient, same subject as the blocking scenario. The only
    change is a policy with no `allowed_domains`. If this did not send, the refusal
    above would be proving that `mail_send` is broken, not that we guard it.
    """
    backend = _unguarded(
        db,
        _seed_tenant(db),
        "tools:\n"
        "  - {name: mock.mail_send, class: external_send, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n",
    )

    result = await backend.call_tool(
        "mail_send", {"to": "target@evil.test", "subject": "urgent wire transfer"}
    )

    assert result.isError is False
    assert "sent to target@evil.test" in _text(result)


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


# --- M-06: an executor tool is classified by what it is asked to do ----------

_EXECUTOR = parse_policy(
    """
tools:
  - name: mock.echo
    classify: by_argument
    approval: auto
    argument_class:
      rules:
        - {field: text, matches: "^(ls|cat|grep)\\\\b", class: read}
        - {field: text, matches: "\\\\b(rm|dd|shutdown)\\\\b", class: irreversible}
      otherwise: irreversible
defaults: {unknown_tool: deny}
"""
)


def _executor_backend(db: DBHandle, tenant_id: str) -> PolicyBackend:
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
    return PolicyBackend(_EXECUTOR, proxy, ctx)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_a_destructive_executor_invocation_is_held(db: DBHandle) -> None:
    # EXH-4 / G-06. `bash ls` and `bash rm -rf /` are the same tool: a class fixed on
    # the tool is either uselessly strict or dangerously loose. The rule below says
    # `approval: auto`, and the destructive invocation is held anyway.
    backend = _executor_backend(db, _seed_tenant(db))

    result = await backend.call_tool("echo", {"text": "rm -rf /var/data"})

    assert result.isError is True
    # The negative control: `mock.echo` returns its text on success, so a relayed
    # call would be a *success* carrying it. This is a hold with an approval id.
    assert "requires_approval" in _text(result) and "approval_id=" in _text(result)
    # The command DOES appear here, in the dry-run -- that is the point of a dry-run.
    # A human cannot approve what they are not shown.


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="laisse_passer")
async def test_a_harmless_executor_invocation_still_runs(db: DBHandle) -> None:
    # The half that makes it a control rather than an outage: the same tool, a benign
    # argument, and it goes through. Without this, a gateway that denied every
    # executor call would pass the test above.
    backend = _executor_backend(db, _seed_tenant(db))

    result = await backend.call_tool("echo", {"text": "ls -la"})

    assert result.isError is False
    assert "ls -la" in _text(result)


@pytest.mark.covers("M-08", "approbation", ingress="mcp", sens="controle_negatif")
async def test_without_the_approval_gate_the_same_delete_executes(db: DBHandle) -> None:
    """`AD-30.3` — the delete was reachable; two humans are what withheld it.

    Same tool, same contact id. The only change is `approval: auto`. A blocking
    scenario whose action could never have run is a scenario about nothing.
    """
    backend = _unguarded(
        db,
        _seed_tenant(db),
        "tools:\n"
        "  - {name: mock.delete_contact, class: irreversible, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n",
    )

    result = await backend.call_tool("delete_contact", {"contact_id": "c1"})

    assert result.isError is False
    assert "deleted c1" in _text(result)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="controle_negatif")
async def test_without_argument_classification_the_destructive_invocation_runs(
    db: DBHandle,
) -> None:
    """`AD-30.3` — and here it earns its keep more than anywhere else.

    `mock.echo` is exactly the shape `EXH-4` warns about: the operator's only escape
    used to be `class: read, approval: auto`, after which `rm -rf /` went through.
    This asserts that outcome, so the hold above is proven to be the classifier's
    doing and not an accident of the argument being unroutable.
    """
    backend = _unguarded(
        db,
        _seed_tenant(db),
        "tools:\n"
        "  - {name: mock.echo, class: read, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n",
    )

    result = await backend.call_tool("echo", {"text": "rm -rf /var/data"})

    assert result.isError is False
    assert "rm -rf /var/data" in _text(result)


@pytest.mark.covers("M-14", "secrets", ingress="mcp", sens="controle_negatif")
async def test_the_secret_really_travelled_and_is_absent_only_from_the_log(
    db: DBHandle,
) -> None:
    """`AD-30.3`, in the one shape that fits a redaction claim.

    "The secret is not in the audit log" is satisfied by a secret that never left
    the test. `mock.mail_send` echoes its subject, so this asserts the value
    *reached the downstream* — it existed, it travelled the whole call path — and
    is absent from the log specifically, which is the actual claim.
    """
    backend = _backend(db, _seed_tenant(db))

    result = await backend.call_tool("mail_send", {"to": "alice@client.fr", "subject": _SECRET})

    assert result.isError is False
    assert _SECRET in _text(result)  # it really went through the call
    assert _SECRET not in _audit_text(db)  # and stopped at the log


@pytest.mark.covers("M-14", "secrets", ingress="http", sens="controle_negatif")
def test_the_secret_reaches_the_verdict_path_and_is_absent_only_from_the_log(
    db: DBHandle,
) -> None:
    """Same on the cooperative path: the argument was carried, then excluded."""
    from core import decision

    tenant_id = _seed_tenant(db)
    result = decision.authorize(
        database_url=db.url,
        policy=_POLICY,
        tenant_id=tenant_id,
        tool="mock.mail_send",
        arguments={"to": "alice@client.fr", "subject": _SECRET},
    )

    assert result["decision"] == "allow"  # the call carrying the secret was decided
    assert _SECRET not in _audit_text(db)
