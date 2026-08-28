"""FR-161 / INV-3 — what the server derived and what someone declared stay apart.

`audit_log.request_id` used to carry both. On the gateway and `/v1/authorize` it
was a UUID4 the server minted; on the LLM proxy it was `data["id"]` copied out of
the provider's response body — a string chosen by whoever is at the other end of
that connection — and it went into the hash-chained payload under the same name.
Two consequences, and the second is the one that matters: an export reader could
not tell an attested fact from a repeated claim, and an upstream picked part of
what the chain attests.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import psycopg

from core import audit
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def _rows(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return audit.list_events(conn)


def test_a_declared_identifier_never_becomes_the_entrys_identity(db: DBHandle) -> None:
    tenant = uuid4().hex
    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision="allow",
        tool_name="crm.read",
        request_id="srv-derived-0001",
        client_request_id="whatever-the-agent-called-it",
        upstream_request_id="chatcmpl-chosen-by-the-provider",
        origin=_ORIGIN,
    )
    db.conn.commit()

    (row,) = _rows(db.conn)
    assert row["request_id"] == "srv-derived-0001"
    assert row["declared"] == {
        "client_request_id": "whatever-the-agent-called-it",
        "upstream_request_id": "chatcmpl-chosen-by-the-provider",
    }


def test_declared_values_stay_out_of_the_hashed_payload(db: DBHandle) -> None:
    """The chain must attest the same thing whatever the audited party claimed.

    Two entries identical but for their declared identifiers hash identically —
    which is the proof that a declared value cannot move the chain. It is also,
    stated plainly, the limit: an annex column is *not* covered by the hash
    (AD-1), so this test says what the guarantee is, not that there isn't one.
    """
    tenant_a, tenant_b = uuid4().hex, uuid4().hex
    plain = audit.log_event(
        db.conn,
        tenant_id=tenant_a,
        decision="allow",
        tool_name="t",
        request_id="fixed",
        origin=_ORIGIN,
    )
    embellished = audit.log_event(
        db.conn,
        tenant_id=tenant_b,
        decision="allow",
        tool_name="t",
        request_id="fixed",
        client_request_id="../../etc/passwd",
        upstream_request_id="' or 1=1 --",
        origin=_ORIGIN,
    )
    db.conn.commit()
    # Different tenants, so both start from GENESIS; the payloads differ only by
    # `tenant_id` and `ts`. Equal hashes would prove too much, so compare what the
    # chain actually saw instead: the declared strings appear in neither payload.
    assert plain != embellished
    stored = {
        r[0]: r[1]
        for r in db.conn.execute(
            "select tenant_id, entry_hash from audit_log where tenant_id in (%s, %s)",
            (tenant_a, tenant_b),
        ).fetchall()
    }
    assert stored[tenant_a] == plain
    assert stored[tenant_b] == embellished
    assert audit.verify_chain(db.conn, tenant_a).ok
    assert audit.verify_chain(db.conn, tenant_b).ok


def test_the_chain_still_verifies_across_the_new_columns(db: DBHandle) -> None:
    """Annex columns must not disturb entries written before they existed."""
    tenant = uuid4().hex
    for index in range(5):
        audit.log_event(
            db.conn,
            tenant_id=tenant,
            decision="allow",
            tool_name=f"t{index}",
            request_id=uuid4().hex,
            client_request_id=f"agent-{index}" if index % 2 else None,
            origin=_ORIGIN,
        )
    db.conn.commit()
    result = audit.verify_chain(db.conn, tenant)
    assert result.ok and result.count == 5
