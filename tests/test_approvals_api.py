"""Control API for approvals: queue, decision, RBAC, isolation (SPEC §8, M4)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import approvals
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_pending(db: DBHandle, tenant_id: str) -> str:
    record = approvals.create(
        db.conn,
        tenant_id=tenant_id,
        request_id=uuid4().hex,
        tool_name="crm.delete_contact",
        action_class="irreversible",
        ah="hash-1",
        arguments_summary={"contact_id": "c1"},
        dry_run={"summary": "Execute crm.delete_contact"},
        required_count=1,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        requested_by=None,
    )
    db.conn.commit()
    return record.id


def test_list_decide_rbac_and_isolation(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant_a, tenant_b = uuid4(), uuid4()
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b)
    )
    db.conn.commit()
    approval_id = _seed_pending(db, str(tenant_a))

    client = _client(db.url, test_verifier)
    op_a = make_token(tenant_id=str(tenant_a), role="operator")
    viewer_a = make_token(tenant_id=str(tenant_a), role="viewer")
    admin_b = make_token(tenant_id=str(tenant_b), role="admin")

    # Operator A sees the pending approval (RLS).
    listed = client.get("/v1/approvals?status=pending", headers=_auth(op_a)).json()
    assert [a["id"] for a in listed] == [approval_id]

    # Tenant B sees nothing (isolation).
    assert client.get("/v1/approvals", headers=_auth(admin_b)).json() == []

    # Viewer cannot decide (RBAC).
    forbidden = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(viewer_a),
        json={"decision": "approve"},
    )
    assert forbidden.status_code == 403

    # Tenant B cannot decide A's approval (isolation -> 404).
    cross = client.post(
        f"/v1/approvals/{approval_id}/decision",
        headers=_auth(admin_b),
        json={"decision": "approve"},
    )
    assert cross.status_code == 404

    # Operator A approves -> 200 approved.
    approved = client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(op_a), json={"decision": "approve"}
    )
    assert approved.status_code == 200 and approved.json()["status"] == "approved"

    # Deciding again -> 409 (already decided).
    again = client.post(
        f"/v1/approvals/{approval_id}/decision", headers=_auth(op_a), json={"decision": "deny"}
    )
    assert again.status_code == 409


def test_invalid_status_filter_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="operator")
    assert client.get("/v1/approvals?status=bogus", headers=_auth(token)).status_code == 422
